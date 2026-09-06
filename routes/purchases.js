const express = require('express');
const db = require('../db');
const { logHistory } = require('../db');
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
  res.json(db.prepare(`
    SELECT po.id, po.total, po.shipping, datetime(po.created_at, 'localtime') AS created_at, s.name AS supplier,
      (SELECT COALESCE(SUM(quantity), 0) FROM purchase_products pp WHERE pp.purchase_order_id = po.id) AS item_count
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.id DESC`).all());
});

// ---------- detail ----------
router.get('/:id', (req, res) => {
  const po = db.prepare(`
    SELECT po.id, po.total, po.shipping, datetime(po.created_at, 'localtime') AS created_at, s.name AS supplier
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?`).get(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
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
  const createdEntities = { brands: [], categories: [], locations: [] };
  const findOrCreate = (table, name, createdKey) => {
    const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name);
    if (row) return row.id;
    const id = db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid;
    createdEntities[createdKey].push(name);
    return id;
  };

  // new brands are created with a suggested sale price taken from their products
  const findOrCreateBrand = name => {
    const row = db.prepare('SELECT id FROM brands WHERE name = ?').get(name);
    if (row) return row.id;
    const id = db.prepare('INSERT INTO brands (name, price) VALUES (?, ?)')
      .run(name, brand_prices[name] != null ? brand_prices[name] : null).lastInsertRowid;
    createdEntities.brands.push(name);
    return id;
  };

  try {
    const result = db.transaction(() => {
      let total = 0;
      for (const u of updates) total += (u.purchase_price || 0) * u.add_quantity;
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
        const assignments = ['quantity = quantity + ?', 'is_archived = 0'];
        const values = [u.add_quantity];
        if (updateFields.ean) {
          assignments.push('ean = ?');
          values.push(u.ean || p.ean);
        }
        if (updateFields.cost) {
          assignments.push('cost = ?');
          values.push(u.cost != null ? u.cost : p.cost);
        }
        if (updateFields.supplier_name) {
          assignments.push('supplier_name = ?');
          values.push(u.supplier_name || p.supplier_name);
        }
        values.push(u.product_id);
        db.prepare(`UPDATE products SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
        linkPp.run(purchaseOrderId, u.product_id, u.add_quantity, u.sort ?? 0, 0);
      }

      for (const np of new_products) {
        const brandId = np.brand ? findOrCreateBrand(np.brand) : null;
        const categoryId = np.category ? findOrCreate('categories', np.category, 'categories') : null;
        const locationId = np.location ? findOrCreate('locations', np.location, 'locations') : null;
        const info = db.prepare(`INSERT INTO products
          (model, name, ean, sku, color, quantity, price, cost, supplier_name, brand_id, category_id, supplier_id, location_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(np.model || null, np.name, np.ean, np.sku, np.color, np.quantity, np.price, np.cost,
               np.supplier_name || null, brandId, categoryId, supplier_id, locationId);
        linkPp.run(purchaseOrderId, info.lastInsertRowid, np.quantity, np.sort ?? 0, 1);
        for (const deviceId of np.device_ids || []) linkDev.run(info.lastInsertRowid, deviceId);
        for (const featureId of np.feature_ids || []) linkFeat.run(info.lastInsertRowid, featureId);
      }
      return { id: purchaseOrderId, created: new_products.length, updated: updates.length, total };
    })();
    const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplier_id).name;
    logHistory({
      entity_type: 'purchases', entity_id: result.id, action: 'import',
      label: `Purchase order #${result.id} — ${supplierName}`,
      snapshot: {
        supplier: supplierName, shipping: shipping ?? null, total: result.total,
        created: new_products.map(np => `${np.name} (${np.sku}) × ${np.quantity}`),
        updated: updates.map(u => `#${u.product_id} +${u.add_quantity}`),
        created_brands: createdEntities.brands,
        created_categories: createdEntities.categories,
        created_locations: createdEntities.locations
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
