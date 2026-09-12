const express = require('express');
const db = require('../db');
const { statusIds, logHistory } = require('../db');
const { toLocaltime } = require('../time');

const router = express.Router();

const ORDER_ITEMS = `
  SELECT op.product_id, op.quantity, p.model, p.name, p.sku, p.ean, p.price, p.quantity AS stock
  FROM sale_products op
  JOIN products p ON p.id = op.product_id
  WHERE op.order_id = ?
  ORDER BY op.product_id
`;

function getOrder(id) {
  const order = db.prepare(`
    SELECT o.id, o.customer, o.status_id, s.status, o.total, o.created_at, o.updated_at, o.completed_at, o.canceled_at,
      (SELECT COALESCE(SUM(p.price * op.quantity), 0) FROM sale_products op
        JOIN products p ON p.id = op.product_id WHERE op.order_id = o.id) AS live_total,
      (SELECT COALESCE(SUM(op.quantity), 0) FROM sale_products op WHERE op.order_id = o.id) AS item_count
    FROM sale_orders o JOIN order_status s ON s.id = o.status_id
    WHERE o.id = ?`).get(id);
  if (order) {
    for (const field of ['created_at', 'updated_at', 'completed_at', 'canceled_at']) order[field] = toLocaltime(order[field]);
  }
  return order;
}

// GET /api/orders
router.get('/', (req, res) => {
  const orders = db.prepare(`
    SELECT o.id, o.customer, s.status, o.total, o.created_at, o.updated_at, o.completed_at, o.canceled_at,
      (SELECT COALESCE(SUM(p.price * op.quantity), 0) FROM sale_products op
        JOIN products p ON p.id = op.product_id WHERE op.order_id = o.id) AS live_total,
      (SELECT COALESCE(SUM(op.quantity), 0) FROM sale_products op WHERE op.order_id = o.id) AS item_count
    FROM sale_orders o JOIN order_status s ON s.id = o.status_id
    ORDER BY o.id DESC`).all();
  res.json(orders.map(o => {
    for (const field of ['created_at', 'updated_at', 'completed_at', 'canceled_at']) o[field] = toLocaltime(o[field]);
    return o;
  }));
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.items = db.prepare(ORDER_ITEMS).all(order.id);
  res.json(order);
});

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return 'Order must contain at least one product';
  for (const it of items) {
    if (!Number.isInteger(it.quantity) || it.quantity < 1) {
      return 'Quantities must be positive integers';
    }
    if (!db.prepare('SELECT id FROM products WHERE id = ?').get(it.product_id)) {
      return `Unknown product id ${it.product_id}`;
    }
  }
  return null;
}

function replaceItems(orderId, items) {
  db.prepare('DELETE FROM sale_products WHERE order_id = ?').run(orderId);
  const ins = db.prepare('INSERT INTO sale_products (order_id, product_id, quantity) VALUES (?, ?, ?)');
  for (const it of items) ins.run(orderId, it.product_id, it.quantity);
}

// POST /api/orders  { customer, items: [{product_id, quantity}] }
router.post('/', (req, res) => {
  const items = req.body.items;
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });
  let completed = false;
  let completedTotal = null;
  let id;
  try {
    id = db.transaction(() => {
      const orderId = db.prepare('INSERT INTO sale_orders (customer, status_id) VALUES (?, ?)')
        .run(req.body.customer || null, statusIds.draft).lastInsertRowid;
      replaceItems(orderId, items);
      if (req.body.complete) {
        const orderItems = db.prepare(ORDER_ITEMS).all(orderId);
        for (const item of orderItems) {
          if (item.quantity > item.stock) throw new Error(`Insufficient stock for "${item.name}" (have ${item.stock}, need ${item.quantity})`);
        }
        completedTotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const deduct = db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?');
        for (const item of orderItems) deduct.run(item.quantity, item.product_id);
        db.prepare("UPDATE sale_orders SET status_id = ?, total = ?, updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?")
          .run(statusIds.completed, completedTotal, orderId);
        completed = true;
      }
      return orderId;
    })();
  } catch (e) {
    return res.status(409).json({ error: e.message });
  }
  if (completed) {
    logHistory({
      entity_type: 'sales', entity_id: id, action: 'complete', label: `Sale order #${id}`,
      changes: { status: { old: null, new: 'completed' }, total: { old: null, new: completedTotal } },
      snapshot: { customer: req.body.customer || null, items: db.prepare(ORDER_ITEMS).all(id), total: completedTotal }
    });
    return res.status(201).json({ id, completed: true, total: completedTotal });
  }
  logHistory({
    entity_type: 'sales', entity_id: id, action: 'create', label: `Sale order #${id}`,
    snapshot: { customer: req.body.customer || null, items: db.prepare(ORDER_ITEMS).all(id) }
  });
  res.status(201).json({ id, completed: false });
});

