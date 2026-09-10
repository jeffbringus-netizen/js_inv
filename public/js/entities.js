import { $, esc, eur, toast, paginationHtml } from './ui.js';
import { S } from './store.js';
import { loadProducts } from './products.js';

// ---------- entities management (locations/devices/categories/brands/features) ----------
export const ENTITY_DEFS = {
  devices: {
    title: 'Devices', singular: 'device',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'short_name', label: 'Short name (used in product badges)', type: 'text' },
      { key: 'year', label: 'Year', type: 'number', required: true, default: new Date().getFullYear() }
    ],
    columns: ['Name', 'Short name', 'Year']
  },
  categories: {
    title: 'Categories', singular: 'category',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: ['Name']
  },
  brands: {
    title: 'Brands', singular: 'brand',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'price', label: 'Suggested price (€, incl. VAT)', type: 'number', step: '0.01' },
      { key: 'cost', label: 'Cost (€, excl. VAT)', type: 'number', step: '0.01' }
    ],
    columns: ['Name', 'Suggested price', 'Cost']
  },
  suppliers: {
    title: 'Suppliers', singular: 'supplier',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'full_name', label: 'Full name', type: 'text', required: true }
    ],
    columns: ['Name', 'Full name']
  },
  locations: {
    title: 'Locations', singular: 'location',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: ['Name']
  },
  features: {
    title: 'Features', singular: 'feature',
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    columns: ['Name']
  },
  colors: {
    title: 'Colors', singular: 'color',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'tag_color', label: 'Tag color', type: 'color', required: true },
      { key: 'tag_text', label: 'Tag text', type: 'color', required: true },
      { key: 'tag_border', label: 'Tag border', type: 'color', required: true }
    ],
    columns: ['Name', 'Tag color', 'Tag text', 'Tag border']
  }
};

let currentEntity = null;
let entityRows = [];
let entityPage = 1;
let entityPageMeta = { total: 0, limit: 100 };

function entityHl(text) {
  const s = String(text ?? '');
  const q = $('#entitySearch') ? $('#entitySearch').value.trim() : '';
  if (!q) return esc(s);
  const idx = s.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return esc(s);
  return esc(s.slice(0, idx)) + '<strong>' + esc(s.slice(idx, idx + q.length)) + '</strong>' + esc(s.slice(idx + q.length));
}

export function openEntityTab(type) {
  currentEntity = type;
  entityPage = 1;
  $('#entityTitle').textContent = ENTITY_DEFS[type].title;
  $('#entitySearch').value = '';
  $('#entitySearchClear').hidden = true;
  loadEntities();
}

async function loadEntities() {
  const q = $('#entitySearch').value.trim();
  const params = new URLSearchParams({ page: entityPage, limit: 100 });
  if (q) params.set('q', q);
  const result = await fetch(`/api/entities/${currentEntity}?${params}`).then(r => r.json());
  entityRows = result.items || [];
  entityPageMeta = result;
  renderEntities();
  renderEntityPagination();
}

function renderEntities() {
  const def = ENTITY_DEFS[currentEntity];
  $('#entityTableHead').innerHTML = `<tr>${def.columns.map(c => `<th>${c}</th>`).join('')}<th>Products</th><th style="width: 110px;">Actions</th></tr>`;
  $('#entityRows').innerHTML = entityRows.map((r, i) => `<tr data-i="${i}">
    <td>${currentEntity === 'colors'
      ? `<span class="badge" style="background:${esc(r.tag_color)};color:${esc(r.tag_text)};border:1px solid ${esc(r.tag_border)}">${entityHl(r.name)}</span>`
      : entityHl(r.name)}</td>
    ${currentEntity === 'colors' ? `<td>${esc(r.tag_color)}</td><td>${esc(r.tag_text)}</td><td>${esc(r.tag_border)}</td>` : ''}
    ${currentEntity === 'devices' ? `<td>${entityHl(r.short_name || '')}</td><td>${r.year}</td>` : ''}
    ${currentEntity === 'brands' ? `<td class="text-nowrap">${r.price == null ? '—' : eur(r.price)}</td><td class="text-nowrap">${r.cost == null ? '—' : eur(r.cost)}</td>` : ''}
    ${currentEntity === 'suppliers' ? `<td>${entityHl(r.full_name)}</td>` : ''}
    <td><span class="badge ${r.product_count > 0 ? 'text-bg-primary' : 'text-bg-light text-muted'}">${r.product_count}</span></td>
    <td class="d-flex gap-1">
      <button class="btn btn-sm btn-outline-secondary ent-info" title="Show linked products"><i class="bi bi-eye"></i></button>
      <button class="btn btn-sm btn-outline-secondary ent-edit" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger ent-del" title="Delete"><i class="bi bi-trash"></i></button>
    </td>
  </tr>`).join('');
}

