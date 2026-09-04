const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'inventory.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  price REAL,
  cost REAL
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  year INTEGER NOT NULL,
  short_name TEXT
);
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT UNIQUE,
  name TEXT NOT NULL,
  ean TEXT UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  supplier_name TEXT,
  is_online INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  brand_id INTEGER REFERENCES brands(id),
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  location_id INTEGER REFERENCES locations(id)
);
CREATE TABLE IF NOT EXISTS product_devices (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, device_id)
);
CREATE TABLE IF NOT EXISTS product_features (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, feature_id)
);
CREATE TABLE IF NOT EXISTS order_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sale_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT,
  status_id INTEGER NOT NULL REFERENCES order_status(id),
  total REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sale_products (
  order_id INTEGER NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  total REAL NOT NULL,
  shipping REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_products (
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  is_new INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (purchase_order_id, product_id)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  label TEXT NOT NULL,
  changes TEXT,
  snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// order statuses are looked up by name everywhere
const STATUS_IDS = {};
for (const s of ['draft', 'completed', 'canceled']) {
  const row = db.prepare('SELECT id FROM order_status WHERE status = ?').get(s);
  STATUS_IDS[s] = row
    ? row.id
    : db.prepare('INSERT INTO order_status (status) VALUES (?)').run(s).lastInsertRowid;
}

module.exports = db;
module.exports.statusIds = STATUS_IDS;
module.exports.DB_PATH = DB_PATH;

function logHistory(entry) {
  db.prepare(`INSERT INTO history (entity_type, entity_id, action, label, changes, snapshot)
    VALUES (@entity_type, @entity_id, @action, @label, @changes, @snapshot)`)
    .run({
      entity_id: null, changes: null, snapshot: null, ...entry,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
      snapshot: entry.snapshot ? JSON.stringify(entry.snapshot) : null
    });
}
module.exports.logHistory = logHistory;