// PUT /api/orders/:id  (draft only)
router.put('/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'draft') return res.status(409).json({ error: 'Only draft orders can be edited' });
  const items = req.body.items;
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });
  const beforeItems = db.prepare(ORDER_ITEMS).all(order.id);
  db.transaction(() => {
    db.prepare("UPDATE sale_orders SET customer = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.customer || null, order.id);
    replaceItems(order.id, items);
  })();
  const afterItems = db.prepare(ORDER_ITEMS).all(order.id);
  const changes = {};
  if (String(order.customer ?? '') !== String(req.body.customer ?? '')) {
    changes.customer = { old: order.customer, new: req.body.customer || null };
  }
  const fmt = it => `${it.name} (model ${it.model ?? '—'}) × ${it.quantity}`;
  const oldList = beforeItems.map(fmt).sort().join('; ');
  const newList = afterItems.map(fmt).sort().join('; ');
  if (oldList !== newList) changes.items = { old: beforeItems.map(fmt), new: afterItems.map(fmt) };
  if (Object.keys(changes).length) {
    logHistory({
      entity_type: 'sales', entity_id: order.id, action: 'update', label: `Sale order #${order.id}`,
      changes, snapshot: { customer: order.customer, items: beforeItems, new_items: afterItems }
    });
  }
  res.json({ ok: true });
});

// POST /api/orders/:id/complete — deduct stock, set total, mark completed
router.post('/:id/complete', (req, res) => {
  try {
    const result = db.transaction(() => {
      const order = getOrder(req.params.id);
      if (!order) throw new Error('Order not found');
      if (order.status !== 'draft') throw new Error('Only draft orders can be completed');
      const items = db.prepare(ORDER_ITEMS).all(order.id);
      if (items.length === 0) throw new Error('Order has no items');
      for (const it of items) {
        if (it.quantity > it.stock) {
          throw new Error(`Insufficient stock for "${it.name}" (have ${it.stock}, need ${it.quantity})`);
        }
      }
      const deduct = db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?');
      for (const it of items) deduct.run(it.quantity, it.product_id);
      const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
      db.prepare("UPDATE sale_orders SET status_id = ?, total = ?, updated_at = datetime('now'), completed_at = datetime('now') WHERE id = ?")
        .run(statusIds.completed, total, order.id);
      order.items = items;
      order.total = total;
      return order;
    })();
    logHistory({
      entity_type: 'sales', entity_id: result.id, action: 'complete', label: `Sale order #${result.id}`,
      changes: { status: { old: 'draft', new: 'completed' }, total: { old: null, new: result.total } },
      snapshot: { customer: result.customer, items: result.items, total: result.total }
    });
    res.json({ ok: true, total: result.total });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

// POST /api/orders/:id/cancel — canceled; restores stock if it was completed
router.post('/:id/cancel', (req, res) => {
  try {
    const result = db.transaction(() => {
      const order = getOrder(req.params.id);
      if (!order) throw new Error('Order not found');
      if (order.status === 'canceled') throw new Error('Order is already canceled');
      let restored = false;
      if (order.status === 'completed') {
        const restore = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?');
        for (const it of db.prepare(ORDER_ITEMS).all(order.id)) restore.run(it.quantity, it.product_id);
        restored = true;
      }
      db.prepare("UPDATE sale_orders SET status_id = ?, updated_at = datetime('now'), canceled_at = datetime('now') WHERE id = ?").run(statusIds.canceled, order.id);
      order.items = db.prepare(ORDER_ITEMS).all(order.id);
      order.restored = restored;
      return order;
    })();
    logHistory({
      entity_type: 'sales', entity_id: result.id, action: 'cancel', label: `Sale order #${result.id}`,
      changes: { status: { old: result.restored ? 'completed' : 'draft', new: 'canceled' } },
      snapshot: { customer: result.customer, items: result.items, stock_restored: result.restored }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e.message });
  }
});

module.exports = router;