function renderEntityPagination() {
  const html = paginationHtml(entityPageMeta, 'entities', 'entities');
  $('#entityPaginationTop').innerHTML = html;
  $('#entityPaginationBottom').innerHTML = html;
}

document.addEventListener('click', e => {
  const button = e.target.closest('.pagination-first, .pagination-prev, .pagination-next, .pagination-last');
  if (!button || button.disabled) return;
  if (button.dataset.target === 'products') {
    if (button.classList.contains('pagination-first')) S.productPage = 1;
    else if (button.classList.contains('pagination-last')) S.productPage = Math.ceil(S.productPageMeta.total / S.productPageMeta.limit);
    else S.productPage += button.classList.contains('pagination-next') ? 1 : -1;
    loadProducts();
  } else if (button.dataset.target === 'entities') {
    if (button.classList.contains('pagination-first')) entityPage = 1;
    else if (button.classList.contains('pagination-last')) entityPage = Math.ceil(entityPageMeta.total / entityPageMeta.limit);
    else entityPage += button.classList.contains('pagination-next') ? 1 : -1;
    loadEntities();
  }
});

let entitySearchTimer;
$('#entitySearch').addEventListener('input', () => {
  $('#entitySearchClear').hidden = !$('#entitySearch').value;
  clearTimeout(entitySearchTimer);
  entityPage = 1;
  entitySearchTimer = setTimeout(loadEntities, 250);
});
$('#entitySearchClear').addEventListener('click', () => {
  $('#entitySearch').value = '';
  $('#entitySearchClear').hidden = true;
  entityPage = 1;
  loadEntities();
});

// entity create/edit modal
const entityModal = new bootstrap.Modal('#entityModal');
let entityEditId = null;

function entityModalFields() {
  const fields = ENTITY_DEFS[currentEntity].fields.map(f => `
    <div class="col-12">
      <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
      <input name="${f.key}" type="${f.type}" ${f.step ? `step="${f.step}"` : ''} class="form-control" ${f.required ? 'required' : ''}>
    </div>`).join('');
  return currentEntity === 'colors'
    ? fields + '<div class="col-12"><label class="form-label">Preview</label><div id="colorModalPreview" class="p-3 border rounded"><span class="badge">Color preview</span></div></div>'
    : fields;
}

function openEntityModal(row = null) {
  entityEditId = row ? row.id : null;
  $('#entityModalTitle').textContent = row
    ? `Edit ${ENTITY_DEFS[currentEntity].singular}`
    : `Create new ${ENTITY_DEFS[currentEntity].singular}`;
  $('#entityError').hidden = true;
  const form = $('#entityForm');
  form.innerHTML = entityModalFields();
  for (const f of ENTITY_DEFS[currentEntity].fields) {
    const val = row ? row[f.key] : (f.default ?? '');
    form[f.key].value = val == null ? '' : val;
  }
  if (currentEntity === 'colors') updateColorModalPreview();
  entityModal.show();
}

function updateColorModalPreview() {
  const form = $('#entityForm');
  const preview = $('#colorModalPreview .badge');
  if (!preview || !form) return;
  preview.style.backgroundColor = form.tag_color.value;
  preview.style.color = form.tag_text.value;
  preview.style.border = `1px solid ${form.tag_border.value}`;
}

$('#entityForm').addEventListener('input', e => {
  if (currentEntity === 'colors' && ['tag_color', 'tag_text', 'tag_border'].includes(e.target.name)) updateColorModalPreview();
});

$('#entityCreateBtn').addEventListener('click', () => openEntityModal());

$('#entityRows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const row = entityRows[Number(tr.dataset.i)];
  if (e.target.closest('.ent-info')) openEntityProducts(row);
  else if (e.target.closest('.ent-edit')) openEntityModal(row);
  else if (e.target.closest('.ent-del')) confirmDeleteEntity(row);
});

// linked products modal
const entityProductsModal = new bootstrap.Modal('#entityProductsModal');
let entityProductsEntity = null;

