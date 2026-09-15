const express = require('express');
const db = require('../db');
const { logHistory, findOrCreateColor } = require('../db');

const router = express.Router();

const SELECT_PRODUCTS = `
  SELECT p.*, col.name AS color_name, col.tag_color, col.tag_text, col.tag_border,
    b.name AS brand, b.price AS brand_price, b.cost AS brand_cost,
    c.name AS category, s.name AS supplier, l.name AS location
  FROM products p
  LEFT JOIN colors col ON col.id = p.color_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN locations l ON l.id = p.location_id
`;

function attachRelations(products) {
  const ids = products.map(p => p.id);
  if (ids.length === 0) return products;
  const placeholders = ids.map(() => '?').join(',');
  const devices = db.prepare(`
    SELECT pd.product_id, d.id, d.full_name, d.model, d.short_name, d.year FROM product_devices pd
    JOIN devices d ON d.id = pd.device_id WHERE pd.product_id IN (${placeholders})`).all(...ids);
  const features = db.prepare(`
    SELECT pf.product_id, f.id, f.name FROM product_features pf
    JOIN features f ON f.id = pf.feature_id WHERE pf.product_id IN (${placeholders})`).all(...ids);
  const devMap = new Map(), featMap = new Map();
  for (const d of devices) {
    if (!devMap.has(d.product_id)) devMap.set(d.product_id, []);
    devMap.get(d.product_id).push({ id: d.id, full_name: d.full_name, model: d.model, short_name: d.short_name, year: d.year });
  }
  for (const f of features) {
    if (!featMap.has(f.product_id)) featMap.set(f.product_id, []);
    featMap.get(f.product_id).push({ id: f.id, name: f.name });
  }
  for (const p of products) {
    p.devices = devMap.get(p.id) || [];
    p.features = featMap.get(p.id) || [];
  }
  return products;
}

function getFullProduct(id) {
  const rows = db.prepare(SELECT_PRODUCTS + ' WHERE p.id = ?').all(id);
  if (rows.length === 0) return null;
  return attachRelations(rows)[0];
}

function resolveColorId(value) {
  // creating a color here is logged by the db controller (colors/create)
  return findOrCreateColor(value);
}

const HISTORY_FIELDS = ['model', 'name', 'ean', 'sku', 'color_name', 'quantity', 'price', 'cost',
  'supplier_name', 'brand', 'category', 'supplier', 'location', 'is_online', 'is_archived'];

function diffProducts(before, after) {
  const changes = {};
  for (const f of HISTORY_FIELDS) {
    if (String(before[f] ?? '') !== String(after[f] ?? '')) changes[f] = { old: before[f], new: after[f] };
  }
  for (const [f, key] of [['devices', 'devices'], ['features', 'features']]) {
    const a = before[key].map(x => x.full_name ?? x.name).sort().join(', ');
    const b = after[key].map(x => x.full_name ?? x.name).sort().join(', ');
    if (a !== b) changes[f] = { old: a, new: b };
  }
  return changes;
}

