const express = require('express');
const XLSX = require('xlsx');
const db = require('../db');

const router = express.Router();

router.get('/labels-xlsx', (req, res) => {
  const linkTemplate = String(req.query.link || '').trim();
  const includeOutOfStock = req.query.includeOutOfStock === '1';
  if (!linkTemplate) return res.status(400).json({ error: 'Link URL is required' });

  const products = db.prepare(`
    SELECT p.name, p.model, p.quantity, p.sku, s.full_name AS supplier_full_name
    FROM products p
    INNER JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.model IS NOT NULL AND p.model != ''
      AND p.is_archived = 0
      AND TRIM(COALESCE(s.full_name, '')) != ''
      ${includeOutOfStock ? '' : 'AND p.quantity > 0'}
    ORDER BY p.model, p.name
  `).all();

  const rows = products.map(product => ({
    'Product name': product.name,
    Model: product.model,
    Quantity: product.quantity,
    SKU: product.sku,
    'Supplier full name': product.supplier_full_name || '',
    URL: linkTemplate.includes('*')
      ? linkTemplate.replaceAll('*', product.model)
      : linkTemplate + product.model
  }));

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Product name', 'Model', 'Quantity', 'SKU', 'Supplier full name', 'URL']
  });
  sheet['!cols'] = [
    { wch: 42 }, { wch: 16 }, { wch: 10 },
    { wch: 18 }, { wch: 42 }, { wch: 58 }
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, 'Labels');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-labels.xlsx"');
  res.send(buffer);
});

module.exports = router;
