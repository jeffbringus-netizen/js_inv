const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');

const router = express.Router();
const formatLocation = location => String(location || '').replace(/([A-Za-z])(\d)\b/g, '$10$2');

function getLabelData(req) {
  const linkTemplate = String(req.query.link || '').trim();
  const includeOutOfStock = req.query.includeOutOfStock === '1';
  const includeLocation = req.query.includeLocation === '1';
  const includeSuggestedPrice = req.query.includeSuggestedPrice === '1';
  if (!linkTemplate) return { error: 'Link URL is required' };

  const products = db.prepare(`
    SELECT p.name, p.model, p.quantity, p.sku, s.full_name AS supplier_full_name,
       ${includeLocation ? 'l.name AS location_name' : 'NULL AS location_name'},
       ${includeSuggestedPrice ? 'b.price AS brand_suggested_price' : 'NULL AS brand_suggested_price'}
    FROM products p
    INNER JOIN suppliers s ON s.id = p.supplier_id
     ${includeSuggestedPrice ? 'LEFT JOIN brands b ON b.id = p.brand_id' : ''}
    ${includeLocation ? 'LEFT JOIN locations l ON l.id = p.location_id' : ''}
    WHERE p.model IS NOT NULL AND p.model != ''
      AND p.is_archived = 0
      AND TRIM(COALESCE(s.full_name, '')) != ''
      ${includeOutOfStock ? '' : 'AND p.quantity > 0'}
    ORDER BY p.model, p.name
  `).all();

  const rows = products.map(product => {
    const row = {
      'Product name': product.name,
      Model: product.model,
      Quantity: product.quantity,
      SKU: product.sku,
      'Supplier full name': product.supplier_full_name || '',
      URL: linkTemplate.includes('*')
        ? linkTemplate.replaceAll('*', product.model)
        : linkTemplate + product.model
    };
    if (includeLocation) row.Location = formatLocation(product.location_name);
    if (includeSuggestedPrice) row['Brand suggested price'] = product.brand_suggested_price ?? '';
    return row;
  });

  const headers = ['Product name', 'Model', 'Quantity', 'SKU', 'Supplier full name', 'URL'];
  if (includeLocation) headers.push('Location');
  if (includeSuggestedPrice) headers.push('Brand suggested price');

  return { rows, headers, includeLocation, includeSuggestedPrice };
}

router.get('/labels-xlsx', (req, res) => {
  const data = getLabelData(req);
  if (data.error) return res.status(400).json(data);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(data.rows, { header: data.headers });
  sheet['!cols'] = [
    { wch: 42 }, { wch: 16 }, { wch: 10 },
    { wch: 18 }, { wch: 42 }, { wch: 58 },
    ...(data.includeLocation ? [{ wch: 24 }] : []),
    ...(data.includeSuggestedPrice ? [{ wch: 24 }] : [])
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Labels');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-labels.xlsx"');
  res.send(buffer);
});

router.get('/labels-csv', (req, res) => {
  const data = getLabelData(req);
  if (data.error) return res.status(400).json(data);

  const sheet = XLSX.utils.json_to_sheet(data.rows, { header: data.headers });
  const csv = XLSX.utils.sheet_to_csv(sheet);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="product-labels.csv"');
  res.send(csv);
});

module.exports = router;
