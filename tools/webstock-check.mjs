import { $, esc, copyToClipboard } from './ui.js';

function parseDelimitedText(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ';' || char === ',' || char === '\t')) {
      row.push(value.trim()); value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value.trim()); value = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else value += char;
  }
  row.push(value.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  return rows;
}

function parseWebstockNumber(value) {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function webstockColumn(headers, names) {
  return headers.findIndex(header => names.some(name => header.includes(name)));
}

function compareWebstockCsv(text, products) {
  const rows = parseDelimitedText(text);
  if (rows.length < 2) throw new Error('The CSV must contain a header row and at least one product row.');
  const normalizedHeaders = rows[0].map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const modelIndex = webstockColumn(normalizedHeaders, ['model']);
  const productIdIndex = webstockColumn(normalizedHeaders, ['productid', 'id']);
  const quantityIndex = webstockColumn(normalizedHeaders, ['quantity', 'qty', 'stock']);
  const nameIndex = webstockColumn(normalizedHeaders, ['name', 'productname', 'title']);
  if (modelIndex < 0 || quantityIndex < 0) throw new Error('CSV must contain model and quantity columns.');
  const productsByModel = new Map(products.filter(p => p.model).map(p => [String(p.model).trim(), p]));
  const results = [];
  const seen = new Set();
  for (const row of rows.slice(1)) {
    const model = String(row[modelIndex] ?? '').trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    const csvQuantity = parseWebstockNumber(row[quantityIndex]);
    if (csvQuantity === null) continue;
    const product = productsByModel.get(model);
    if (!product) {
      results.push({ productId: productIdIndex < 0 ? '' : row[productIdIndex] || '', model, name: nameIndex < 0 ? '' : row[nameIndex] || '', missing: true, csvQuantity });
    } else if (Number(product.quantity) !== csvQuantity) {
      results.push({ productId: productIdIndex < 0 ? '' : row[productIdIndex] || '', model, name: product.name, missing: false, dbProductId: product.id, dbQuantity: product.quantity, csvQuantity, difference: product.quantity - csvQuantity });
    }
  }
  return results;
}

function renderWebstockComparison(results) {
  const missing = results.filter(item => item.missing);
  const differences = results.filter(item => !item.missing);
  $('#webstockMissingRows').innerHTML = missing.map(item =>
    `<tr class="table-warning"><td class="webstock-center">${esc(item.productId)}</td><td class="webstock-center">${esc(item.model)}</td><td>${esc(item.name)}</td><td class="webstock-center">${item.csvQuantity}</td></tr>`).join('') ||
    '<tr><td colspan="4" class="text-muted text-center py-3">No Webstock-only products found.</td></tr>';
  $('#webstockDifferenceRows').innerHTML = differences.map(item =>
    `<tr><td class="webstock-center">${esc(item.productId)}</td><td class="webstock-center">${esc(item.model)}</td><td>${esc(item.name)}</td><td class="webstock-center">${item.dbQuantity}</td><td class="webstock-center">${item.csvQuantity}</td><td class="webstock-center">${item.difference > 0 ? '+' : ''}${item.difference}</td></tr>`).join('') ||
    '<tr><td colspan="6" class="text-muted text-center py-3">No quantity differences found.</td></tr>';
  const updates = differences.filter(item => item.productId !== '');
  const sql = updates.length
    ? `-- Set Webstock stock equal to inventory database stock\n${updates.map(item => `UPDATE oc_product SET quantity = ${item.dbQuantity} WHERE product_id = ${sqlString(item.productId)};`).join('\n')}`
    : '-- No quantity updates required.';
  $('#webstockSqlCode').innerHTML = highlightSql(sql);
  $('#copyWebstockSqlBtn').disabled = !updates.length;
  $('#webstockResultCount').textContent = String(results.length);
  $('#webstockMissingCount').textContent = String(missing.length);
  $('#webstockDifferenceCount').textContent = String(differences.length);
  $('#webstockSummary').textContent = `${differences.length} stock updates, ${missing.length} Webstock product(s) not found in database`;
  $('#webstockResults').hidden = false;
}

let webstockCsvText = '';
function highlightSql(sql) {
  const keywords = new Set(['SELECT', 'FROM', 'LEFT', 'INNER', 'JOIN', 'ON', 'WHERE', 'AND', 'GROUP', 'BY', 'ORDER', 'AS', 'SET', 'UPDATE', 'INSERT', 'INTO', 'VALUES', 'NULL', 'IS']);
  return String(sql).replace(/(--[^\n]*|'(?:''|[^'])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/gm, token => {
    const escaped = esc(token);
    if (token.startsWith('--')) return `<span class="sql-comment">${escaped}</span>`;
    if (token.startsWith("'")) return `<span class="sql-string">${escaped}</span>`;
    if (/^\d/.test(token)) return `<span class="sql-number">${escaped}</span>`;
    if (keywords.has(token.toUpperCase())) return `<span class="sql-keyword">${escaped}</span>`;
    return `<span class="sql-identifier">${escaped}</span>`;
  });
}

const webstockExportSql = $('#webstockExportSqlCode').textContent;
$('#webstockExportSqlCode').innerHTML = highlightSql(webstockExportSql);
$('#copyWebstockExportSqlBtn').addEventListener('click', () => copyToClipboard(webstockExportSql));
$('#webstockUploadZone').addEventListener('click', () => $('#webstockCsvInput').click());
$('#webstockCsvInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  webstockCsvText = await file.text();
  $('#webstockCsvName').textContent = file.name;
  $('#webstockUploadZone').classList.add('loaded');
  $('#compareWebstockBtn').disabled = false;
  $('#webstockError').hidden = true;
});
$('#compareWebstockBtn').addEventListener('click', async () => {
  try {
    const products = await fetch('/api/products').then(r => r.json());
    renderWebstockComparison(compareWebstockCsv(webstockCsvText, products));
  } catch (error) {
    $('#webstockError').textContent = error.message || 'Could not compare CSV';
    $('#webstockError').hidden = false;
  }
});
$('#copyWebstockSqlBtn').addEventListener('click', () => copyToClipboard($('#webstockSqlCode').textContent));