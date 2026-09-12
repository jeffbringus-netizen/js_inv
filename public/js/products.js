import { $, esc, eur, eur4, paginationHtml, copyToClipboard, getJSON } from './ui.js';
import { S, selectedProductIds } from './store.js';
import { openMassEdit } from './mass-edit.js';
import { openModal } from './product-modal.js';

const margin = p => p.cost ? Math.round((p.price / 1.2) / p.cost * 100) : null;
const marginClass = m => m < 200 ? 'text-bg-danger' : m < 400 ? 'text-bg-warning' : m < 600 ? 'text-bg-success' : 'text-bg-primary';
const qtyClass = q => q < 1 ? 'text-bg-danger' : q <= 2 ? 'text-bg-warning' : q <= 5 ? 'text-bg-success' : 'text-bg-primary';

function hl(text) {
  const s = String(text ?? '');
  if (!S.searchQuery) return esc(s);
  const idx = s.toLowerCase().indexOf(S.searchQuery.toLowerCase());
  if (idx === -1) return esc(s);
  return esc(s.slice(0, idx)) + '<strong>' + esc(s.slice(idx, idx + S.searchQuery.length)) + '</strong>' + esc(s.slice(idx + S.searchQuery.length));
}
// ---------- data loading ----------
export async function loadProducts() {
  const params = new URLSearchParams({
    page: S.productPage, limit: 100, includeArchived: S.showArchived ? '1' : '0',
    sort: S.sortKey, dir: S.sortDir === 1 ? 'asc' : 'desc'
  });
  if (S.searchQuery) params.set('q', S.searchQuery);
  Object.entries(S.filters).forEach(([field, value]) => params.set(`filter_${field}`, value));
  // getJSON surfaces server errors through the banner instead of failing silently
  const result = await getJSON('/api/products?' + params);
  S.allProducts = result.items || [];
  S.productPageMeta = result;
  render();
  renderProductPagination();
}

function filterMatches(p, field, value) {
  if (field === 'device') return p.devices.some(d => d.full_name === value);
  if (field === 'feature') return p.features.some(f => f.name === value);
  if (field === 'color') return p.color_name === value;
  return p[field] === value;
}

function visibleProducts() {
  return S.allProducts.filter(p =>
    (S.showArchived || !p.is_archived) &&
    Object.entries(S.filters).every(([field, value]) => filterMatches(p, field, value))
  );
}

function productLabelUrl(model) {
  const template = localStorage.getItem('labelsLinkTemplate') || 'https://example.com/model/*';
  const encodedModel = encodeURIComponent(String(model));
  return template.includes('*') ? template.replaceAll('*', encodedModel) : template + encodedModel;
}

// ---------- table rendering ----------
const colBadge = (field, value, title = '') => value
  ? `<span class="badge filter-badge badge-click" data-filter="${field}" data-value="${esc(value)}"${title ? ` title="${esc(title)}"` : ''}>${hl(value)}</span>`
  : '';