async function openEntityProducts(row) {
  entityProductsEntity = row;
  const data = await fetch(`/api/entities/${currentEntity}/${row.id}/products`).then(r => r.json());
  const singular = ENTITY_DEFS[currentEntity].singular;
  $('#entityProductsTitle').textContent = `Products with ${singular} "${row.name}"`;
  renderEntityProducts(data.products);
  entityProductsModal.show();
}

function renderEntityProducts(products) {
  $('#entityProductsEmpty').hidden = products.length > 0;
  $('#entityProductsRows').innerHTML = products.map(p => `<tr data-pid="${p.id}">
    <td>${esc(p.model || '')}</td>
    <td>${esc(p.name)}</td>
    <td>
      <div class="d-flex flex-column gap-1 align-items-start">
        <span class="badge text-bg-dark">${esc(p.sku)}</span>
        <span class="badge text-bg-secondary">${esc(p.ean)}</span>
      </div>
    </td>
    <td>${p.quantity}</td>
    <td>
      <button class="btn btn-sm btn-outline-danger ep-remove" title="Remove from this product"><i class="bi bi-trash"></i></button>
    </td>
  </tr>`).join('');
}

$('#entityProductsRows').addEventListener('click', async e => {
  const btn = e.target.closest('.ep-remove');
  if (!btn) return;
  const pid = Number(btn.closest('tr').dataset.pid);
  const res = await fetch(`/api/entities/${currentEntity}/${entityProductsEntity.id}/products/${pid}`, { method: 'DELETE' });
  if (!res.ok) {
    toast((await res.json().catch(() => ({}))).error || 'Remove failed');
    return;
  }
  toast(`Removed from product #${pid}`);
  // refresh modal list, entity counts and products page
  const data = await fetch(`/api/entities/${currentEntity}/${entityProductsEntity.id}/products`).then(r => r.json());
  renderEntityProducts(data.products);
  loadEntities();
  loadProducts();
});

$('#saveEntityBtn').addEventListener('click', async () => {
  const form = $('#entityForm');
  const body = {};
  for (const f of ENTITY_DEFS[currentEntity].fields) {
    if (f.required && !String(form[f.key].value).trim()) {
      const err = $('#entityError');
      err.textContent = `Please fill in required fields: ${f.label}`;
      err.hidden = false;
      return;
    }
    body[f.key] = form[f.key].value === '' ? null : form[f.key].value;
  }
  if (body.year != null) body.year = Number(body.year);
  if (body.price != null) body.price = Number(body.price);
  if (body.cost != null) body.cost = Number(body.cost);
  const res = await fetch(entityEditId
    ? `/api/entities/${currentEntity}/${entityEditId}`
    : `/api/entities/${currentEntity}`, {
    method: entityEditId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = $('#entityError');
    err.textContent = (await res.json().catch(() => ({}))).error || 'Save failed';
    err.hidden = false;
    return;
  }
  entityModal.hide();
  toast(entityEditId ? 'Updated' : 'Created');
  loadEntities();
  loadProducts(); // product rows may display this entity's name
});

// entity delete with confirmation
const confirmDeleteModal = new bootstrap.Modal('#confirmDeleteModal');
let pendingDelete = null;

function confirmDeleteEntity(row) {
  pendingDelete = row;
  const unlinkMsg = {
    devices: 'It will be removed from all compatible products.',
    features: 'It will be removed from all products that have it.',
    categories: 'Products in this category will be left without a category.',
    brands: "Products of this brand will be left without a brand.",
    suppliers: 'Products of this supplier will be left without a supplier.',
    locations: 'Products in this location will be left without a location.',
    colors: 'Products with this color will be left without a color.'
  }[currentEntity];
  $('#confirmDeleteMsg').innerHTML =
    `Delete <strong>${esc(row.name)}</strong>?<br>
     <span class="text-muted small">${row.product_count} linked product${row.product_count === 1 ? '' : 's'}. ${unlinkMsg}</span>`;
  confirmDeleteModal.show();
}

$('#confirmDeleteBtn').addEventListener('click', async () => {
  const res = await fetch(`/api/entities/${currentEntity}/${pendingDelete.id}`, { method: 'DELETE' });
  confirmDeleteModal.hide();
  if (!res.ok) {
    toast((await res.json().catch(() => ({}))).error || 'Delete failed');
    return;
  }
  toast(`Deleted "${pendingDelete.name}"`);
  loadEntities();
  loadProducts();
});