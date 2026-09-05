// One-time update of product names from p.csv.
// Usage: node update-product-names.js [csv-file] [--dry-run]
//
// The CSV must contain model and name columns. Products are matched by their
// exact model value; quantity and every other product field are unchanged.
const XLSX = require('xlsx');
const path = require('path');
const db = require('./db');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvPath = path.resolve(args.find(arg => arg !== '--dry-run') || 'p.csv');

const workbook = XLSX.readFile(csvPath, { raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

function decodeMojibake(value) {
  const text = String(value ?? '').trim();
  if (!/[ÐÑ]/.test(text)) return text;
  try {
    const decoded = Buffer.from(text, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? text : decoded;
  } catch {
    return text;
  }
}

if (!rows.length || !Object.prototype.hasOwnProperty.call(rows[0], 'model') ||
    !Object.prototype.hasOwnProperty.call(rows[0], 'name')) {
  throw new Error('CSV must contain "model" and "name" columns');
}

const stats = {
  rows: rows.length,
  updated: 0,
  unchanged: 0,
  missingModel: 0,
  missingName: 0,
  notFound: 0,
  duplicateModel: 0
};
const seenModels = new Set();
const changes = [];

for (const row of rows) {
  const model = String(row.model ?? '').trim();
  const name = decodeMojibake(row.name);

  if (!model) {
    stats.missingModel++;
    continue;
  }
  if (!name) {
    stats.missingName++;
    continue;
  }
  if (seenModels.has(model)) {
    stats.duplicateModel++;
    continue;
  }
  seenModels.add(model);

  const product = db.prepare('SELECT id, name FROM products WHERE model = ?').get(model);
  if (!product) {
    stats.notFound++;
    continue;
  }
  if (product.name === name) {
    stats.unchanged++;
    continue;
  }

  changes.push({ id: product.id, model, oldName: product.name, newName: name });
}

if (!dryRun) {
  const update = db.prepare('UPDATE products SET name = ? WHERE id = ?');
  db.transaction(() => {
    for (const change of changes) update.run(change.newName, change.id);
  })();
}
stats.updated = changes.length;

console.log(`Product name update ${dryRun ? 'preview' : 'complete'}:`);
console.log('  CSV rows:', stats.rows);
if (dryRun) {
  console.log('  names to update:', stats.updated);
} else {
  console.log('  names updated:', stats.updated);
}
console.log('  names already matching:', stats.unchanged);
console.log('  models not found:', stats.notFound);
console.log('  rows missing model:', stats.missingModel);
console.log('  rows missing name:', stats.missingName);
console.log('  duplicate models skipped:', stats.duplicateModel);
console.log('  CSV:', csvPath);