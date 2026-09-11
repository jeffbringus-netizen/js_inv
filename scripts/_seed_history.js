// One-off script: seeds a FRESH database and fires EVERY history-producing action,
// so all history templates can be reviewed at once. Delete data/inventory.db first.
const BASE = 'http://localhost:3000';

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

(async () => {
  // ---------- entity creates ----------
  const brand = await api('POST', '/api/entities/brands', { name: 'Acme Audio', price: 99, cost: 45 });
  const cat = await api('POST', '/api/entities/categories', { name: 'Headphones' });
  const loc = await api('POST', '/api/entities/locations', { name: 'Shelf A' });
  const sup = await api('POST', '/api/entities/suppliers', { name: 'acme-gmbh', full_name: 'Acme GmbH' });
  const dev = await api('POST', '/api/entities/devices', { brand: 'Test', series: 'Pixel', model: '9', year: 2024 });
  const feat = await api('POST', '/api/entities/features', { name: 'Waterproof' });
  const color = await api('POST', '/api/entities/colors', { name: 'Midnight Blue', tag_color: '#1a237e', tag_text: '#ffffff', tag_border: '#1a237e' });

  // ---------- entity updates (one per type) ----------
  await api('PUT', `/api/entities/brands/${brand.id}`, { price: 109 });
  await api('PUT', `/api/entities/devices/${dev.id}`, { model: '9X' });
  await api('PUT', `/api/entities/features/${feat.id}`, { name: 'Waterproof IP67' });
  await api('PUT', `/api/entities/categories/${cat.id}`, { name: 'Headphones & Earbuds' });
  await api('PUT', `/api/entities/locations/${loc.id}`, { name: 'Shelf A1' });
  await api('PUT', `/api/entities/suppliers/${sup.id}`, { full_name: 'Acme GmbH & Co. KG' });
  await api('PUT', `/api/entities/colors/${color.id}`, { tag_color: '#1565c0' });

  // ---------- temp entities, created only to be deleted ----------
  const tempBrand = await api('POST', '/api/entities/brands', { name: 'Temp Brand' });
  const tempCat = await api('POST', '/api/entities/categories', { name: 'Temp Category' });
  const tempLoc = await api('POST', '/api/entities/locations', { name: 'Temp Location' });
  const tempSup = await api('POST', '/api/entities/suppliers', { name: 'temp-supplier', full_name: 'Temp Supplier GmbH' });
  const tempFeat = await api('POST', '/api/entities/features', { name: 'Temp Feature' });
  const tempDev = await api('POST', '/api/entities/devices', { name: 'Temp Device', year: 2020 });
  const tempColor = await api('POST', '/api/entities/colors', { name: 'Temp Color', tag_color: '#6c757d', tag_text: '#ffffff', tag_border: '#6c757d' });

  // ---------- product creates (temp product links ALL temp entities, so every
  // entity delete below logs a linked-products table) ----------
  const tempProd = await api('POST', '/api/products', {
    name: 'Temp Product', sku: 'TEMP-P1', quantity: 2, price: 10, cost: 5,
    brand_id: tempBrand.id, category_id: tempCat.id, location_id: tempLoc.id,
    supplier_id: tempSup.id, color: 'Temp Color', device_ids: [tempDev.id], feature_ids: [tempFeat.id]
  });
  const prodA = await api('POST', '/api/products', {
    model: '1001', name: 'Acme Buds Pro', ean: '400000000001', sku: 'ACME-BUDS-BLU',
    color: 'Midnight Blue', quantity: 10, price: 99, cost: 45, supplier_name: 'ACME-2024-BUDS',
    brand_id: brand.id, category_id: cat.id, supplier_id: sup.id, location_id: loc.id,
    device_ids: [dev.id], feature_ids: [feat.id]
  });
  const prodB = await api('POST', '/api/products', {
    name: 'Acme Buds Lite', sku: 'ACME-LITE-BLU', quantity: 3, price: 49, cost: 25
  });

  // ---------- product update (price + quantity) ----------
  await api('PUT', `/api/products/${prodA.id}`, {
    model: '1001', name: 'Acme Buds Pro', ean: '400000000001', sku: 'ACME-BUDS-BLU',
    color: 'Midnight Blue', quantity: 8, price: 89, cost: 45, supplier_name: 'ACME-2024-BUDS',
    brand_id: brand.id, category_id: cat.id, supplier_id: sup.id, location_id: loc.id,
    device_ids: [dev.id], feature_ids: [feat.id]
  });

  // ---------- device product sync (remove one + add one in a single action) ----------
  await api('PUT', `/api/entities/devices/${dev.id}/products`, { remove: [prodA.id], add: [prodB.id] });

  // ---------- single product unlink from device ----------
  await api('DELETE', `/api/entities/devices/${dev.id}/products/${prodB.id}`);

  // ---------- mass update (single field, like the UI sends) ----------
  await api('POST', '/api/products/mass-update', { ids: [prodA.id, prodB.id], patch: { price: 69 } });

  // ---------- sales: create -> update -> complete, and create -> cancel ----------
  const order1 = await api('POST', '/api/sale-orders', { customer: 'John Doe', items: [{ product_id: prodA.id, quantity: 1 }] });
  await api('PUT', `/api/sale-orders/${order1.id}`, { customer: 'John Doe Jr.', items: [{ product_id: prodA.id, quantity: 2 }] });
  await api('POST', `/api/sale-orders/${order1.id}/complete`);
  const order2 = await api('POST', '/api/sale-orders', { customer: 'Jane Roe', items: [{ product_id: prodA.id, quantity: 1 }] });
  await api('POST', `/api/sale-orders/${order2.id}/cancel`);

  // ---------- purchase import (updates existing + creates a new product) ----------
  await api('POST', '/api/purchases/complete', {
    supplier_id: sup.id,
    shipping: 25,
    brand_prices: { 'JBL': 129 },
    updates: [
      { product_id: prodA.id, add_quantity: 5, purchase_price: 43, ean: '400000000001', cost: 43, supplier_name: 'ACME-2024-BUDS' }
    ],
    new_products: [
      {
        model: '1002', name: 'JBL Tune Flex', ean: '400000000002', sku: 'JBL-FLEX-BLK',
        color: 'Black', quantity: 6, price: 129, cost: 60, supplier_name: 'JBL-2024-FLEX',
        brand: 'JBL', category: 'Earbuds', location: 'Shelf B',
        devices: ['Pixel 9 Pro'], features: ['Noise Cancelling']
      }
    ]
  });

  // ---------- product delete (the imported JBL product) ----------
  const allProducts = await api('GET', '/api/products');
  const jbl = allProducts.find(p => p.sku === 'JBL-FLEX-BLK');
  await api('DELETE', `/api/products/${jbl.id}`);

  // ---------- entity deletes (temp device still has Temp Product linked) ----------
  await api('DELETE', `/api/entities/categories/${tempCat.id}`);
  await api('DELETE', `/api/entities/brands/${tempBrand.id}`);
  await api('DELETE', `/api/entities/locations/${tempLoc.id}`);
  await api('DELETE', `/api/entities/suppliers/${tempSup.id}`);
  await api('DELETE', `/api/entities/features/${tempFeat.id}`);
  await api('DELETE', `/api/entities/colors/${tempColor.id}`);
  await api('DELETE', `/api/entities/devices/${tempDev.id}`);

  // ---------- coverage summary ----------
  const history = await api('GET', '/api/history?type=all');
  const seen = new Map();
  for (const h of history) {
    const key = `${h.entity_type}/${h.action}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  console.log(`=== ${history.length} history entries, coverage: ===`);
  for (const [k, v] of [...seen.entries()].sort()) console.log(`${k.padEnd(22)} x${v}`);
})().catch(e => { console.error(e); process.exit(1); });