function render() {
  $('#productTable').classList.toggle('margin-hidden', !S.showMargin);
  const rows = visibleProducts();

  $('#productRows').innerHTML = rows.map(p => `
    <tr data-id="${p.id}">
      <td><input class="form-check-input prod-check" type="checkbox" data-id="${p.id}" ${selectedProductIds.has(p.id) ? 'checked' : ''}></td>
      <td class="text-center">${p.location ? colBadge('location', p.location) : ''}</td>
      <td class="text-center">${p.model ? `<span class="badge ${p.is_archived ? 'text-bg-danger' : p.is_online ? 'text-bg-success' : 'model-badge'} badge-click code-badge" title="Click to copy${p.is_online ? ' — online' : ''}${p.is_archived ? ' — archived' : ''}">${p.model}</span>` : ''}</td>
      <td>
        <div>${hl(p.name)}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          ${p.devices.map(d => `<span class="badge text-bg-primary badge-click device-badge" data-filter="device" data-value="${esc(d.full_name)}"${S.filters.device === d.full_name ? '' : ` data-bs-toggle="tooltip" data-bs-placement="top" title="${esc(d.full_name)}"`}>${esc(d.short_name || d.full_name)}</span>`).join('')}
        </div>
      </td>
      <td>${p.category ? colBadge('category', p.category) : ''}</td>
      <td>${p.brand ? colBadge('brand', p.brand, `Suggested price: ${p.brand_price == null ? '—' : eur(p.brand_price)}`) : ''}</td>
      <td>
        <div class="d-flex flex-column gap-1 align-items-start">
          <span class="badge text-bg-dark badge-click code-badge" title="Click to copy">${p.sku}</span>
          ${p.ean ? `<span class="badge text-bg-secondary badge-click code-badge" title="Click to copy">${p.ean}</span>` : ''}
        </div>
      </td>
      <td>
        <div class="d-flex flex-wrap gap-1">
          ${p.features.map(f => `<span class="badge text-bg-success badge-click feature-badge" data-filter="feature" data-value="${esc(f.name)}">${f.name}</span>`).join('')}
        </div>
      </td>
      <td class="text-center">${p.color_name ? `<span class="badge badge-click" data-filter="color" data-value="${esc(p.color_name)}" style="background:${esc(p.tag_color || '#6c757d')};color:${esc(p.tag_text || '#fff')};border:1px solid ${esc(p.tag_border || '#6c757d')}">${hl(p.color_name)}</span>` : ''}</td>
      <td class="text-center">${p.model
        ? `<a class="badge ${qtyClass(p.quantity)} product-label-link" href="${esc(productLabelUrl(p.model))}" target="_blank" rel="noopener noreferrer" title="Open product label link">${p.quantity}</a>`
        : `<span class="badge ${qtyClass(p.quantity)}" title="Quantity in stock">${p.quantity}</span>`}</td>
      <td class="text-nowrap">
        <div class="fw-bold money">${eur(p.price)}</div>
        <div class="small text-muted money">${eur4(p.price / 1.2)}</div>
      </td>
      <td class="margin-cell">
        ${margin(p) === null
          ? '<span class="badge text-bg-light text-muted" title="No cost set">—</span>'
          : `<span class="badge margin-badge ${marginClass(margin(p))}"
              data-bs-toggle="tooltip" data-bs-html="true"
              title="<strong class='text-white'>${esc(eur(p.cost * 1.2))}</strong><br><span class='small text-white'>${esc(eur(p.cost))}</span>">${margin(p)}%</span>`}
      </td>
      <td>
        <button class="btn btn-sm btn-outline-secondary edit-btn" title="Edit">
          <i class="bi bi-pencil"></i>
        </button>
      </td>
    </tr>`).join('');

  // sort indicators
  document.querySelectorAll('#productTable th.sortable').forEach(th => {
    th.classList.remove('asc', 'desc');
    if (th.dataset.sort === S.sortKey) th.classList.add(S.sortDir === 1 ? 'asc' : 'desc');
  });

  // S.filters bar
  $('#activeFilters').innerHTML = Object.entries(S.filters).map(([field, val]) =>
    `<span class="badge text-bg-primary">${field}: ${esc(val)} <i class="bi bi-x-lg filter-remove" data-type="${field}" style="cursor:pointer"></i></span>`).join(' ');

  // tooltips
  document.querySelectorAll('.margin-badge').forEach(el => new bootstrap.Tooltip(el));
  document.querySelectorAll('.device-badge').forEach(el => new bootstrap.Tooltip(el));
  updateMassEditBtn();
}
function renderProductPagination() {
  const html = paginationHtml(S.productPageMeta, 'products', 'products');
  $('#productPaginationTop').innerHTML = html;
  $('#productPaginationBottom').innerHTML = html;
}
// ---------- selection / mass edit ----------
export function updateMassEditBtn() {
  const btn = $('#massEditBtn');
  btn.disabled = selectedProductIds.size === 0;
  btn.innerHTML = `<i class="bi bi-pencil-square"></i> Edit products${selectedProductIds.size ? ` (${selectedProductIds.size})` : ''}`;
}

$('#productRows').addEventListener('change', e => {
  const c = e.target.closest('.prod-check');
  if (!c) return;
  if (c.checked) selectedProductIds.add(Number(c.dataset.id));
  else selectedProductIds.delete(Number(c.dataset.id));
  updateMassEditBtn();
});

$('#checkAllProducts').addEventListener('change', e => {
  const checked = e.target.checked;
  document.querySelectorAll('#productRows .prod-check').forEach(c => {
    c.checked = checked;
    const id = Number(c.dataset.id);
    if (checked) selectedProductIds.add(id); else selectedProductIds.delete(id);
  });
  updateMassEditBtn();
});
// ---------- table events ----------
document.querySelectorAll('#productTable th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (S.sortKey === key) S.sortDir *= -1; else { S.sortKey = key; S.sortDir = 1; }
    S.productPage = 1;
    loadProducts();
  });
});


$('#productRows').addEventListener('click', async e => {
  const code = e.target.closest('.code-badge');
  if (code) {
    await copyToClipboard(code.textContent.trim());
    return;
  }
  const fb = e.target.closest('[data-filter]');
  if (fb) {
    if (fb.dataset.filter === 'device') bootstrap.Tooltip.getInstance(fb)?.dispose();
    S.filters[fb.dataset.filter] = fb.dataset.value;
    S.productPage = 1;
    return loadProducts();
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) openModal(Number(editBtn.closest('tr').dataset.id));
});

$('#activeFilters').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-remove')) return;
  delete S.filters[e.target.dataset.type];
  S.productPage = 1;
  loadProducts();
});
// ---------- search ----------
const searchInput = $('#searchInput');
let searchTimer;
searchInput.addEventListener('input', () => {
  $('#clearSearch').hidden = !searchInput.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    S.searchQuery = searchInput.value.trim();
    S.productPage = 1;
    loadProducts();
  }, 250);
});
$('#clearSearch').addEventListener('click', () => {
  searchInput.value = '';
  S.searchQuery = '';
  $('#clearSearch').hidden = true;
  S.productPage = 1;
  loadProducts();
});
$('#showArchived').addEventListener('change', e => {
  S.showArchived = e.target.checked;
  localStorage.setItem('showArchived', S.showArchived ? '1' : '0');
  S.productPage = 1;
  loadProducts();
});
$('#showMargin').addEventListener('change', e => {
  S.showMargin = e.target.checked;
  localStorage.setItem('showMargin', S.showMargin ? '1' : '0');
  render();
});
$('#massEditBtn').addEventListener('click', openMassEdit);
