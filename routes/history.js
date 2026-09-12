const express = require('express');
const db = require('../db');
const { toLocaltime } = require('../time');

const router = express.Router();

const ENTITY_PRODUCT_TYPES = new Set(['devices', 'features', 'brands', 'categories', 'suppliers', 'locations', 'colors']);

function listContainsProduct(value, productId) {
  return Array.isArray(value) && value.some(item => Number(item?.id ?? item?.product_id) === productId);
}

function matchesHistory(row, productId, relatedToEntity) {
  if (row.entity_type === 'products') return Number(row.entity_id) === productId;
  if (row.entity_type === 'sales') {
    const realMovement = row.action === 'complete' || (row.action === 'cancel' && row.snapshot?.stock_restored === true);
    return realMovement && listContainsProduct(row.snapshot?.items, productId);
  }
  if (row.entity_type === 'purchases') {
    return listContainsProduct(row.snapshot?.created, productId) || listContainsProduct(row.snapshot?.updated, productId);
  }
  if (!ENTITY_PRODUCT_TYPES.has(row.entity_type)) return false;
  if (listContainsProduct(row.snapshot?.added, productId) || listContainsProduct(row.snapshot?.removed, productId)) return true;
  if (row.action === 'delete' && listContainsProduct(row.snapshot?.products, productId)) return true;
  return row.action === 'update' && relatedToEntity(row.entity_type, row.entity_id);
}

// GET /api/history/product/:id?type=products|sales|...
router.get('/product/:id', (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product id' });
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const relatedToEntity = (entityType, entityId) => {
    if (entityType === 'devices') return Boolean(db.prepare('SELECT 1 FROM product_devices WHERE product_id = ? AND device_id = ?').get(productId, entityId));
    if (entityType === 'features') return Boolean(db.prepare('SELECT 1 FROM product_features WHERE product_id = ? AND feature_id = ?').get(productId, entityId));
    const column = { brands: 'brand_id', categories: 'category_id', suppliers: 'supplier_id', locations: 'location_id', colors: 'color_id' }[entityType];
    return column ? Boolean(db.prepare(`SELECT 1 FROM products WHERE id = ? AND ${column} = ?`).get(productId, entityId)) : false;
  };
  const rows = (type
    ? db.prepare('SELECT * FROM history WHERE entity_type = ? ORDER BY id DESC LIMIT 500').all(type)
    : db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 500').all())
    .map(row => ({ ...row, changes: row.changes ? JSON.parse(row.changes) : null, snapshot: row.snapshot ? JSON.parse(row.snapshot) : null }))
    .filter(row => matchesHistory(row, productId, relatedToEntity));
  res.json(rows.map(row => ({ ...row, created_at: toLocaltime(row.created_at) })));
});

// GET /api/history?type=products|sales|... (omit or "all" for everything)
router.get('/', (req, res) => {
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null;
  const rows = type
    ? db.prepare('SELECT * FROM history WHERE entity_type = ? ORDER BY id DESC LIMIT 500').all(type)
    : db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 500').all();
  res.json(rows.map(r => ({
    ...r,
    created_at: toLocaltime(r.created_at),
    changes: r.changes ? JSON.parse(r.changes) : null,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null
  })));
});

module.exports = router;
