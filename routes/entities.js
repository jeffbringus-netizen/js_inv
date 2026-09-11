const express = require('express');
const db = require('../db');
const { logHistory } = require('../db');
const { decomposeDevice } = require('../device-parts');

const router = express.Router();

// devices identify by full_name (composed from brand/series/model); every
// other entity type uses a plain name column
const NAME_COL = { devices: 'full_name' };
const nameCol = type => NAME_COL[type] || 'name';
const fullNameOf = (type, row) => row ? (row[nameCol(type)] ?? row.name) : '';

const TYPES = {
  devices: { table: 'devices', fields: ['full_name', 'year', 'model', 'brand', 'series', 'short_name'], required: ['year'] },
  features: { table: 'features', fields: ['name'], required: ['name'] },
  brands: { table: 'brands', fields: ['name', 'price', 'cost'], required: ['name'] },
  categories: { table: 'categories', fields: ['name'], required: ['name'] },
  suppliers: { table: 'suppliers', fields: ['name', 'full_name'], required: ['name', 'full_name'] },
  locations: { table: 'locations', fields: ['name'], required: ['name'] },
  colors: { table: 'colors', fields: ['name', 'tag_color', 'tag_text', 'tag_border'], required: ['name', 'tag_color', 'tag_text', 'tag_border'] }
};

const COUNT_EXPR = {
  devices: '(SELECT COUNT(*) FROM product_devices pd WHERE pd.device_id = t.id)',
  features: '(SELECT COUNT(*) FROM product_features pf WHERE pf.feature_id = t.id)',
  brands: '(SELECT COUNT(*) FROM products p WHERE p.brand_id = t.id)',
  categories: '(SELECT COUNT(*) FROM products p WHERE p.category_id = t.id)',
  suppliers: '(SELECT COUNT(*) FROM products p WHERE p.supplier_id = t.id)',
  locations: '(SELECT COUNT(*) FROM products p WHERE p.location_id = t.id)',
  colors: '(SELECT COUNT(*) FROM products p WHERE p.color_id = t.id)'
};

const EDITABLE = {
  devices: ['full_name', 'year', 'model', 'brand', 'series', 'short_name'],
  features: ['name'],
  brands: ['name', 'price', 'cost'],
  categories: ['name'],
  suppliers: ['name', 'full_name'],
  locations: ['name'],
  colors: ['name', 'tag_color', 'tag_text', 'tag_border']
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
  const nc = nameCol(req.params.type);
  // devices expose full_name AS name so shared consumers (autocomplete, lists)
  // can treat every entity uniformly
  const nameAlias = req.params.type === 'devices' ? `, t.full_name AS name` : '';
  let sql = `SELECT t.*, ${countExpr} AS product_count${nameAlias} FROM ${t.table} t`;
  const params = [];
  if (q) {
    sql += ` WHERE ${t.fields.map(f => `t.${f} LIKE ?`).join(' OR ')}`;
    t.fields.forEach(() => params.push(`%${q}%`));
  }
  sql += ` ORDER BY natural_key(t.${nc}), t.${nc}`;
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
  colors: {
    list: `SELECT p.id, p.model, p.name, p.sku, p.ean, p.quantity FROM products p WHERE p.color_id = ? ORDER BY p.name`,
    unlink: () => db.prepare('UPDATE products SET color_id = NULL WHERE color_id = ? AND id = ?')
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
  const entity = db.prepare(`SELECT id, ${nameCol(req.params.type)} AS name FROM ${TYPES[req.params.type].table} WHERE id = ?`).get(Number(req.params.id));
  if (!entity) return res.status(404).json({ error: 'Record not found' });
  res.json({ entity, products: db.prepare(link.list).all(entity.id) });
});

// DELETE /api/entities/:type/:id/products/:pid — remove this entity from one product
router.delete('/:type/:id/products/:pid', (req, res) => {
  const link = LINKED_PRODUCTS[req.params.type];
  if (!link) return res.status(404).json({ error: 'Unknown entity type' });
  const info = link.unlink().run(Number(req.params.id), Number(req.params.pid));
  if (info.changes === 0) return res.status(404).json({ error: 'Product is not linked to this entity' });
  const entity = db.prepare(`SELECT ${nameCol(req.params.type)} AS name FROM ${TYPES[req.params.type].table} WHERE id = ?`).get(Number(req.params.id));
  const removed = productById(Number(req.params.pid));
  if (entity && removed) {
    logHistory({
      entity_type: req.params.type, entity_id: Number(req.params.id), action: 'update',
      label: entity.name,
      changes: { removed: [productLabel(removed)] },
      snapshot: { removed: [removed], all: linkedProductRows(req.params.type, Number(req.params.id)) }
    });
  }
  res.json({ ok: true });
});

