const XLSX = require('xlsx');

// Parse a KOFF purchase workbook into the common purchase-import row shape.
function parse(data, db) {
  let workbook;
  try {
    workbook = XLSX.read(Buffer.from(data, 'base64'), { type: 'buffer' });
  } catch (e) {
    throw new Error('Could not read xlsx file: ' + e.message);
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('xlsx file has no sheets');

  // raw: true keeps long EANs from being returned as scientific notation.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  const code = v => typeof v === 'number' ? String(v) : String(v ?? '').trim();
  const deviceByLower = new Map(
    db.prepare('SELECT id, name FROM devices').all()
      .map(d => [d.name.toLowerCase(), { id: d.id, name: d.name }])
  );
  const brandByName = new Map(db.prepare('SELECT id, name, price, cost FROM brands').all().map(b => [b.name, b]));
  const productBySku = new Map(
    db.prepare('SELECT * FROM products').all().map(p => [String(p.sku).toLowerCase(), p])
  );

  const parsed = [];
  for (let i = 1; i < rows.length; i++) { // row 0 = headers
    const row = rows[i];
    const supplierName = String(row[1] || '').trim();
    const sku = code(row[2]);
    const ean = code(row[3]);
    const quantity = parseInt(row[4], 10) || 0;
    const cost = parseFloat(String(row[6] ?? '').replace(',', '.')) || 0;
    if (!supplierName && !sku && !ean && !quantity) continue;

    const parsedRow = parseName(supplierName, deviceByLower);
    const brand = parsedRow.brand ? brandByName.get(parsedRow.brand) : null;
    if (brand && brand.price != null) parsedRow.brand_price = brand.price;
    const existing = sku ? productBySku.get(sku.toLowerCase()) || null : null;
    parsed.push({
      supplier_name: supplierName,
      sku, ean, quantity, cost,
      parsed: parsedRow,
      existing: existing ? {
        id: existing.id, name: existing.name, sku: existing.sku, ean: existing.ean,
        quantity: existing.quantity, cost: existing.cost, supplier_name: existing.supplier_name
      } : null
    });
  }
  return parsed;
}

// KOFF names use " - " segments: brand/product, devices, and color.
function parseName(name, deviceByLower) {
  const out = { brand: null, color: null, devices: [], name: null };
  const segments = String(name || '').split(' - ').map(s => s.trim()).filter(Boolean);
  if (segments.length === 0) return out;

  const brandProduct = (segments[1] || '').split('/')[0].replace(/\s*\([^)]*\)\s*/g, '').trim();
  out.brand = segments.length > 1 ? `${segments[0]} - ${brandProduct}` : segments[0];
  out.color = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : null;

  let devicesSegment = -1;
  if (segments.length >= 4) {
    const matched = segments[2].split('/').map(s => s.trim()).filter(Boolean)
      .map(device => deviceByLower.get(device.toLowerCase())).filter(Boolean);
    if (matched.length > 0) {
      out.devices = matched;
      devicesSegment = 2;
    }
  }

  const nameParts = [];
  for (let i = 1; i < segments.length - 1; i++) {
    if (i === devicesSegment) continue;
    nameParts.push(segments[i].replace(/\s*\([^)]*\)\s*/g, '').trim());
  }
  out.name = nameParts.join(' ') || brandProduct || segments[0];
  return out;
}

module.exports = { parse };