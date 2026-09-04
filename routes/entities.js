const express = require('express');
const db = require('../db');
const { logHistory } = require('../db');

const router = express.Router();

const TYPES = {
  devices: { table: 'devices', fields: ['name', 'year', 'short_name'], required: ['name', 'year'] },
  features: { table: 'features', fields: ['name'], required: ['name'] },
  brands: { table: 'brands', fields: ['name', 'price', 'cost'], required: ['name'] },
  categories: { table: 'categories', fields: ['name'], required: ['name'] },
  suppliers: { table: 'suppliers', fields: ['name', 'full_name'], required: ['name', 'full_name'] },
  locations: { table: 'locations', fields: ['name'], required: ['name'] }
};

const COUNT_EXPR = {
  devices: '(SELECT COUNT(*) FROM product_devices pd WHERE pd.device_id = t.id)',
  features: '(SELECT COUNT(*) FROM product_features pf WHERE pf.feature_id = t.id)',
  brands: '(SELECT COUNT(*) FROM products p WHERE p.brand_id = t.id)',
  categories: '(SELECT COUNT(*) FROM products p WHERE p.category_id = t.id)',
  suppliers: '(SELECT COUNT(*) FROM products p WHERE p.supplier_id = t.id)',
  locations: '(SELECT COUNT(*) FROM products p WHERE p.location_id = t.id)'
};

const EDITABLE = {
  devices: ['name', 'year', 'short_name'],
  features: ['name'],
  brands: ['name', 'price', 'cost'],
  categories: ['name'],
  suppliers: ['name', 'full_name'],
  locations: ['name']
};

router.get('/:type', (req, res) => {
  const t = TYPES[req.params.type];
  if (!t) return res.status(404).json({ error: 'Unknown entity type' });
  const q = (req.query.q || '').trim();
  const all = req.query.all === '1';
  const paginated = req.query.page !== undefined;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
  const countExpr = COUNT_EXPR[req.params.type] || '0';
  let sql = `SELECT t.*, ${countExpr} AS product_count FROM ${t.table} t`;
  const params = [];
  if (q) {
    sql += ` WHERE ${t.fields.map(f => `t.${f} LIKE ?`).join(' OR ')}`;
    t.fields.forEach(() => params.push(`%${q}%`));
  }
  sql += ' ORDER BY t.name';
  if (!paginated) {
    if (!all) sql += ' LIMIT 20';
    res.json(db.prepare(sql).all(...params));
    return;
  }
  const countSql = `SELECT COUNT(*) AS count FROM ${t.table} t${q ? ` WHERE ${t.fields.map(f => `t.${f} LIKE ?`).join(' OR ')}` : ''}`;
  const total = db.prepare(countSql).get(...params).count;
  sql += ' LIMIT ? OFFSET ?';
  res.json({ items: db.prepare(sql).all(...params, limit, (page - 1) * limit), total, page, limit });
});

// linked products per entity type
const LINKED_PRODUCTS = {
  devices: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p
           JOIN product_devices pd ON pd.product_id = p.id WHERE pd.device_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('DELETE FROM product_devices WHERE device_id = ? AND product_id = ?')
  },
  features: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p
           JOIN product_features pf ON pf.product_id = p.id WHERE pf.feature_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('DELETE FROM product_features WHERE feature_id = ? AND product_id = ?')
  },
  brands: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p WHERE p.brand_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('UPDATE products SET brand_id = NULL WHERE brand_id = ? AND id = ?')
  },
  categories: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p WHERE p.category_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND id = ?')
  },
  locations: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p WHERE p.location_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('UPDATE products SET location_id = NULL WHERE location_id = ? AND id = ?')
  },
  suppliers: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p WHERE p.supplier_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('UPDATE products SET supplier_id = NULL WHERE supplier_id = ? AND id = ?')
  }
};

// GET /api/entities/:type/:id/products — all products linked to this entity
router.get('/:type/:id/products', (req, res) => {
  const link = LINKED_PRODUCTS[req.params.type];
  if (!link) return res.status(404).json({ error: 'Unknown entity type' });
  const entity = db.prepare(`SELECT id, name FROM ${TYPES[req.params.type].table} WHERE id = ?`).get(Number(req.params.id));
  if (!entity) return res.status(404).json({ error: 'Record not found' });
  res.json({ entity, products: db.prepare(link.list).all(entity.id) });
});