// GET /api/products?q=...
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const paginated = req.query.page !== undefined;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
  const sortExpressions = {
    location: 'natural_key(l.name)', model: 'p.model', name: 'p.name', category: 'natural_key(c.name)',
    brand: 'natural_key(b.name)', sku: 'p.sku', color: 'natural_key(col.name)', quantity: 'p.quantity',
    price: 'p.price', margin: 'CASE WHEN p.cost > 0 THEN (p.price / 1.2) / p.cost END'
  };
  const sortExpression = sortExpressions[req.query.sort] || 'p.id';
  const sortDirection = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const includeArchived = req.query.includeArchived === '1';
  const where = [];
  const params = [];
  if (!includeArchived) where.push('p.is_archived = 0');
  const exactFilters = {
    location: 'l.name',
    category: 'c.name',
    brand: 'b.name',
    supplier: 's.name',
    color: 'col.name'
  };
  for (const [key, column] of Object.entries(exactFilters)) {
    const value = String(req.query[`filter_${key}`] || '').trim();
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const deviceFilter = String(req.query.filter_device || '').trim();
  if (deviceFilter) {
    where.push(`EXISTS (
      SELECT 1 FROM product_devices pfd
      JOIN devices fd ON fd.id = pfd.device_id
      WHERE pfd.product_id = p.id AND (fd.full_name = ? OR fd.model = ?)
    )`);
    params.push(deviceFilter, deviceFilter);
  }
  const featureFilter = String(req.query.filter_feature || '').trim();
  if (featureFilter) {
    where.push(`EXISTS (
      SELECT 1 FROM product_features pff
      JOIN features ff ON ff.id = pff.feature_id
      WHERE pff.product_id = p.id AND ff.name = ?
    )`);
    params.push(featureFilter);
  }
  if (q) {
    const searchTerms = q.split(/\s+/).filter(Boolean);
    const searchColumns = `
      LOWER(COALESCE(p.model, '')) LIKE ? OR LOWER(p.name) LIKE ? OR
      LOWER(COALESCE(p.ean, '')) LIKE ? OR LOWER(p.sku) LIKE ? OR
      LOWER(COALESCE(col.name, '')) LIKE ? OR LOWER(COALESCE(p.supplier_name, '')) LIKE ? OR
      LOWER(COALESCE(b.name, '')) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ? OR
      LOWER(COALESCE(s.name, '')) LIKE ? OR LOWER(COALESCE(l.name, '')) LIKE ? OR
      CAST(p.quantity AS TEXT) LIKE ? OR CAST(p.price AS TEXT) LIKE ? OR CAST(p.cost AS TEXT) LIKE ? OR
      EXISTS (SELECT 1 FROM product_devices pdq JOIN devices dq ON dq.id = pdq.device_id WHERE pdq.product_id = p.id AND (LOWER(dq.full_name) LIKE ? OR LOWER(COALESCE(dq.model, '')) LIKE ?)) OR
      EXISTS (SELECT 1 FROM product_features pfq JOIN features fq ON fq.id = pfq.feature_id WHERE pfq.product_id = p.id AND LOWER(fq.name) LIKE ?)
    `;
    where.push(searchTerms.map(term => `(${searchColumns})`).join(' AND '));
    for (const term of searchTerms) params.push(...Array(16).fill(`%${term}%`));
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const fromSql = ` FROM products p
    LEFT JOIN colors col ON col.id = p.color_id
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN locations l ON l.id = p.location_id`;
  if (!paginated) {
    let products = db.prepare(SELECT_PRODUCTS + ' ORDER BY p.id').all();
    products = attachRelations(products);
    res.json(products);
    return;
  }
  const total = db.prepare(`SELECT COUNT(*) AS count${fromSql}${whereSql}`).get(...params).count;
  const archivedWhere = [...where.filter(condition => condition !== 'p.is_archived = 0'), 'p.is_archived = 1'];
  const archivedWhereSql = ` WHERE ${archivedWhere.join(' AND ')}`;
  const archivedTotal = db.prepare(`SELECT COUNT(*) AS count${fromSql}${archivedWhereSql}`).get(...params).count;
  const offset = (page - 1) * limit;
  const orderBy = `CASE WHEN (${sortExpression}) IS NULL THEN 1 ELSE 0 END ASC, ${sortExpression} ${sortDirection}, p.id ASC`;
  const products = db.prepare(`${SELECT_PRODUCTS}${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ items: attachRelations(products), total, archivedTotal, page, limit });
});

function saveRelations(productId, deviceIds, featureIds) {
  const insD = db.prepare('INSERT OR IGNORE INTO product_devices (product_id, device_id) VALUES (?, ?)');
  const insF = db.prepare('INSERT OR IGNORE INTO product_features (product_id, feature_id) VALUES (?, ?)');
  if (deviceIds !== null && deviceIds !== undefined) {
    deviceIds = Array.isArray(deviceIds) ? deviceIds : [deviceIds];
    db.prepare('DELETE FROM product_devices WHERE product_id = ?').run(productId);
    for (const id of deviceIds) insD.run(productId, id);
  }
  if (featureIds !== null && featureIds !== undefined) {
    featureIds = Array.isArray(featureIds) ? featureIds : [featureIds];
    db.prepare('DELETE FROM product_features WHERE product_id = ?').run(productId);
    for (const id of featureIds) insF.run(productId, id);
  }
}

const REQUIRED = ['name', 'sku', 'quantity', 'price', 'cost'];
const FIELDS = ['model', 'name', 'ean', 'sku', 'color_id', 'quantity', 'price', 'cost', 'supplier_name', 'is_online', 'is_archived', 'brand_id', 'category_id', 'supplier_id', 'location_id'];

function validate(body) {
  for (const f of REQUIRED) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      return `Missing required field: ${f}`;
    }
  }
  return null;
}

function normalize(body) {
  const params = {};
  for (const f of FIELDS) {
    const v = body[f];
    params[f] = (v === undefined || v === '') ? null : v;
  }
  params.is_online = (body.is_online === 1 || body.is_online === '1' || body.is_online === true || body.is_online === 'on') ? 1 : 0;
  params.is_archived = (body.is_archived === 1 || body.is_archived === '1' || body.is_archived === true || body.is_archived === 'on') ? 1 : 0;
  params.color_id = resolveColorId(body.color_id ?? body.color);
  return params;
}

function uniqueError(err) {
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    const m = /products\.(\w+)/.exec(err.message);
    return m ? `A product with this ${m[1]} already exists` : 'Unique constraint violation';
  }
  return null;
}

function historyLabel(p) {
  return p.model ? `${p.model} — ${p.name}` : p.name;
}

// POST /api/products/mass-update — apply shared changes to many products.
// { ids, patch: {quantity, price, cost, category_id, brand_id, supplier_id, location_id},
//   device_ids?, feature_ids? } — omitted patch keys are left unchanged;
// device_ids/feature_ids, when sent, REPLACE every product's list.
router.post('/mass-update', (req, res) => {
  const { ids, patch = {} } = req.body;
  if (patch.color !== undefined && patch.color_id === undefined) patch.color_id = resolveColorId(patch.color);
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No products selected' });
  const ALLOWED = ['quantity', 'price', 'cost', 'color_id', 'is_online', 'is_archived', 'category_id', 'brand_id', 'supplier_id', 'location_id'];
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (patch[k] !== undefined && patch[k] !== null && patch[k] !== '') { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  const hasDeviceIds = Array.isArray(req.body.device_ids);
  const hasFeatureIds = Array.isArray(req.body.feature_ids);
  if (sets.length === 0 && !hasDeviceIds && !hasFeatureIds) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  let validIds = ids.filter(id => db.prepare('SELECT id FROM products WHERE id = ?').get(id));
  if (validIds.length === 0) return res.status(404).json({ error: 'Products not found' });
  const settingOnline = patch.is_online === 1 || patch.is_online === '1' || patch.is_online === true;
  if (settingOnline) validIds = validIds.filter(id => db.prepare('SELECT model FROM products WHERE id = ?').get(id).model);
  if (validIds.length === 0) return res.status(400).json({ error: 'No selected products can be set online' });

  // snapshot every product's relevant fields BEFORE the update so the history
  // info popup can show what each product changed from
  const before = validIds.map(id => {
    const p = getFullProduct(id);
    return {
      id: p.id,
      label: historyLabel(p),
      location: p.location, brand: p.brand, category: p.category, supplier: p.supplier,
      color: p.color_name,
      quantity: p.quantity, price: p.price, cost: p.cost, is_online: p.is_online, is_archived: p.is_archived,
      devices: p.devices.map(d => d.full_name ?? d.name).join(', '), features: p.features.map(f => f.name).join(', ')
    };
  });

  const TABLE_BY_KEY = {
    category_id: 'categories', brand_id: 'brands', supplier_id: 'suppliers', location_id: 'locations', color_id: 'colors'
  };
  for (const [key, table] of Object.entries(TABLE_BY_KEY)) {
    if (patch[key] !== undefined && patch[key] !== null && patch[key] !== '' && !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(patch[key])) {
      return res.status(400).json({ error: `Unknown ${key.replace('_id', '')}` });
    }
  }
  for (const [key, table] of [['device_ids', 'devices'], ['feature_ids', 'features']]) {
    if (!Array.isArray(req.body[key])) continue;
    const unknown = req.body[key].find(id => !db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id));
    if (unknown !== undefined) return res.status(400).json({ error: `Unknown ${table.slice(0, -1)} id ${unknown}` });
  }
  const entityName = (table, id) => {
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id);
    return row ? row.name : id;
  };
  const changes = {};
  const appliedCandidates = {};
  for (const k of ALLOWED) {
    if (patch[k] === undefined || patch[k] === null || patch[k] === '') continue;
    const displayKey = k.endsWith('_id') ? k.replace('_id', '') : k;
    let newVal = patch[k];
    if (k.endsWith('_id')) newVal = entityName(TABLE_BY_KEY[k], patch[k]);
    if (k === 'is_online') newVal = patch[k] == 1 || patch[k] === '1' ? 'online' : 'offline';
    if (k === 'is_archived') newVal = patch[k] == 1 || patch[k] === '1' ? 'archived' : 'active';
    appliedCandidates[displayKey] = newVal;
  }
  const namesFor = (table, ids) => ids.map(id => {
    const displayColumn = table === 'devices' ? 'full_name' : 'name';
    const row = db.prepare(`SELECT ${displayColumn} AS name FROM ${table} WHERE id = ?`).get(id);
    return row ? row.name : `#${id}`;
  }).sort().join(', ');
  if (hasDeviceIds) appliedCandidates.devices = namesFor('devices', req.body.device_ids);
  if (hasFeatureIds) appliedCandidates.features = namesFor('features', req.body.feature_ids);

  // only keep fields where at least one product's value actually changes —
  // e.g. replacing empty devices with an empty selection is not a change
  const norm = (k, v) => {
    if (v === null || v === undefined) return '';
    if (k === 'devices' || k === 'features') {
      return String(v).split(',').map(s => s.trim()).filter(Boolean).sort().join(', ');
    }
    if (k === 'is_online') return (v === 1 || v === '1' || v === 'online') ? 'online' : 'offline';
    if (k === 'is_archived') return (v === 1 || v === '1' || v === 'archived') ? 'archived' : 'active';
    return String(v);
  };
  const applied = {};
  for (const [k, newVal] of Object.entries(appliedCandidates)) {
    if (before.some(b => norm(k, b[k]) !== norm(k, newVal))) applied[k] = newVal;
  }
  if (Object.keys(applied).length === 0) {
    return res.json({ ok: true, updated: validIds.length, skipped: 'nothing actually changed' });
  }
  for (const [k, v] of Object.entries(applied)) changes[k] = { old: '(varies)', new: v };

  db.transaction(() => {
    const upd = sets.length ? db.prepare(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`) : null;
    for (const id of validIds) {
      if (upd) upd.run(...vals, id);
      if (hasDeviceIds) saveRelations(id, req.body.device_ids, hasFeatureIds ? req.body.feature_ids : undefined);
      else if (hasFeatureIds) saveRelations(id, null, req.body.feature_ids);
    }
  })();
  const keys = Object.keys(applied);
  const label = `Mass update — ${validIds.length} product${validIds.length === 1 ? '' : 's'}` +
    (keys.length === 1 ? ` "${keys[0]}"` : ` (${keys.length} fields)`);
  logHistory({
    entity_type: 'products', entity_id: null, action: 'update',
    label,
    changes,
    snapshot: {
      applied: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.new])),
      before
    }
  });
  res.json({ ok: true, updated: validIds.length });
});

router.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const cols = FIELDS.map(f => `@${f}`).join(', ');
  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`INSERT INTO products (${FIELDS.join(', ')}) VALUES (${cols})`).run(normalize(req.body));
      saveRelations(info.lastInsertRowid, req.body.device_ids, req.body.feature_ids);
      return info.lastInsertRowid;
    });
    const id = tx();
    const full = getFullProduct(id);
    logHistory({ entity_type: 'products', entity_id: id, action: 'create', label: historyLabel(full), snapshot: full });
    res.status(201).json({ id });
  } catch (e) {
    const msg = uniqueError(e);
    if (msg) return res.status(409).json({ error: msg });
    throw e;
  }
});

router.put('/:id', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const sets = FIELDS.map(f => `${f} = @${f}`).join(', ');
  const before = getFullProduct(Number(req.params.id));
  if (!before) return res.status(404).json({ error: 'Product not found' });
  try {
    const tx = db.transaction(() => {
      const info = db.prepare(`UPDATE products SET ${sets} WHERE id = @id`).run({ ...normalize(req.body), id: Number(req.params.id) });
      if (info.changes === 0) return false;
      saveRelations(Number(req.params.id), req.body.device_ids, req.body.feature_ids);
      return true;
    });
    if (!tx()) return res.status(404).json({ error: 'Product not found' });
    const after = getFullProduct(Number(req.params.id));
    const changes = diffProducts(before, after);
    if (Object.keys(changes).length) {
      logHistory({ entity_type: 'products', entity_id: after.id, action: 'update', label: historyLabel(after), changes, snapshot: before });
    }
    res.json({ ok: true });
  } catch (e) {
    const msg = uniqueError(e);
    if (msg) return res.status(409).json({ error: msg });
    throw e;
  }
});

router.delete('/:id', (req, res) => {
  const before = getFullProduct(Number(req.params.id));
  if (!before) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  logHistory({ entity_type: 'products', entity_id: before.id, action: 'delete', label: historyLabel(before), snapshot: before });
  res.json({ ok: true });
});

// GET /api/products/next-model
router.get('/next-model', (req, res) => {
  const rows = db.prepare('SELECT model FROM products WHERE model IS NOT NULL').all();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.model, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  res.json({ model: String(max + 1) });
});

router.get('/:id', (req, res) => {
  const product = getFullProduct(Number(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

module.exports = router;
