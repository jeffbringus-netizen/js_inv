// One-time import of stock.xlsx into a clean database.
// Usage: node import-stock.js
//
// Wipes all products, entities, sale and purchase orders, then imports every
// sheet. Columns per sheet:
//   A location | B model | C devices (/) | D category | E brand | F ean
//   G sku | H features (/) | I color | J quantity | K sale price w/ VAT
//   M purchase price w/o VAT | O product name / supplier's product name
//   P supplier ("Full Name, City, Country")
const XLSX = require('xlsx');
const db = require('./db');

const FILE = 'stock.xlsx';

const code = v => (typeof v === 'number' ? String(v) : String(v ?? '').trim());
const num = v => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

function wipe() {  
  db.exec(`
    DELETE FROM sale_products;
    DELETE FROM sale_orders;
    DELETE FROM purchase_products;
    DELETE FROM purchase_orders;
    DELETE FROM product_devices;
    DELETE FROM product_features;
    DELETE FROM products;
    DELETE FROM brands;
    DELETE FROM categories;
    DELETE FROM suppliers;
    DELETE FROM locations;
    DELETE FROM devices;
    DELETE FROM features;
    DELETE FROM history;
  `);
}

const entityCache = new Map();
function findOrCreate(table, name, extraCols = {}) {
  const key = `${table}:${name.toLowerCase()}`;
  if (entityCache.has(key)) return entityCache.get(key);
  let row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name);
  if (!row) {
    const cols = ['name', ...Object.keys(extraCols)];
    const vals = [name, ...Object.values(extraCols)];
    row = { id: db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid };
  }
  entityCache.set(key, row.id);
  return row.id;
}

const stats = { imported: 0, skipped: 0, mergedDuplicates: 0, missingEan: 0, missingCost: 0, fallbackNames: 0 };
const seenSku = new Map();     // sku -> product id (merge duplicates)
const usedEans = new Set();

function readSheetRows(ws) {
  let lastRow = -1;
  let lastCol = -1;
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const cell = ws[addr];
    // Treat undefined, null, empty string, and whitespace-only values as empty
    if (
      cell.v === undefined ||
      cell.v === null ||
      String(cell.v).trim() === ''
    ) {
      continue;
    }
    const { r, c } = XLSX.utils.decode_cell(addr);
    lastRow = Math.max(lastRow, r);
    lastCol = Math.max(lastCol, c);
  }
  // No actual data
  if (lastRow === -1 || lastCol === -1) {
    return [];
  }
  const range = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastCol }
  });
  return XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    blankrows: false,
    range
  });
}

const tx = db.transaction(() => {
  wipe();

  const insProduct = db.prepare(`INSERT INTO products
    (model, name, ean, sku, color, quantity, price, cost, supplier_name, brand_id, category_id, supplier_id, location_id, is_online)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insPD = db.prepare('INSERT OR IGNORE INTO product_devices (product_id, device_id) VALUES (?, ?)');
  const insPF = db.prepare('INSERT OR IGNORE INTO product_features (product_id, feature_id) VALUES (?, ?)');

  const workbook = XLSX.readFile(FILE);
  for (const sheetName of workbook.SheetNames) {
    const rows = readSheetRows(workbook.Sheets[sheetName]);
        // the "Stock" sheet keeps device names in column C; other sheets (e.g. "Other")
    // store a short product name there instead — only parse C as devices when the
    // header says so
    const cHeader = String(rows[0]?.[2] ?? '').toLowerCase();
    const devicesInC = cHeader === 'device' || cHeader === 'devices';
    for (let i = 1; i < rows.length; i++) { // row 0 = headers
      const r = rows[i];
      const location = code(r[0]);
      const modelRaw = code(r[1]);
      const devicesRaw = devicesInC ? code(r[2]) : '';
      const category = code(r[3]);
      const brand = code(r[4]);
      const eanRaw = code(r[5]);
      const sku = code(r[6]);
      const featuresRaw = code(r[7]);
      const color = code(r[8]);
      const quantity = parseInt(r[9], 10) || 0;
      const price = num(r[10]);
      const cost = num(r[12]);
      const name = code(r[14]);
      const supplierRaw = code(r[15]);

      if (!sku) { stats.skipped++; continue; }

      // duplicate SKU: merge quantities into the existing product
      if (seenSku.has(sku)) {
        db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(quantity, seenSku.get(sku));
        stats.mergedDuplicates++;
        continue;
      }

      // Keep missing or duplicate EANs empty; non-empty values remain unique.
      const ean = eanRaw && !usedEans.has(eanRaw) ? eanRaw : null;
      if (!eanRaw) stats.missingEan++;
      if (ean) usedEans.add(ean);

      const finalCost = cost == null ? (stats.missingCost++, 0) : cost;

      const locationId = location ? findOrCreate('locations', location) : null;
      const categoryId = category ? findOrCreate('categories', category) : null;
      const brandId = brand ? findOrCreate('brands', brand) : null;
      let supplierId = null;
      if (supplierRaw) {
        const fullName = supplierRaw;
        const shortName = supplierRaw.split(',')[0].trim();
        let s = db.prepare('SELECT id FROM suppliers WHERE name = ? OR full_name = ?').get(shortName, fullName);
        if (!s) s = { id: db.prepare('INSERT INTO suppliers (name, full_name) VALUES (?, ?)').run(shortName, fullName).lastInsertRowid };
        supplierId = s.id;
      }

      // fallback name when column O is empty
      let productName = name;
      if (!productName) {
        stats.fallbackNames++;
        productName = [brand, category, devicesRaw, color].filter(Boolean).join(' ') || sku;
      }

      const pid = insProduct.run(
        modelRaw || null, productName, ean, sku,
        color || 'unspecified', quantity,
        price == null ? 0 : price, finalCost,
        name || null, // supplier's product name
        brandId, categoryId, supplierId, locationId,
        modelRaw ? 1 : 0 // products with a model number are considered online
      ).lastInsertRowid;
      seenSku.set(sku, pid);

      if (devicesRaw) {
        for (const d of devicesRaw.split('/').map(s => s.trim()).filter(Boolean)) {
          insPD.run(pid, findOrCreate('devices', d, { year: 0 }));
        }
      }
      if (featuresRaw) {
        for (const f of featuresRaw.split('/').map(s => s.trim()).filter(Boolean)) {
          insPF.run(pid, findOrCreate('features', f));
        }
      }
      stats.imported++;
    }
  }
});

tx();

console.log('Stock import complete:');
console.log('  products imported:', stats.imported);
console.log('  duplicate SKUs merged:', stats.mergedDuplicates);
console.log('  rows skipped (no SKU):', stats.skipped);
console.log('  products with missing EAN:', stats.missingEan);
console.log('  products with cost 0:', stats.missingCost);
console.log('  fallback names generated:', stats.fallbackNames);
console.log('  devices:', db.prepare('SELECT COUNT(*) n FROM devices').get().n);
console.log('  features:', db.prepare('SELECT COUNT(*) n FROM features').get().n);
console.log('  brands:', db.prepare('SELECT COUNT(*) n FROM brands').get().n);
console.log('  categories:', db.prepare('SELECT COUNT(*) n FROM categories').get().n);
console.log('  suppliers:', db.prepare('SELECT COUNT(*) n FROM suppliers').get().n);
console.log('  locations:', db.prepare('SELECT COUNT(*) n FROM locations').get().n);
