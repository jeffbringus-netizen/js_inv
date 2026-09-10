const express = require('express');
const db = require('../db');
const { logHistory, findOrCreateColor } = require('../db');
const { toLocaltime } = require('../time');
const koffParser = require('../parsers/koff');
const tfoParser = require('../parsers/tfo');

const router = express.Router();

// POST /api/purchases/parse-koff  { data: <base64 xlsx> }
router.post('/parse-koff', (req, res) => {
  if (!req.body.data) return res.status(400).json({ error: 'No file data received' });
  try {
    res.json({ rows: koffParser.parse(req.body.data, db) });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// POST /api/purchases/parse-tfo  { data: <base64 xlsx> }
router.post('/parse-tfo', (req, res) => {
  if (!req.body.data) return res.status(400).json({ error: 'No file data received' });
  try {
    res.json(tfoParser.parse(req.body.data, db));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

// ---------- list ----------
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT po.id, po.total, po.shipping, po.created_at, s.name AS supplier,
      (SELECT COALESCE(SUM(quantity), 0) FROM purchase_products pp WHERE pp.purchase_order_id = po.id) AS item_count
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.id DESC`).all();
  res.json(rows.map(po => ({ ...po, created_at: toLocaltime(po.created_at) })));
});

// ---------- detail ----------
router.get('/:id', (req, res) => {
  const po = db.prepare(`
    SELECT po.id, po.total, po.shipping, po.created_at, s.name AS supplier
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  po.created_at = toLocaltime(po.created_at);
  po.items = db.prepare(`
    SELECT pp.quantity, pp.sort, pp.is_new, p.id AS product_id, p.name, p.sku, p.ean, p.cost
    FROM purchase_products pp JOIN products p ON p.id = pp.product_id
    WHERE pp.purchase_order_id = ?
    ORDER BY pp.sort, p.name`).all(po.id);
  res.json(po);
});

// ---------- complete (creates/updates products + purchase order atomically) ----------
// { supplier_id, shipping, brand_prices: {brandName: suggestedPrice}, updates: [...], new_products: [...] }
router.post('/complete', (req, res) => {
  const { supplier_id, shipping, brand_prices = {}, updates = [], new_products = [] } = req.body;
  if (!supplier_id || !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id)) {
    return res.status(400).json({ error: 'Select a supplier first' });
  }
  if (updates.length === 0 && new_products.length === 0) {
    return res.status(400).json({ error: 'Nothing to import' });
  }

  const REQUIRED_NEW = ['name', 'sku', 'quantity', 'price', 'cost'];
  for (const np of new_products) {
    for (const f of REQUIRED_NEW) {
      if (np[f] === undefined || np[f] === null || np[f] === '') {
        return res.status(400).json({ error: `New product "${np.name || np.sku || '?'}" is missing required field: ${f}` });
      }
    }
  }
  for (const u of updates) {
    if (!db.prepare('SELECT id FROM products WHERE id = ?').get(u.product_id)) {
      return res.status(400).json({ error: `Update references unknown product id ${u.product_id}` });
    }
  }

  // new brands are created with a suggested sale price taken from their products;
  // implicitly created entities are tracked so the import history lists them
  const createdEntities = { brands: [], categories: [], locations: [], colors: [], devices: [], features: [] };
  const createdProducts = []; // full data of newly created products (for the history table)
  const updatedProducts = []; // existing products with before/after values (for the history table)
  const findOrCreate = (table, name, createdKey) => {
    const row = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(name);
    if (row) return row.id;
    const id = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid;
    createdEntities[createdKey].push(name);
    return id;
  };

  // new brands are created with a suggested sale price taken from their products
  const findOrCreateBrand = name => {
    const row = db.prepare('SELECT id FROM brands WHERE name = ? COLLATE NOCASE').get(name);
    if (row) return row.id;
    const id = db.prepare('INSERT INTO brands (name, price) VALUES (?, ?)')
      .run(name, brand_prices[name] != null ? brand_prices[name] : null).lastInsertRowid;
    createdEntities.brands.push(name);
    return id;
  };

  try {
    const result = db.transaction(() => {
      let total = 0;
      // Totals reflect what we actually paid the supplier (the xlsx values):
      // purchase_price is the file cost even when the stored product cost is
      // deliberately left unchanged — accounting uses the real paid value.
      for (const u of updates) total += (u.purchase_price ?? u.cost ?? 0) * u.add_quantity;
      for (const np of new_products) total += np.cost * np.quantity;

      const purchaseOrderId = db.prepare(
        'INSERT INTO purchase_orders (supplier_id, total, shipping) VALUES (?, ?, ?)'
      ).run(supplier_id, total, shipping == null || shipping === '' ? null : shipping).lastInsertRowid;

      const linkPp = db.prepare('INSERT INTO purchase_products (purchase_order_id, product_id, quantity, sort, is_new) VALUES (?, ?, ?, ?, ?)');
      const linkDev = db.prepare('INSERT OR IGNORE INTO product_devices (product_id, device_id) VALUES (?, ?)');
      const linkFeat = db.prepare('INSERT OR IGNORE INTO product_features (product_id, feature_id) VALUES (?, ?)');

      for (const u of updates) {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(u.product_id);
        const updateFields = u.update_fields || { ean: true, cost: true, supplier_name: true };
        const finalEan = updateFields.ean ? (u.ean || p.ean) : p.ean;
        const finalCost = updateFields.cost ? (u.cost != null ? u.cost : p.cost) : p.cost;
        const finalSupplier = updateFields.supplier_name ? (u.supplier_name || p.supplier_name) : p.supplier_name;
        const assignments = ['quantity = quantity + ?', 'is_archived = 0'];
        const values = [u.add_quantity];
        if (updateFields.ean) {
          assignments.push('ean = ?');
          values.push(finalEan);
        }
        if (updateFields.cost) {
          assignments.push('cost = ?');
          values.push(finalCost);
        }
        if (updateFields.supplier_name) {
          assignments.push('supplier_name = ?');
          values.push(finalSupplier);
        }
        values.push(u.product_id);
        db.prepare(`UPDATE products SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
        linkPp.run(purchaseOrderId, u.product_id, u.add_quantity, u.sort ?? 0, 0);
        const fields = {};
        if (updateFields.ean && String(p.ean ?? '') !== String(finalEan ?? '')) fields.ean = { old: p.ean, new: finalEan };
        if (updateFields.cost && Number(p.cost ?? 0) !== Number(finalCost ?? 0)) fields.cost = { old: p.cost, new: finalCost };
        if (updateFields.supplier_name && String(p.supplier_name ?? '') !== String(finalSupplier ?? '')) fields.supplier_name = { old: p.supplier_name, new: finalSupplier };
        updatedProducts.push({
          id: p.id, model: p.model, name: p.name, sku: p.sku,
          old_quantity: p.quantity, add_quantity: u.add_quantity,
          ean: finalEan, cost: finalCost, supplier_name: finalSupplier,
          fields
        });
      }

      for (const np of new_products) {
        const brandId = np.brand ? findOrCreateBrand(np.brand) : null;
        const categoryId = np.category ? findOrCreate('categories', np.category, 'categories') : null;
        const locationId = np.location ? findOrCreate('locations', np.location, 'locations') : null;
        const colorId = findOrCreateColor(np.color_id || np.color, createdEntities.colors);
        const info = db.prepare(`INSERT INTO products
          (model, name, ean, sku, color_id, quantity, price, cost, supplier_name, brand_id, category_id, supplier_id, location_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(np.model || null, np.name, np.ean, np.sku, colorId, np.quantity, np.price, np.cost,
               np.supplier_name || null, brandId, categoryId, supplier_id, locationId);
        linkPp.run(purchaseOrderId, info.lastInsertRowid, np.quantity, np.sort ?? 0, 1);
        const deviceIds = [...(np.device_ids || [])];
        for (const name of np.devices || []) {
          const existing = db.prepare('SELECT id FROM devices WHERE name = ? COLLATE NOCASE').get(name);
          const deviceId = existing ? existing.id
            : db.prepare('INSERT INTO devices (name, year) VALUES (?, ?)').run(name, new Date().getFullYear()).lastInsertRowid;
          if (!existing) createdEntities.devices.push(name);
          deviceIds.push(deviceId);
        }
        for (const deviceId of deviceIds) linkDev.run(info.lastInsertRowid, deviceId);
        const featureIds = [...(np.feature_ids || [])];
        for (const name of np.features || []) featureIds.push(findOrCreate('features', name, 'features'));
        for (const featureId of featureIds) linkFeat.run(info.lastInsertRowid, featureId);
        createdProducts.push({
          model: np.model || null, name: np.name, sku: np.sku, ean: np.ean || null,
          quantity: np.quantity, price: np.price, cost: np.cost
        });
      }
      return { id: purchaseOrderId, created: new_products.length, updated: updates.length, total };
    })();
    const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id).name;
    logHistory({
      entity_type: 'purchases', entity_id: result.id, action: 'import',
      label: `Purchase order #${result.id} — ${supplierName}`,
      snapshot: {
        supplier: supplierName, shipping: shipping ?? null, total: result.total,
        created: createdProducts,
        updated: updatedProducts,
        created_brands: createdEntities.brands,
        created_categories: createdEntities.categories,
        created_locations: createdEntities.locations,
        created_colors: createdEntities.colors,
        created_devices: createdEntities.devices,
        created_features: createdEntities.features
      }
    });
    res.status(201).json(result);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const m = /products\.(\w+)/.exec(e.message);
      return res.status(409).json({ error: `A product with this ${m ? m[1] : 'value'} already exists` });
    }
    throw e;
  }
});

module.exports = router;