// DELETE /api/entities/:type/:id/products/:pid — remove this entity from one product
router.delete('/:type/:id/products/:pid', (req, res) => {
  const link = LINKED_PRODUCTS[req.params.type];
  if (!link) return res.status(404).json({ error: 'Unknown entity type' });
  const info = link.unlink().run(Number(req.params.id), Number(req.params.pid));
  if (info.changes === 0) return res.status(404).json({ error: 'Product is not linked to this entity' });
  const entity = db.prepare(`SELECT name FROM ${TYPES[req.params.type].table} WHERE id = ?`).get(Number(req.params.id));
  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(Number(req.params.pid));
  if (entity && product) {
    logHistory({
      entity_type: req.params.type, entity_id: Number(req.params.id), action: 'update',
      label: entity.name,
      changes: { products: { old: `linked to "${product.name}"`, new: 'removed' } },
      snapshot: { note: `Removed from product "${product.name}"` }
    });
  }
  res.json({ ok: true });
});

// PUT /api/entities/:type/:id — update editable fields
router.put('/:type/:id', (req, res) => {
  const t = TYPES[req.params.type];
  const allowed = EDITABLE[req.params.type];
  if (!t || !allowed) return res.status(404).json({ error: 'Unknown entity type' });
  const sets = [], vals = [];
  for (const f of allowed) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  vals.push(Number(req.params.id));
  try {
    const before = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(Number(req.params.id));
    if (!before) return res.status(404).json({ error: 'Record not found' });
    const info = db.prepare(`UPDATE ${t.table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    const after = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(Number(req.params.id));
    const changes = {};
    for (const f of allowed) {
      if (String(before[f] ?? '') !== String(after[f] ?? '')) changes[f] = { old: before[f], new: after[f] };
    }
    if (Object.keys(changes).length) {
      logHistory({ entity_type: req.params.type, entity_id: after.id, action: 'update', label: after.name, changes, snapshot: before });
    }
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A record with this name already exists' });
    }
    throw e;
  }
});

// DELETE /api/entities/:type/:id — unlink from products, then remove the record
router.delete('/:type/:id', (req, res) => {
  const type = req.params.type;
  const t = TYPES[type];
  if (!t) return res.status(404).json({ error: 'Unknown entity type' });
  const id = Number(req.params.id);
  const unlink = {
    categories: () => db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id),
    locations: () => db.prepare('UPDATE products SET location_id = NULL WHERE location_id = ?').run(id),
    brands: () => db.prepare('UPDATE products SET brand_id = NULL WHERE brand_id = ?').run(id),
    suppliers: () => db.prepare('UPDATE products SET supplier_id = NULL WHERE supplier_id = ?').run(id),
    devices: () => db.prepare('DELETE FROM product_devices WHERE device_id = ?').run(id),
    features: () => db.prepare('DELETE FROM product_features WHERE feature_id = ?').run(id)
  }[type];
  try {
    const before = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(id);
    if (!before) return res.status(404).json({ error: 'Record not found' });
    const countList = db.prepare(linkListSql(type)).all(id);
    db.transaction(() => {
      unlink();
      const info = db.prepare(`DELETE FROM ${t.table} WHERE id = ?`).run(id);
      if (info.changes === 0) throw Object.assign(new Error('Record not found'), { status: 404 });
    })();
    logHistory({
      entity_type: type, entity_id: id, action: 'delete', label: before.name,
      snapshot: { ...before, product_count: countList.length, products: countList.map(p => p.name).slice(0, 50) }
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    throw e;
  }
});

function linkListSql(type) {
  return (LINKED_PRODUCTS[type] || { list: 'SELECT id, name FROM products WHERE 0' }).list
    .replace(/SELECT p\.id, p\.model, p\.name, p\.sku, p\.ean, p\.quantity/, 'SELECT p.id, p.name');
}

router.post('/:type', (req, res) => {  const t = TYPES[req.params.type];
  if (!t) return res.status(404).json({ error: 'Unknown entity type' });
  const body = req.body || {};
  for (const f of t.required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return res.status(400).json({ error: `Missing required field: ${f}` });
    }
  }
  const cols = [], vals = [];
  for (const f of t.fields) {
    if (body[f] !== undefined) { cols.push(f); vals.push(body[f]); }
  }
  try {
    const info = db.prepare(`INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    const row = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(info.lastInsertRowid);
    logHistory({ entity_type: req.params.type, entity_id: row.id, action: 'create', label: row.name, snapshot: row });
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = db.prepare(`SELECT * FROM ${t.table} WHERE name = ?`).get(body.name);
      return res.status(200).json(existing);
    }
    throw e;
  }
});

module.exports = router;