// PUT /api/entities/devices/:id/products — add/remove products on a device in one action
// { add: [productIds], remove: [productIds] }
router.put('/:type/:id/products', (req, res) => {
  const type = req.params.type;
  if (type !== 'devices') return res.status(400).json({ error: 'Only devices support product sync' });
  const id = Number(req.params.id);
  const entity = db.prepare('SELECT id, full_name AS name FROM devices WHERE id = ?').get(id);
  if (!entity) return res.status(404).json({ error: 'Record not found' });
  const add = Array.isArray(req.body.add) ? req.body.add.map(Number) : [];
  const remove = Array.isArray(req.body.remove) ? req.body.remove.map(Number) : [];
  const linked = new Set(linkedProductRows(type, id).map(p => p.id));
  const removedIds = [...new Set(remove)].filter(pid => linked.has(pid));
  const addedIds = [...new Set(add)].filter(pid => !linked.has(pid) &&
    db.prepare('SELECT id FROM products WHERE id = ?').get(pid));
  if (removedIds.length === 0 && addedIds.length === 0) {
    return res.json({ ok: true, removed: 0, added: 0 });
  }
  const del = db.prepare('DELETE FROM product_devices WHERE device_id = ? AND product_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO product_devices (device_id, product_id) VALUES (?, ?)');
  db.transaction(() => {
    for (const pid of removedIds) del.run(id, pid);
    for (const pid of addedIds) ins.run(id, pid);
  })();
  const rows = ids => ids.map(pid => productById(pid)).filter(Boolean);
  const removed = rows(removedIds);
  const added = rows(addedIds);
  const changes = {};
  if (removed.length) changes.removed = removed.map(productLabel);
  if (added.length) changes.added = added.map(productLabel);
  logHistory({
    entity_type: 'devices', entity_id: id, action: 'update', label: entity.name,
    changes, snapshot: { removed, added, all: linkedProductRows(type, id) }
  });
  res.json({ ok: true, removed: removed.length, added: added.length });
});

