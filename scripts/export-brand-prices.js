// Export product SKUs with their brand and the brand's suggested price.
// Usage: node scripts/export-brand-prices.js [output-file]
const XLSX = require('xlsx');
const path = require('path');
const db = require('../db');

const outputPath = path.resolve(process.argv[2] || 'product-brand-prices.xlsx');
const products = db.prepare(`
  SELECT p.sku, b.name AS brand, b.price AS brand_suggested_price
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  ORDER BY p.sku
`).all();

const rows = products.map(product => ({
  'Product SKU': product.sku,
  'Product brand': product.brand || '',
  'Brand suggested price': product.brand_suggested_price ?? ''
}));

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.json_to_sheet(rows, {
  header: ['Product SKU', 'Product brand', 'Brand suggested price']
});
sheet['!cols'] = [
  { wch: 20 }, { wch: 32 }, { wch: 24 }
];
XLSX.utils.book_append_sheet(workbook, sheet, 'Brand prices');
XLSX.writeFile(workbook, outputPath);

console.log(`Exported ${rows.length} products to ${outputPath}`);