// PUT /api/entities/:type/:id — update editable fields
router.put('/:type/:id', (req, res) => {
  const type = req.params.type;
  const t = TYPES[type];
  const allowed = EDITABLE[type];
  if (!t || !allowed) return res.status(404).json({ error: 'Unknown entity type' });
  const nc = nameCol(type);
  try {
    const before = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(Number(req.params.id));
    if (!before) return res.status(404).json({ error: 'Record not found' });
    const body = { ...req.body };

    // devices: the full name is composed from brand/series/model, never typed
    if (type === 'devices') {
      for (const f of ['brand', 'series', 'model', 'short_name']) {
        if (body[f] !== undefined) body[f] = String(body[f]).trim();
      }
      if (['brand', 'series', 'model', 'full_name'].some(f => body[f] !== undefined)) {
        const composite = [body.brand ?? before.brand, body.series ?? before.series, body.model ?? before.model]
          .map(s => String(s ?? '').trim()).filter(Boolean).join(' ');
        if (!composite) return res.status(400).json({ error: 'Full name (brand/series/model) cannot be empty' });
        body.full_name = composite;
        body.brand = body.brand ?? before.brand;
        body.series = body.series ?? before.series;
        body.model = body.model ?? before.model;
      }
    }

    const sets = [], vals = [];
    for (const f of allowed) {
      if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(Number(req.params.id));

    // case-insensitive uniqueness against OTHER records (own name may change case)
    const dupOf = (field, value) => value == null || value === '' ? null
      : db.prepare(`SELECT * FROM ${t.table} WHERE ${field} = ? COLLATE NOCASE AND id != ?`).get(value, Number(req.params.id));
    const newName = body[nc] !== undefined ? body[nc] : before[nc];
    const dup = dupOf(nc, newName)
      || (type === 'suppliers' && body.full_name !== undefined ? dupOf('full_name', body.full_name) : null);
    if (dup) {
      return res.status(409).json({
        error: `${type.slice(0, -1)} "${fullNameOf(type, dup)}" already exists`,
        existing: dup
      });
    }
    const info = db.prepare(`UPDATE ${t.table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    if (info.changes === 0) return res.status(404).json({ error: 'Record not found' });
    const after = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(Number(req.params.id));
    const changes = {};
    for (const f of allowed) {
      if (String(before[f] ?? '') !== String(after[f] ?? '')) changes[f] = { old: before[f], new: after[f] };
    }
    if (Object.keys(changes).length) {
      logHistory({ entity_type: type, entity_id: after.id, action: 'update', label: fullNameOf(type, after), changes, snapshot: before });
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
    features: () => db.prepare('DELETE FROM product_features WHERE feature_id = ?').run(id),
    colors: () => db.prepare('UPDATE products SET color_id = NULL WHERE color_id = ?').run(id)
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
      entity_type: type, entity_id: id, action: 'delete', label: fullNameOf(type, before),
      snapshot: { ...before, product_count: countList.length, products: countList.slice(0, 50) }
    });
    res.json({ ok: true });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: e.message });
    throw e;
  }
});

function linkListSql(type) {
  return (LINKED_PRODUCTS[type] || { list: 'SELECT id, name FROM products WHERE 0' }).list
    .replace(/SELECT p\.id, p\.model, p\.name, p\.sku, p\.ean, p\.quantity/, 'SELECT p.id, p.model, p.name, p.sku, p.ean');
}

const productLabel = p => p.model ? `${p.model} - ${p.name}` : p.name;

function productById(id) {
  return db.prepare('SELECT id, model, name, sku, ean FROM products WHERE id = ?').get(id);
}

function linkedProductRows(type, id) {
  if (!LINKED_PRODUCTS[type]) return [];
  return db.prepare(linkListSql(type)).all(id);
}

router.post('/:type', (req, res) => {
  const type = req.params.type;
  const t = TYPES[type];
  if (!t) return res.status(404).json({ error: 'Unknown entity type' });
  const nc = nameCol(type);
  const body = { ...(req.body || {}) };
  for (const f of t.required) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return res.status(400).json({ error: `Missing required field: ${f}` });
    }
  }
  // devices: compose the full name from brand/series/model (the autocomplete
  // create-on-Enter path sends a ready full name in `name`)
  if (type === 'devices') {
    for (const f of ['brand', 'series', 'model', 'short_name']) {
      if (body[f] !== undefined) body[f] = String(body[f]).trim();
    }
    if (!body.full_name && body.name) body.full_name = String(body.name).trim();
    // name-only create (typing a new device in a product modal): split it into
    // brand/series/model with the shared rules; unknown names keep the typed
    // value as the model
    if (body.name && body.brand === undefined && body.series === undefined && body.model === undefined) {
      const parts = decomposeDevice(body.name);
      body.brand = parts.brand;
      body.series = parts.series;
      body.model = parts.model || body.name;
    }
    if (!body.full_name) {
      body.full_name = [body.brand, body.series, body.model]
        .map(s => String(s ?? '').trim()).filter(Boolean).join(' ');
    }
    if (!body.full_name) {
      return res.status(400).json({ error: 'Full name (brand/series/model) is required' });
    }
  }
  const cols = [], vals = [];
  for (const f of t.fields) {
    if (body[f] !== undefined) { cols.push(f); vals.push(body[f]); }
  }
  // entity names are unique per type, case-insensitively ("Honor 400 lite" == "Honor 400 Lite")
  let dup = db.prepare(`SELECT * FROM ${t.table} WHERE ${nc} = ? COLLATE NOCASE`).get(type === 'devices' ? body.full_name : body.name);
  if (!dup && type === 'suppliers' && body.full_name) {
    dup = db.prepare(`SELECT * FROM ${t.table} WHERE full_name = ? COLLATE NOCASE`).get(body.full_name);
  }
  if (dup) {
    return res.status(409).json({
      error: `${type.slice(0, -1)} "${fullNameOf(type, dup)}" already exists`,
      existing: dup
    });
  }
  try {
    const info = db.prepare(`INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
    const row = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(info.lastInsertRowid);
    logHistory({ entity_type: type, entity_id: row.id, action: 'create', label: fullNameOf(type, row), snapshot: row });
    if (type === 'devices') row.name = row.full_name; // uniform shape for the autocomplete
    res.status(201).json(row);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = db.prepare(`SELECT * FROM ${t.table} WHERE ${nc} = ? COLLATE NOCASE`).get(type === 'devices' ? body.full_name : body.name);
      return res.status(409).json({
        error: `${type.slice(0, -1)} "${existing ? fullNameOf(type, existing) : fullNameOf(type, body)}" already exists`,
        existing: existing || null
      });
    }
    if (e.code === 'SQLITE_CONSTRAINT_NOTNULL') {
      const column = (e.message || '').split(': ').pop();
      return res.status(400).json({ error: `Missing required field: ${column}` });
    }
    throw e;
  }
});

module.exports = router;
