// ---------- state ----------
let allProducts = [];
let searchQuery = '';
let productPage = 1;
let productPageMeta = { total: 0, limit: 100 };
const filters = {}; // e.g. { device: 'iPhone 15 Pro', brand: 'Baseus', color: 'Black', ... }
let sortKey = 'location';
let sortDir = 1;
let editingId = null;
let showArchived = localStorage.getItem('showArchived') === '1';
let showMargin = localStorage.getItem('showMargin') !== '0';
const selectedProductIds = new Set();

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => '€ ' + Number(n).toFixed(2);
const eur4 = n => '€ ' + Number(n).toFixed(4);
const margin = p => p.cost ? Math.round((p.price / 1.2) / p.cost * 100) : null;
const marginClass = m => m < 200 ? 'text-bg-danger' : m < 400 ? 'text-bg-warning' : m < 600 ? 'text-bg-success' : 'text-bg-primary';
const qtyClass = q => q < 1 ? 'text-bg-danger' : q <= 2 ? 'text-bg-warning' : q <= 5 ? 'text-bg-success' : 'text-bg-primary';

function hl(text) {
  const s = String(text ?? '');
  if (!searchQuery) return esc(s);
  const idx = s.toLowerCase().indexOf(searchQuery.toLowerCase());
  if (idx === -1) return esc(s);
  return esc(s.slice(0, idx)) + '<strong>' + esc(s.slice(idx, idx + searchQuery.length)) + '</strong>' + esc(s.slice(idx + searchQuery.length));
}

// ---------- data loading ----------
async function loadProducts() {
  const params = new URLSearchParams({ page: productPage, limit: 100, includeArchived: showArchived ? '1' : '0' });
  if (searchQuery) params.set('q', searchQuery);
  Object.entries(filters).forEach(([field, value]) => params.set(`filter_${field}`, value));
  const result = await fetch('/api/products?' + params).then(r => r.json());
  allProducts = result.items || [];
  productPageMeta = result;
  render();
  renderProductPagination();
}

function filterMatches(p, field, value) {
  if (field === 'device') return p.devices.some(d => d.name === value);
  if (field === 'feature') return p.features.some(f => f.name === value);
  return p[field] === value;
}

function visibleProducts() {
  return allProducts.filter(p =>
    (showArchived || !p.is_archived) &&
    Object.entries(filters).every(([field, value]) => filterMatches(p, field, value))
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
  $('#productTable').classList.toggle('margin-hidden', !showMargin);
  const rows = visibleProducts().sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === 'sku') { va = a.sku; vb = b.sku; }
    if (sortKey === 'margin') { va = margin(a); vb = margin(b); }
    if (va === null || va === undefined) return 1;
    if (vb === null || vb === undefined) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sortDir;
  });

  $('#productRows').innerHTML = rows.map(p => `
    <tr data-id="${p.id}">
      <td><input class="form-check-input prod-check" type="checkbox" data-id="${p.id}" ${selectedProductIds.has(p.id) ? 'checked' : ''}></td>
      <td class="text-center">${p.location ? colBadge('location', p.location) : ''}</td>
      <td class="text-center">${p.model ? `<span class="badge ${p.is_archived ? 'text-bg-danger' : p.is_online ? 'text-bg-success' : 'model-badge'} badge-click code-badge" title="Click to copy${p.is_online ? ' — online' : ''}${p.is_archived ? ' — archived' : ''}">${p.model}</span>` : ''}</td>
      <td>
        <div>${hl(p.name)}</div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          ${p.devices.map(d => `<span class="badge text-bg-primary badge-click device-badge" data-filter="device" data-value="${esc(d.name)}"${filters.device === d.name ? '' : ` data-bs-toggle="tooltip" data-bs-placement="top" title="${esc(d.name)}"`}>${esc(d.short_name || d.name)}</span>`).join('')}
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
      <td class="text-center">${colBadge('color', p.color)}</td>
      <td class="text-center">${p.model
        ? `<a class="badge ${qtyClass(p.quantity)} product-label-link" href="${esc(productLabelUrl(p.model))}" target="_blank" rel="noopener noreferrer" title="Open product label link">${p.quantity}</a>`
        : `<span class="badge ${qtyClass(p.quantity)}" title="Quantity in stock">${p.quantity}</span>`}</td>
      <td class="text-nowrap">
        <div class="fw-bold">${eur(p.price)}</div>
        <div class="small text-muted">${eur4(p.price / 1.2)}</div>
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
    if (th.dataset.sort === sortKey) th.classList.add(sortDir === 1 ? 'asc' : 'desc');
  });

  // filters bar
  $('#activeFilters').innerHTML = Object.entries(filters).map(([field, val]) =>
    `<span class="badge text-bg-primary">${field}: ${esc(val)} <i class="bi bi-x-lg filter-remove" data-type="${field}" style="cursor:pointer"></i></span>`).join(' ');

  // tooltips
  document.querySelectorAll('.margin-badge').forEach(el => new bootstrap.Tooltip(el));
  document.querySelectorAll('.device-badge').forEach(el => new bootstrap.Tooltip(el));
  updateMassEditBtn();
}

function paginationHtml(meta, target, label) {
  const pages = Math.ceil(meta.total / meta.limit);
  if (pages <= 1) return '';
  return `<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">
    <span class="text-muted small">${meta.total.toLocaleString()} ${label}</span>
    <div class="btn-group" role="group" aria-label="${label} pagination">
      <button class="btn btn-sm btn-outline-secondary pagination-first" data-target="${target}" aria-label="First page" title="First page" ${meta.page <= 1 ? 'disabled' : ''}><i class="bi bi-chevron-double-left"></i></button>
      <button class="btn btn-sm btn-outline-secondary pagination-prev" data-target="${target}" aria-label="Previous page" title="Previous page" ${meta.page <= 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i></button>
      <span class="btn btn-sm btn-outline-secondary disabled">Page ${meta.page} of ${pages}</span>
      <button class="btn btn-sm btn-outline-secondary pagination-next" data-target="${target}" aria-label="Next page" title="Next page" ${meta.page >= pages ? 'disabled' : ''}><i class="bi bi-chevron-right"></i></button>
      <button class="btn btn-sm btn-outline-secondary pagination-last" data-target="${target}" aria-label="Last page" title="Last page" ${meta.page >= pages ? 'disabled' : ''}><i class="bi bi-chevron-double-right"></i></button>
    </div>
  </div>`;
}

function renderProductPagination() {
  const html = paginationHtml(productPageMeta, 'products', 'products');
  $('#productPaginationTop').innerHTML = html;
  $('#productPaginationBottom').innerHTML = html;
}

// ---------- selection / mass edit ----------
function updateMassEditBtn() {
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
    if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = 1; }
    render();
  });
});

$('#productRows').addEventListener('click', async e => {
  const code = e.target.closest('.code-badge');
  if (code) {
    const text = code.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`Copied: ${text}`);
    return;
  }
  const fb = e.target.closest('[data-filter]');
  if (fb) {
    if (fb.dataset.filter === 'device') bootstrap.Tooltip.getInstance(fb)?.dispose();
    filters[fb.dataset.filter] = fb.dataset.value;
    productPage = 1;
    return loadProducts();
  }
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) openModal(Number(editBtn.closest('tr').dataset.id));
});

$('#activeFilters').addEventListener('click', e => {
  if (!e.target.classList.contains('filter-remove')) return;
  delete filters[e.target.dataset.type];
  productPage = 1;
  loadProducts();
});

// ---------- search ----------
const searchInput = $('#searchInput');
let searchTimer;
searchInput.addEventListener('input', () => {
  $('#clearSearch').hidden = !searchInput.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value.trim();
    productPage = 1;
    loadProducts();
  }, 250);
});
$('#clearSearch').addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  $('#clearSearch').hidden = true;
  productPage = 1;
  loadProducts();
});
$('#showArchived').addEventListener('change', e => {
  showArchived = e.target.checked;
  localStorage.setItem('showArchived', showArchived ? '1' : '0');
  productPage = 1;
  loadProducts();
});
$('#showMargin').addEventListener('change', e => {
  showMargin = e.target.checked;
  localStorage.setItem('showMargin', showMargin ? '1' : '0');
  render();
});

// ---------- autocomplete widget ----------
const AC_CONFIG = {
  categories: { label: 'Category', single: true },
  brands: { label: 'Brand', single: true, prefill: true },
  suppliers: { label: 'Manufacturer / Supplier', single: true, promptFullName: true },
  locations: { label: 'Location', single: true },
  devices: { label: 'Compatible devices', multi: true, promptYear: true },
  features: { label: 'Features', multi: true }
};

function createAutocomplete(container, type, onChange) {
  const cfg = AC_CONFIG[type];
  container.classList.add('ac');
  const label = cfg.single ? `${cfg.label}` : `${cfg.label} <span class="text-muted small">(add multiple)</span>`;
  container.innerHTML = `
    <label class="form-label">${label}</label>
    <input type="text" class="form-control" autocomplete="off" placeholder="Type to search...">
    ${cfg.multi ? '<div class="selected-badges d-flex flex-wrap gap-1 mt-1"></div>' : ''}
    <input type="hidden" class="ac-value">`;

  const input = container.querySelector('input[type=text]');
  const listEl = document.createElement('div');
  listEl.className = 'ac-list d-none';
  container.appendChild(listEl);
  const floatList = !!container.closest('#productModal');

  function positionList() {
    if (!floatList) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < 120 && rect.top > 120;
    const available = showAbove ? rect.top - 8 : spaceBelow - 8;
    listEl.style.position = 'fixed';
    listEl.style.left = `${rect.left}px`;
    listEl.style.width = `${rect.width}px`;
    listEl.style.maxHeight = `${Math.min(220, Math.max(80, available))}px`;
    listEl.style.top = showAbove ? `${rect.top - Math.min(220, available)}px` : `${rect.bottom}px`;
  }

  const state = { selected: [] }; // [{id, name, ...}]
  const api = {
    get value() { return cfg.single ? (state.selected[0]?.id ?? null) : state.selected.map(s => s.id); },
    set(items) {
      state.selected = items ? [...items] : [];
      renderBadges();
    },
    getSelected() { return state.selected; }
  };

  function displayValue(rec) {
    if (type === 'brands' && rec?.price != null) return `${rec.name} (${eur(rec.price)})`;
    return rec?.name || '';
  }

  function renderBadges() {
    const badgeBox = container.querySelector('.selected-badges');
    if (!badgeBox) {
      input.value = displayValue(state.selected[0]);
      return;
    }
    badgeBox.innerHTML = state.selected.map((s, i) =>
      `<span class="badge text-bg-primary">${esc(s.name)}<i class="bi bi-x-lg" data-i="${i}" style="cursor:pointer;margin-left:.3em"></i></span>`).join('');
  }

  badgeBoxClick(container, i => { state.selected.splice(i, 1); renderBadges(); if (onChange) onChange(); });

  async function search() {
    const q = input.value.trim();
    if (!q) { listEl.classList.add('d-none'); return; }
    const rows = await fetch(`/api/entities/${type}?q=` + encodeURIComponent(q)).then(r => r.json());
    const exact = rows.some(r => r.name.toLowerCase() === q.toLowerCase());
    let html = rows.map((r, i) => `<div class="ac-item" data-i="${i}">${esc(r.name)}${r.year ? ` <span class="text-muted small">(${r.year})</span>` : ''}${type === 'brands' && r.price != null ? ` <span class="text-muted small">(${esc(eur(r.price))})</span>` : ''}</div>`).join('');
    if (!exact) html += `<div class="ac-hint">No match for "${esc(q)}" — press Enter to add</div>`;
    listEl.innerHTML = html;
    listEl.rows = rows;
    positionList();
    listEl.classList.remove('d-none');
  }

  let searchTimer;
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 200); });
  input.addEventListener('focus', search);
  if (floatList) {
    window.addEventListener('resize', positionList);
    window.addEventListener('scroll', positionList, true);
  }

  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const exact = (listEl.rows || []).find(r => r.name.toLowerCase() === q.toLowerCase());
    if (exact) return select(exact);
    // create new entity
    const body = { name: q };
    if (cfg.promptYear) {
      const y = prompt(`Year for new device "${q}":`, new Date().getFullYear());
      if (y === null) return;
      body.year = parseInt(y, 10) || new Date().getFullYear();
    }
    if (cfg.promptFullName) {
      const fn = prompt(`Full name for new supplier "${q}":`, q);
      if (fn === null) return;
      body.full_name = fn || q;
    }
    const created = await fetch(`/api/entities/${type}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());
    select(created);
  });

  listEl.addEventListener('mousedown', e => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    e.preventDefault();
    select(listEl.rows[Number(item.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(() => listEl.classList.add('d-none'), 150));

  function select(rec) {
    if (!rec) return;
    if (cfg.single) {
      state.selected = [rec];
      input.value = displayValue(rec);
      if (cfg.prefill && rec.price != null && container.closest('#productForm')) {
        const form = $('#productForm');
        if (!form.price.dataset.touched) form.price.value = rec.price;
        if (!form.cost.dataset.touched) form.cost.value = rec.cost ?? '';
      }
    } else {
      if (!state.selected.some(s => s.id === rec.id)) state.selected.push(rec);
      input.value = '';
    }
    renderBadges();
    listEl.classList.add('d-none');
    if (onChange) onChange();
  }

  return api;
}

function badgeBoxClick(container, onRemove) {
  const box = container.querySelector('.selected-badges');
  if (!box) return;
  box.addEventListener('click', e => {
    if (e.target.dataset.i !== undefined) onRemove(Number(e.target.dataset.i));
  });
}

const acWidgets = {};
document.querySelectorAll('[data-ac]').forEach(el => {
  acWidgets[el.dataset.ac] = createAutocomplete(el, el.dataset.ac);
});

// ---------- modal ----------
const productModal = new bootstrap.Modal('#productModal');
const form = $('#productForm');
form.price.addEventListener('input', () => form.price.dataset.touched = '1');
form.cost.addEventListener('input', () => form.cost.dataset.touched = '1');
const modalOnlineToggle = $('#modalOnlineToggle');
const modalArchivedToggle = $('#modalArchivedToggle');

function syncModalStatusToggles() {
  modalOnlineToggle.checked = form.is_online.checked;
  modalArchivedToggle.checked = form.is_archived.checked;
}

modalOnlineToggle.addEventListener('change', () => { form.is_online.checked = modalOnlineToggle.checked; });
modalArchivedToggle.addEventListener('change', () => { form.is_archived.checked = modalArchivedToggle.checked; });

let formSnapshot = '';
let allowModalHide = false;
const productModalElement = $('#productModal');

productModalElement.addEventListener('click', event => {
  if (!event.target.closest('[data-bs-dismiss="modal"], .btn-close')) return;
  event.preventDefault();
  event.stopPropagation();
  allowModalHide = true;
  $('.modal-error').hidden = true;
  productModal.hide();
}, true);

function serializeProductForm() {
  return JSON.stringify({
    f: ['model', 'name', 'ean', 'sku', 'color', 'quantity', 'price', 'cost', 'supplier_name'].map(n => form[n].value),
    online: form.is_online.checked,
    archived: form.is_archived.checked,
    ac: ['brands', 'categories', 'suppliers', 'locations'].map(k => acWidgets[k].getSelected().map(x => x.id)),
    devices: acWidgets.devices.getSelected().map(x => x.id).sort((a, b) => a - b),
    features: acWidgets.features.getSelected().map(x => x.id).sort((a, b) => a - b)
  });
}

function showUnsavedChangesPrompt(warningElement) {
  warningElement.textContent = 'You have unsaved changes. Save the product or undo your changes before closing.';
  warningElement.hidden = false;
  warningElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

$('#productModal').addEventListener('hide.bs.modal', e => {
  if (allowModalHide) return;
  if (serializeProductForm() === formSnapshot) return; // nothing changed — close normally
  e.preventDefault();
  showUnsavedChangesPrompt($('#productModal .modal-error'));
});
$('#productModal').addEventListener('hidden.bs.modal', () => { allowModalHide = false; });

async function openModal(id) {
  editingId = id ?? null;
  delete form.price.dataset.touched;
  delete form.cost.dataset.touched;
  form.reset();
  syncModalStatusToggles();
  form.model.placeholder = '';
  document.querySelectorAll('.selected-badges').forEach(b => b.innerHTML = '');
  $('.modal-error').hidden = true;
  $('.modal-error').textContent = '';

  if (id) {
    $('#modalTitle').textContent = 'Edit product';
    const p = allProducts.find(x => x.id === id);
    form.model.value = p.model || '';
    if (!p.model) {
      try {
        const next = await fetch('/api/products/next-model').then(r => r.json());
        form.model.placeholder = next.model || '';
      } catch (_) {}
    }
    form.name.value = p.name;
    form.sku.value = p.sku;
    form.ean.value = p.ean;
    form.color.value = p.color;
    form.quantity.value = p.quantity;
    form.price.value = p.price;
    form.cost.value = p.cost;
    form.supplier_name.value = p.supplier_name || '';
    form.is_online.checked = !!p.is_online;
    form.is_archived.checked = !!p.is_archived;
    acWidgets.brands.set(p.brand_id ? [{ id: p.brand_id, name: p.brand, price: p.brand_price, cost: p.brand_cost }] : []);
    acWidgets.categories.set(p.category_id ? [{ id: p.category_id, name: p.category }] : []);
    acWidgets.suppliers.set(p.supplier_id ? [{ id: p.supplier_id, name: p.supplier }] : []);
    acWidgets.locations.set(p.location_id ? [{ id: p.location_id, name: p.location }] : []);
    acWidgets.devices.set(p.devices);
    acWidgets.features.set(p.features);
  } else {
    $('#modalTitle').textContent = 'Add product';
    Object.values(acWidgets).forEach(w => w.set([]));
    const next = await fetch('/api/products/next-model').then(r => r.json());
    form.model.value = next.model;
    form.quantity.value = 0;
  }
  syncModalStatusToggles();
  formSnapshot = serializeProductForm();
  productModal.show();
}

$('#addProductBtn').addEventListener('click', () => openModal(null));
$('#massEditBtn').addEventListener('click', openMassEdit);

// ---------- mass edit: pick one field, see per-product impact, apply ----------
const massEditModal = new bootstrap.Modal('#massEditModal');
let massProducts = [];
let massField = null;
let massValueWidget = null;

const MASS_FIELDS = {
  color: { label: 'Color', type: 'text' },
  quantity: { label: 'Quantity', type: 'number', int: true },
  cost: { label: 'Purchase price', type: 'number', step: '0.01' },
  price: { label: 'Sale price', type: 'number', step: '0.01' },
  is_online: { label: 'Online', type: 'switch' },
  is_archived: { label: 'Archived', type: 'switch' },
  category_id: { label: 'Category', type: 'entity', entity: 'categories' },
  brand_id: { label: 'Brand', type: 'entity', entity: 'brands' },
  supplier_id: { label: 'Supplier', type: 'entity', entity: 'suppliers' },
  location_id: { label: 'Location', type: 'entity', entity: 'locations' },
  devices: { label: 'Devices', type: 'multi', entity: 'devices' },
  features: { label: 'Features', type: 'multi', entity: 'features' }
};

function openMassEdit() {
  massProducts = allProducts.filter(p => selectedProductIds.has(p.id));
  if (massProducts.length === 0) return;
  massField = null;
  $('#massEditTitle').textContent = `Edit ${massProducts.length} product${massProducts.length === 1 ? '' : 's'}`;
  $('#massChooseCount').textContent = String(massProducts.length);
  $('#massChoose').classList.remove('d-none');
  $('#massEditStep').classList.add('d-none');
  $('#massSaveBtn').classList.add('d-none');
  massEditModal.show();
}

function currentMassValue(p) {
  if (massField === 'is_online') return p.is_online;
  if (massField === 'devices' || massField === 'features') return (p[massField] || []).map(x => x.name);
  return p[massField.replace('_id', '')] ?? null;
}

function fmtMassValue(field, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'is_online') return (v === 1 || v === '1' || v === true) ? 'online' : 'offline';
  if (field === 'is_archived') return (v === 1 || v === '1' || v === true) ? 'archived' : 'active';
  if (field === 'price' || field === 'cost') return eur(v);
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function newMassValue() {
  const def = MASS_FIELDS[massField];
  if (def.type === 'switch') return $('#massValueInput').checked ? 1 : 0;
  if (def.type === 'entity') return massValueWidget.getSelected()[0]?.name ?? null;
  if (def.type === 'multi') return massValueWidget.getSelected().map(x => x.name);
  const raw = $('#massValueInput').value.trim();
  if (raw === '') return null;
  return def.type === 'number' ? Number(raw) : raw;
}

function massFieldTouched() {
  const def = MASS_FIELDS[massField];
  if (def.type === 'switch') return true;
  if (def.type === 'entity') return !!newMassValue();
  if (def.type === 'multi') return true;
  return $('#massValueInput').value.trim() !== '';
}

function renderMassPreview() {
  const def = MASS_FIELDS[massField];
  if (!def) return;
  const newVal = newMassValue();
  const touched = massFieldTouched();
  $('#massProductRows').innerHTML = massProducts.map(p => {
    const oldV = currentMassValue(p);
    let cell;
    if (def.type === 'switch' && newVal === 1 && !p.model) {
      cell = '<span class="text-muted">Unavailable (model required)</span>';
    } else if (def.type === 'multi') {
      const newNames = Array.isArray(newVal) ? newVal : [];
      const oldSet = new Set(oldV);
      const newSet = new Set(newNames);
      const parts = [];
      for (const v of oldV) {
        if (newSet.has(v)) parts.push(esc(v));
        else parts.push(`<s class="text-muted">${esc(v)}</s>`);
      }
      for (const v of newNames) {
        if (!oldSet.has(v)) parts.push(`<span class="text-success fw-bold">${esc(v)}</span>`);
      }
      cell = parts.length ? parts.join(', ') : '<span class="text-muted">—</span>';
    } else if (touched) {
      const ov = fmtMassValue(massField, oldV);
      const nv = fmtMassValue(massField, newVal);
      cell = String(ov) !== String(nv) ? diffCell(ov, nv, false) : esc(ov);
    } else {
      cell = esc(fmtMassValue(massField, oldV));
    }
    return `<tr>
      <td>${esc(p.model || '')}</td>
      <td>${esc(p.name)}</td>
      <td>
        <div class="d-flex flex-column gap-1 align-items-start">
          <span class="badge text-bg-dark">${esc(p.sku)}</span>
          <span class="badge text-bg-secondary">${esc(p.ean)}</span>
        </div>
      </td>
      <td>${cell}</td>
    </tr>`;
  }).join('');
}

function showMassError(msg) {
  const el = $('#massError');
  el.textContent = msg;
  el.hidden = false;
}

function chooseMassField(field) {
  massField = field;
  const def = MASS_FIELDS[field];
  $('#massChoose').classList.add('d-none');
  $('#massEditStep').classList.remove('d-none');
  $('#massValueHeader').textContent = def.label;
  $('#massError').hidden = true;
  $('#massSaveBtn').classList.remove('d-none');
  $('#massSaveCloseBtn').classList.remove('d-none');
  const area = $('#massEditorArea');
  if (def.type === 'switch') {
    area.innerHTML = `
      <label class="form-label d-block">${def.label}</label>
      <div class="form-check form-switch fs-4">
        <input class="form-check-input" type="checkbox" id="massValueInput" role="switch">
      </div>`;
    $('#massValueInput').addEventListener('change', renderMassPreview);
  } else if (def.type === 'entity') {
    area.innerHTML = `<label class="form-label">${def.label}</label><div id="massValueAc"></div>`;
    massValueWidget = createAutocomplete($('#massValueAc'), def.entity, renderMassPreview);
  } else if (def.type === 'multi') {
    area.innerHTML = `<label class="form-label">${def.label} <span class="text-muted small">(the selected list replaces the current one on every product)</span></label><div id="massValueAc"></div>`;
    massValueWidget = createAutocomplete($('#massValueAc'), def.entity, renderMassPreview);
  } else {
    area.innerHTML = `
      <label class="form-label">${def.label} <span class="text-muted small">(leave empty to keep current values)</span></label>
      <input id="massValueInput" type="${def.type}" ${def.step ? `step="${def.step}"` : ''} class="form-control" autocomplete="off">`;
    $('#massValueInput').addEventListener('input', renderMassPreview);
  }
  renderMassPreview();
}

document.querySelectorAll('.mass-field-btn').forEach(btn => {
  btn.addEventListener('click', () => chooseMassField(btn.dataset.field));
});
$('#massBackBtn').addEventListener('click', () => {
  massField = null;
  massValueWidget = null;
  $('#massEditStep').classList.add('d-none');
  $('#massSaveBtn').classList.add('d-none');
  $('#massSaveCloseBtn').classList.add('d-none');
  $('#massChoose').classList.remove('d-none');
});

async function saveMassEdit(closeAfter) {
  const def = MASS_FIELDS[massField];
  const settingOnline = def.type === 'switch' && $('#massValueInput').checked;
  const targetProducts = settingOnline ? massProducts.filter(p => p.model) : massProducts;
  const body = { ids: targetProducts.map(p => p.id), patch: {} };
  if (body.ids.length === 0) return showMassError('No selected products can be set online');
  if (def.type === 'switch') {
    body.patch[massField] = $('#massValueInput').checked ? 1 : 0;
  } else if (def.type === 'entity') {
    const id = massValueWidget.value;
    if (!id) return showMassError(`Please select a ${def.label.toLowerCase()}`);
    body.patch[massField] = id;
  } else if (def.type === 'multi') {
    body[def.entity === 'devices' ? 'device_ids' : 'feature_ids'] = massValueWidget.value;
  } else {
    const raw = $('#massValueInput').value.trim();
    if (raw === '') return showMassError(`Enter a ${def.label.toLowerCase()} value`);
    body.patch[massField] = def.type === 'number' ? Number(raw) : raw;
  }
  const res = await fetch('/api/products/mass-update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return showMassError(out.error || 'Update failed');
  toast(out.skipped ? 'No products needed changes' : `Updated ${out.updated} product${out.updated === 1 ? '' : 's'} — ${def.label.toLowerCase()}`);
  if (closeAfter) {
    massEditModal.hide();
    selectedProductIds.clear();
    updateMassEditBtn();
    loadProducts();
    return;
  }
  // stay in the modal so another field can be edited for the same selection:
  // refresh products first so previews show the values just saved
  await loadProducts();
  massProducts = allProducts.filter(p => selectedProductIds.has(p.id));
  $('#massBackBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

$('#massSaveBtn').addEventListener('click', () => saveMassEdit(false));
$('#massSaveCloseBtn').addEventListener('click', () => saveMassEdit(true));

$('#addProductBtn').addEventListener('click', () => openModal(null));

$('#saveProductBtn').addEventListener('click', async () => {
  const body = Object.fromEntries(new FormData(form).entries());
  body.is_online = form.is_online.checked ? 1 : 0;
  body.is_archived = form.is_archived.checked ? 1 : 0;
  body.quantity = Number(body.quantity);
  body.price = Number(body.price);
  body.cost = Number(body.cost);
  body.brand_id = acWidgets.brands.value;
  body.category_id = acWidgets.categories.value;
  body.supplier_id = acWidgets.suppliers.value;
  body.location_id = acWidgets.locations.value;
  body.device_ids = acWidgets.devices.value;
  body.feature_ids = acWidgets.features.value;
  body.model = body.model || null;
  body.supplier_name = body.supplier_name || null;

  const url = editingId ? '/api/products/' + editingId : '/api/products';
  const res = await fetch(url, {
    method: editingId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const el = $('.modal-error');
    el.textContent = err.error || 'Save failed';
    el.hidden = false;
    return;
  }
  allowModalHide = true;
  productModal.hide();
  loadProducts();
});

// ---------- entities management (locations/devices/categories/brands/features) ----------
const ENTITY_DEFS = {
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

function openEntityTab(type) {
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
    <td>${entityHl(r.name)}</td>
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
    if (button.classList.contains('pagination-first')) productPage = 1;
    else if (button.classList.contains('pagination-last')) productPage = Math.ceil(productPageMeta.total / productPageMeta.limit);
    else productPage += button.classList.contains('pagination-next') ? 1 : -1;
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
  return ENTITY_DEFS[currentEntity].fields.map(f => `
    <div class="col-12">
      <label class="form-label">${f.label}${f.required ? ' *' : ''}</label>
      <input name="${f.key}" type="${f.type}" ${f.step ? `step="${f.step}"` : ''} class="form-control" ${f.required ? 'required' : ''}>
    </div>`).join('');
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
  entityModal.show();
}

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
    locations: 'Products in this location will be left without a location.'
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

// ---------- history ----------
const HIST_TYPE_BADGE = {
  products: 'text-bg-primary', sales: 'text-bg-success', purchases: 'text-bg-info',
  devices: 'text-bg-info', features: 'text-bg-success', brands: 'text-bg-warning',
  categories: 'text-bg-secondary', locations: 'text-bg-dark', suppliers: 'text-bg-secondary', backups: 'text-bg-dark'
};
const HIST_ACTION_BADGE = {
  create: 'text-bg-success', update: 'text-bg-warning', delete: 'text-bg-danger',
  complete: 'text-bg-success', cancel: 'text-bg-danger', import: 'text-bg-info'
};
const HISTORY_FIELD_LABELS = {
  model: 'Model', name: 'Name', ean: 'EAN', sku: 'SKU', color: 'Color',
  quantity: 'Quantity', price: 'Price', cost: 'Cost',
  supplier_name: "Supplier's product name", brand: 'Brand', category: 'Category',
  supplier: 'Supplier', location: 'Location', devices: 'Devices', features: 'Features',
  is_archived: 'Archived',
  customer: 'Customer', total: 'Total', status: 'Status', year: 'Year',
  full_name: 'Full name', products: 'Products', shipping: 'Shipping', is_online: 'Online'
};

let historyRows = [];

async function loadHistory() {
  const type = $('#historyFilter').value;
  historyRows = await fetch('/api/history?type=' + type).then(r => r.json());
  renderHistory();
}

function fmtHistField(k, v) {
  if (k === 'is_online') return (v === 1 || v === '1') ? 'online' : 'offline';
  if ((k === 'price' || k === 'cost') && v !== null && v !== undefined && v !== '') return eur(v);
  return v;
}

function historyChangePreview(h) {
  if (!h.changes) return '';
  const keys = Object.keys(h.changes);
  if (!keys.length) return '';
  const f = keys[0];
  const c = h.changes[f];
  const label = HISTORY_FIELD_LABELS[f] || f;
  const oldV = fmtHistField(f, Array.isArray(c.old) ? c.old.join(', ') : c.old);
  const newV = fmtHistField(f, Array.isArray(c.new) ? c.new.join(', ') : c.new);
  const extra = keys.length > 1 ? ` <span class="text-muted">(+${keys.length - 1} more)</span>` : '';
  return `<div class="small text-muted">${esc(label)}: <s>${esc(oldV ?? '—')}</s> → ${esc(newV ?? '—')}${extra}</div>`;
}

function histLabelHtml(h) {
  const actionPrefix = h.action === 'create' ? '<strong>Created — </strong>'
    : h.action === 'delete' ? '<strong>Deleted — </strong>'
    : h.action === 'import' ? '<strong>Imported — </strong>'
    : '';
  if (h.entity_type === 'products' && h.label.includes(' — ')) {
    const [model, ...rest] = h.label.split(' — ');
    return `${actionPrefix}<strong>${esc(model)}</strong> — ${esc(rest.join(' — '))}`;
  }
  return `${actionPrefix}${esc(h.label)}`;
}

function renderHistory() {
  $('#historyRows').innerHTML = historyRows.map((h, i) => `<tr data-i="${i}">
    <td>
      <span class="badge ${HIST_TYPE_BADGE[h.entity_type] || 'text-bg-secondary'}">${h.entity_type}</span>
    </td>
    <td class="text-nowrap">${esc(h.created_at)}</td>
    <td>${histLabelHtml(h)}${historyChangePreview(h)}</td>
    <td><button class="btn btn-sm btn-outline-secondary hist-info" title="More info"><i class="bi bi-eye"></i></button></td>
  </tr>`).join('') || '<tr><td colspan="4" class="text-muted text-center py-3">No changes recorded yet.</td></tr>';
}

$('#historyFilter').addEventListener('change', loadHistory);

$('#historyRows').addEventListener('click', e => {
  const btn = e.target.closest('.hist-info');
  if (!btn) return;
  openHistoryInfo(historyRows[Number(btn.closest('tr').dataset.i)]);
});

const historyInfoModal = new bootstrap.Modal('#historyInfoModal');

function historySnapshotValue(v) {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) {
    // sale/purchase items or name lists
    if (v.length && typeof v[0] === 'object') {
      return `<ul class="mb-0 ps-3">${v.map(it =>
        `<li>${esc(it.name || '')}${it.quantity !== undefined ? ` × ${it.quantity}${it.price !== undefined ? ` — ${eur(it.price * it.quantity)}` : ''}` : ''}</li>`).join('')}</ul>`;
    }
    return esc(v.join(', '));
  }
  if (typeof v === 'object') return esc(JSON.stringify(v));
  return esc(String(v));
}

function openHistoryInfo(h) {
  $('#historyInfoTitle').innerHTML =
    `<span class="badge ${HIST_TYPE_BADGE[h.entity_type] || 'text-bg-secondary'}">${h.entity_type}</span> ${histLabelHtml(h)}`;
  let body = `<div class="text-muted small mb-3">${esc(h.created_at)}</div>`;
  const snap = h.snapshot || {};

  function listDiffCell(oldStr, newStr) {
  const toList = s => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const oldL = toList(oldStr), newL = toList(newStr);
  const oldSet = new Set(oldL), newSet = new Set(newL);
  const parts = [];
  for (const v of oldL) {
    if (newSet.has(v)) parts.push(esc(v));
    else parts.push(`<s class="text-muted">${esc(v)}</s>`);
  }
  for (const v of newL) {
    if (!oldSet.has(v)) parts.push(`<span class="text-success fw-bold">${esc(v)}</span>`);
  }
  return parts.length ? parts.join(', ') : '—';
}

// mass-update records: applied changes + per-product before-values
  if (snap.applied && Array.isArray(snap.before)) {
    const appliedKeys = Object.keys(snap.applied);
    const normCmp = (k, v) => {
      if (k === 'devices' || k === 'features') {
        return String(v ?? '').split(',').map(s => s.trim()).filter(Boolean).sort().join(', ');
      }
      return String(fmtHistField(k, v) ?? '');
    };
    body += '<h6 class="mb-2">Applied to all selected products</h6><table class="table table-sm">';
    for (const [k, v] of Object.entries(snap.applied)) {
      body += `<tr><td style="width:220px;">${esc(HISTORY_FIELD_LABELS[k] || k)}</td><td><strong>${esc(fmtHistField(k, v) ?? v)}</strong></td></tr>`;
    }
    body += '</table>';
    body += '<h6 class="mt-3 mb-2">Products before update <span class="text-muted small">(crossed values were changed)</span></h6>';
    body += '<div class="table-responsive"><table class="table table-sm table-bordered"><thead class="table-light"><tr><th>Product</th>';
    body += appliedKeys.map(k => `<th>${esc(HISTORY_FIELD_LABELS[k] || k)}</th>`).join('');
    body += '</tr></thead><tbody>';
    for (const b of snap.before) {
      body += `<tr><td>${esc(b.label)}</td>`;
      for (const k of appliedKeys) {
        const isList = k === 'devices' || k === 'features';
        const oldV = fmtHistField(k, b[k]);
        const newV = fmtHistField(k, snap.applied[k]);
        body += `<td>${isList ? listDiffCell(b[k], snap.applied[k]) : (normCmp(k, b[k]) !== normCmp(k, snap.applied[k]) ? diffCell(oldV, newV) : esc(oldV ?? '—') || '—')}</td>`;
      }
      body += '</tr>';
    }
    body += '</tbody></table></div>';
    $('#historyInfoBody').innerHTML = body;
    historyInfoModal.show();
    return;
  }

  const snapKeys = Object.keys(snap).filter(k =>
    k !== 'id' && !k.endsWith('_id') && k !== 'brand_price' && k !== 'brand_cost');
  if (snapKeys.length) {
    body += '<h6 class="mb-2">Data ' + (h.action === 'update' ? 'before change <span class="text-muted small">(crossed values were changed)</span>' : 'at time of ' + h.action) + '</h6>';
    body += '<table class="table table-sm">';
    for (const key of snapKeys) {
      const label = HISTORY_FIELD_LABELS[key] || key;
      const changed = h.changes && h.changes[key];
      let value;
      if (changed) {
        const oldV = Array.isArray(changed.old) ? changed.old.join(', ') : changed.old;
        const newV = Array.isArray(changed.new) ? changed.new.join(', ') : changed.new;
        value = `<s class="text-muted">${esc(oldV ?? '—')}</s> <i class="bi bi-arrow-right"></i> <strong>${esc(newV ?? '—')}</strong>`;
      } else {
        value = historySnapshotValue(snap[key]);
      }
      body += `<tr><td style="width:220px;">${esc(label)}</td><td>${value}</td></tr>`;
    }
    body += '</table>';
  } else {
    body += '<div class="text-muted">No details stored.</div>';
  }
  $('#historyInfoBody').innerHTML = body;
  historyInfoModal.show();
}

// ---------- backups ----------
let backups = [];

async function loadBackups() {
  backups = await fetch('/api/backups').then(r => r.json());
  renderBackups();
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}

function renderBackups() {
  $('#backupRows').innerHTML = backups.map(b => `<tr data-name="${esc(b.name)}">
    <td>${esc(b.name)}</td>
    <td>${new Date(b.created_at).toLocaleString()}</td>
    <td>${fmtSize(b.size)}</td>
    <td class="d-flex gap-1">
      <a class="btn btn-sm btn-outline-secondary" href="/api/backups/${encodeURIComponent(b.name)}/download" title="Download"><i class="bi bi-download"></i></a>
      <button class="btn btn-sm btn-outline-warning bk-restore" title="Restore this backup"><i class="bi bi-arrow-counterclockwise"></i></button>
      <button class="btn btn-sm btn-outline-danger bk-delete" title="Delete"><i class="bi bi-trash"></i></button>
    </td>
  </tr>`).join('') || '<tr><td colspan="4" class="text-muted text-center py-3">No backups yet.</td></tr>';
}

$('#createBackupBtn').addEventListener('click', async () => {
  const res = await fetch('/api/backups', { method: 'POST' });
  if (!res.ok) return toast((await res.json().catch(() => ({}))).error || 'Backup failed');
  const b = await res.json();
  toast(`Backup created (${fmtSize(b.size)})`);
  loadBackups();
});

const restoreModal = new bootstrap.Modal('#restoreModal');
let pendingRestore = null;

$('#backupRows').addEventListener('click', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const name = tr.dataset.name;
  if (e.target.closest('.bk-restore')) {
    pendingRestore = name;
    $('#restoreMsg').innerHTML =
      `Restore <strong>${esc(name)}</strong>?<br>
       <span class="text-muted small">All current data will be replaced with this backup and the app will restart automatically.</span>`;
    restoreModal.show();
  } else if (e.target.closest('.bk-delete')) {
    fetch('/api/backups/' + encodeURIComponent(name), { method: 'DELETE' })
      .then(r => { if (!r.ok) throw 0; toast('Backup deleted'); loadBackups(); })
      .catch(() => toast('Delete failed'));
  }
});

$('#confirmRestoreBtn').addEventListener('click', () => {
  if (!pendingRestore) return;
  restoreModal.hide();
  toast('Restoring backup, the app will restart…');
  fetch(`/api/backups/${encodeURIComponent(pendingRestore)}/restore`, { method: 'POST' })
    .catch(() => {});
});

// ---------- init ----------
$('#showArchived').checked = showArchived;
$('#showMargin').checked = showMargin;
const savedLabelsLinkTemplate = localStorage.getItem('labelsLinkTemplate');
if (savedLabelsLinkTemplate !== null) $('#labelsLinkTemplate').value = savedLabelsLinkTemplate;
loadProducts();

// ---------- toast ----------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ---------- view tabs ----------
const menuToggle = $('#menuToggle');
const sidebarVisible = false; // start collapsed; the toggle button opens it
menuToggle.setAttribute('aria-expanded', String(sidebarVisible));
menuToggle.addEventListener('click', () => {
  const visible = document.body.classList.toggle('sidebar-visible');
  menuToggle.setAttribute('aria-expanded', String(visible));
});

const VIEW_IDS = {
  products: '#productsView',
  sales: '#ordersView',
  purchases: '#purchasesView',
  locations: '#entitiesView',
  devices: '#entitiesView',
  categories: '#entitiesView',
  brands: '#entitiesView',
  suppliers: '#entitiesView',
  features: '#entitiesView',
  history: '#historyView',
  backups: '#backupsView',
  webstock: '#webstockView',
  labels: '#labelsView'
};

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
$('#copyWebstockExportSqlBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(webstockExportSql); }
  catch { toast('Could not copy SQL'); return; }
  toast('SQL copied to clipboard');
});
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
$('#copyWebstockSqlBtn').addEventListener('click', async () => {
  const sql = $('#webstockSqlCode').textContent;
  try { await navigator.clipboard.writeText(sql); }
  catch { toast('Could not copy SQL'); return; }
  toast('SQL copied to clipboard');
});

$('#labelsLinkTemplate').addEventListener('input', e => {
  localStorage.setItem('labelsLinkTemplate', e.target.value);
});

$('#generateLabelsBtn').addEventListener('click', async () => {
  const button = $('#generateLabelsBtn');
  const status = $('#labelsStatus');
  const linkTemplate = $('#labelsLinkTemplate').value.trim();
  if (!linkTemplate) {
    status.textContent = 'Enter a link URL first.';
    status.className = 'text-danger small ms-2';
    return;
  }
  button.disabled = true;
  status.textContent = 'Generating...';
  status.className = 'text-muted small ms-2';
  try {
    const params = new URLSearchParams({
      link: linkTemplate,
      includeOutOfStock: $('#includeOutOfStock').checked ? '1' : '0'
    });
    const response = await fetch('/api/admin/labels-xlsx?' + params.toString());
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Could not generate labels');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'product-labels.xlsx';
    anchor.click();
    URL.revokeObjectURL(url);
    status.textContent = 'Downloaded.';
    status.className = 'text-success small ms-2';
  } catch (error) {
    status.textContent = error.message;
    status.className = 'text-danger small ms-2';
  } finally {
    button.disabled = false;
  }
});

function selectView(view, updateUrl = true) {
  if (!VIEW_IDS[view]) view = 'products';

  document.querySelectorAll('#mainTabs .nav-link').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  const targetSel = VIEW_IDS[view];
  for (const sel of new Set(Object.values(VIEW_IDS))) {
    $(sel).classList.toggle('d-none', sel !== targetSel);
  }
  if (view === 'sales') loadOrders();
  else if (view === 'purchases') loadPurchases();
  else if (view === 'history') loadHistory();
  else if (view === 'backups') loadBackups();
  else if (ENTITY_DEFS[view]) openEntityTab(view);
  if (updateUrl && window.location.hash !== `#${view}`) {
    window.history.pushState(null, '', `#${view}`);
  }
  if (window.innerWidth <= 767) {
    document.body.classList.remove('sidebar-visible');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
}

document.querySelectorAll('#mainTabs .nav-link').forEach(button => {
  button.addEventListener('click', () => selectView(button.dataset.view));
});

window.addEventListener('hashchange', () => {
  selectView(window.location.hash.slice(1), false);
});

selectView(window.location.hash.slice(1) || 'products', false);

// ---------- orders ----------
let orders = [];

async function loadOrders() {
  orders = await fetch('/api/sale-orders').then(r => r.json());
  renderOrders();
}

const STATUS_BADGE = { draft: 'text-bg-secondary', completed: 'text-bg-success', canceled: 'text-bg-danger' };

function renderOrders() {
  $('#orderRows').innerHTML = orders.map(o => {
    const total = o.status === 'completed' ? o.total : o.live_total;
    const actions = [];
    if (o.status === 'draft') {
      actions.push(`<button class="btn btn-sm btn-outline-secondary order-edit" title="Edit order"><i class="bi bi-pencil"></i></button>`);
    } else {
      actions.push(`<button class="btn btn-sm btn-outline-secondary order-view" title="View"><i class="bi bi-eye"></i></button>`);
    }
    if (o.status !== 'canceled') {
      actions.push(`<button class="btn btn-sm btn-outline-danger order-cancel" title="Cancel order"><i class="bi bi-ban"></i></button>`);
    }
    return `<tr data-id="${o.id}">
      <td>${o.id}</td>
      <td>${esc(o.customer || '')}</td>
      <td><span class="badge ${STATUS_BADGE[o.status] || 'text-bg-secondary'}">${o.status}</span></td>
      <td>${o.item_count}</td>
      <td class="fw-bold">${eur(total)}</td>
      <td>${esc(o.created_at)}</td>
      <td class="d-flex gap-1">${actions.join('')}</td>
    </tr>`;
  }).join('');
}

$('#orderRows').addEventListener('click', async e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (e.target.closest('.order-edit') || e.target.closest('.order-view')) {
    openSale(id, !!e.target.closest('.order-view'));
  } else if (e.target.closest('.order-cancel')) {
    const res = await fetch(`/api/sale-orders/${id}/cancel`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return toast(err.error || 'Cancel failed');
    }
    toast(`Order #${id} canceled`);
    loadOrders();
    loadProducts(); // stock may have been restored
  }
});

// ---------- sale modal ----------
const saleModal = new bootstrap.Modal('#saleModal');
const saleModalElement = $('#saleModal');
let saleItems = [];       // {product_id, name, sku, price, quantity, stock}
let saleOrderId = null;   // existing order id when editing/saving
let saleReadOnly = false;
let saleSnapshot = { customer: '', itemCount: 0 };
let allowSaleModalHide = false;

function saleHasUnsavedData() {
  return !saleReadOnly && (
    saleItems.length > 0 ||
    $('#saleCustomer').value.trim() !== saleSnapshot.customer
  );
}

saleModalElement.addEventListener('hide.bs.modal', event => {
  if (allowSaleModalHide || !saleHasUnsavedData()) return;
  event.preventDefault();
  saleError('You have unsaved sale data. Save the sale or remove the changes before closing.');
});
saleModalElement.addEventListener('click', event => {
  if (!event.target.closest('[data-bs-dismiss="modal"], .btn-close')) return;
  event.preventDefault();
  event.stopPropagation();
  allowSaleModalHide = true;
  $('#saleError').hidden = true;
  saleModal.hide();
}, true);
saleModalElement.addEventListener('hidden.bs.modal', () => {
  allowSaleModalHide = false;
  saleSnapshot = { customer: '', itemCount: 0 };
});

function saleTotal() {
  return saleItems.reduce((s, it) => s + it.price * it.quantity, 0);
}

function renderSaleItems() {
  $('#saleItems').innerHTML = saleItems.map((it, i) => `
    <tr>
      <td>${esc(it.model || '')}</td>
      <td>${esc(it.name)}<div class="small text-muted">${esc(it.sku || '')}</div></td>
      <td>
        <input type="number" min="1" max="${it.stock}" step="1" value="${it.quantity}" class="form-control form-control-sm sale-qty" data-i="${i}" ${saleReadOnly ? 'disabled' : ''}>
      </td>
      <td>${eur(it.price)}</td>
      <td>${eur(it.price * it.quantity)}</td>
      <td>${saleReadOnly ? '' : `<button class="btn btn-sm btn-outline-danger sale-remove" data-i="${i}" title="Remove"><i class="bi bi-trash"></i></button>`}</td>
    </tr>`).join('');
  $('#saleTotal').textContent = eur(saleTotal());
}

function addSaleItem(p) {
  const existing = saleItems.find(it => it.product_id === p.id);
  if (existing) {
    if (existing.quantity >= existing.stock) {
      toast(`Only ${existing.stock} in stock`);
      return;
    }
    existing.quantity++;
  } else {
    if (p.quantity < 1) { toast(`"${p.name}" is out of stock`); return; }
    saleItems.push({ product_id: p.id, name: p.name, model: p.model, sku: p.sku, price: p.price, quantity: 1, stock: p.quantity });
  }
  renderSaleItems();
}

$('#saleItems').addEventListener('click', e => {
  const rm = e.target.closest('.sale-remove');
  if (rm) { saleItems.splice(Number(rm.dataset.i), 1); renderSaleItems(); }
});
$('#saleItems').addEventListener('input', e => {
  const qtyInput = e.target.closest('.sale-qty');
  if (!qtyInput) return;
  const it = saleItems[Number(qtyInput.dataset.i)];
  let v = parseInt(qtyInput.value, 10);
  if (isNaN(v) || v < 1) v = 1;
  if (v > it.stock) {
    v = it.stock;
    qtyInput.value = v;
    toast(`Only ${it.stock} in stock`);
  }
  it.quantity = v;
  $('#saleTotal').textContent = eur(saleTotal());
});

// sale search: live list + exact match on Enter (barcode scanner)
const saleSearchInput = $('#saleSearch');
let saleSearchTimer;

async function saleSearchList() {
  const q = saleSearchInput.value.trim();
  const box = $('#saleResults');
  if (!q) { box.classList.add('d-none'); box.innerHTML = ''; return; }
  const result = await fetch('/api/products?page=1&limit=100&includeArchived=0&q=' + encodeURIComponent(q)).then(r => r.json());
  const products = result.items || [];
  box.innerHTML = products.slice(0, 10).map((p, i) => `
    <div class="ac-item d-flex justify-content-between align-items-center" data-i="${i}">
      <span>
        <div>${esc(p.name)}</div>
        <div class="small text-muted">${esc(p.sku)}${p.model ? ' · ' + esc(p.model) : ''}</div>
      </span>
      <span class="text-end">
        <div class="fw-bold">${eur(p.price)}</div>
        <div class="small text-muted">${p.quantity} in stock</div>
      </span>
    </div>`).join('') || '<div class="ac-hint">No products found</div>';
  box.products = products;
  box.classList.remove('d-none');
}

saleSearchInput.addEventListener('input', () => {
  clearTimeout(saleSearchTimer);
  saleSearchTimer = setTimeout(saleSearchList, 200);
});

saleSearchInput.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = saleSearchInput.value.trim();
  if (!q) return;
  const result = await fetch('/api/products?page=1&limit=100&includeArchived=0&q=' + encodeURIComponent(q)).then(r => r.json());
  const products = result.items || [];
  const exact = products.find(p => p.sku === q || p.ean === q || p.model === q ||
    p.name.toLowerCase() === q.toLowerCase());
  if (exact) {
    addSaleItem(exact);
    saleSearchInput.value = '';
    $('#saleResults').classList.add('d-none');
  }
  // no exact match: leave the list visible for picking
});

$('#saleResults').addEventListener('mousedown', e => {
  const item = e.target.closest('.ac-item');
  if (!item || !$('#saleResults').products) return;
  e.preventDefault();
  addSaleItem($('#saleResults').products[Number(item.dataset.i)]);
  saleSearchInput.value = '';
  $('#saleResults').classList.add('d-none');
  saleSearchInput.focus();
});

function setSaleReadOnly(ro) {
  saleReadOnly = ro;
  $('#saleSearch').disabled = ro;
  $('#saleCustomer').disabled = ro;
  $('#saleSearchWrap').style.display = ro ? 'none' : '';
  $('#saleSaveDraftBtn').hidden = ro;
  $('#saleCompleteBtn').hidden = ro;
}

async function openSale(orderId = null, readOnly = false) {
  saleOrderId = orderId;
  allowSaleModalHide = false;
  setSaleReadOnly(readOnly);
  $('#saleError').hidden = true;
  saleSearchInput.value = '';
  $('#saleResults').classList.add('d-none');
  if (orderId) {
    $('#saleModalTitle').textContent = `Sale order #${orderId}` + (readOnly ? '' : ' (draft)');
    const o = await fetch('/api/sale-orders/' + orderId).then(r => r.json());
    $('#saleCustomer').value = o.customer || '';
    saleItems = o.items.map(it => ({
      product_id: it.product_id, name: it.name, model: it.model, sku: it.sku,
      price: it.price, quantity: it.quantity, stock: it.stock
    }));
  } else {
    $('#saleModalTitle').textContent = 'New sale';
    $('#saleCustomer').value = 'Walk-in';
    saleItems = [];
  }
  saleSnapshot = {
    customer: $('#saleCustomer').value.trim(),
    itemCount: saleItems.length
  };
  renderSaleItems();
  saleModal.show();
  if (!readOnly) setTimeout(() => saleSearchInput.focus(), 300);
}

$('#newSaleBtn').addEventListener('click', () => openSale());
$('#newSaleBtn2').addEventListener('click', () => openSale());

function salePayload() {
  return {
    customer: $('#saleCustomer').value.trim() || null,
    items: saleItems.map(it => ({ product_id: it.product_id, quantity: it.quantity }))
  };
}

async function saveSaleOrder() {
  const body = salePayload();
  if (saleOrderId) {
    const res = await fetch('/api/sale-orders/' + saleOrderId, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
    return saleOrderId;
  }
  const res = await fetch('/api/sale-orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
  saleOrderId = (await res.json()).id;
  return saleOrderId;
}

function saleError(msg) {
  const el = $('#saleError');
  el.textContent = msg;
  el.hidden = false;
}

$('#saleSaveDraftBtn').addEventListener('click', async () => {
  try {
    await saveSaleOrder();
    toast(`Draft order #${saleOrderId} saved`);
    allowSaleModalHide = true;
    saleModal.hide();
    loadOrders();
  } catch (e) { saleError(e.message); }
});

$('#saleCompleteBtn').addEventListener('click', async () => {
  try {
    const id = await saveSaleOrder();
    const res = await fetch(`/api/sale-orders/${id}/complete`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Complete failed');
    }
    toast(`Sale order #${id} completed — ${eur(saleTotal())}`);
    allowSaleModalHide = true;
    saleModal.hide();
    loadProducts();
    loadOrders();
  } catch (e) { saleError(e.message); }
});

// ---------- purchases ----------
let purchases = [];

async function loadPurchases() {
  purchases = await fetch('/api/purchases').then(r => r.json());
  renderPurchases();
}

function renderPurchases() {
  $('#purchaseRows').innerHTML = purchases.map(po => `<tr data-id="${po.id}">
    <td>${po.id}</td>
    <td>${esc(po.supplier)}</td>
    <td>${po.item_count}</td>
    <td class="fw-bold">${eur(po.total)}</td>
    <td>${po.shipping == null ? '—' : eur(po.shipping)}</td>
    <td>${eur(po.total + (po.shipping || 0))}</td>
    <td>${esc(po.created_at)}</td>
    <td>
      <button class="btn btn-sm btn-outline-secondary po-info" title="Show products">
        <i class="bi bi-eye"></i>
      </button>
    </td>
  </tr>`).join('');
}

$('#purchaseRows').addEventListener('click', e => {
  const info = e.target.closest('.po-info');
  if (!info) return;
  openPurchaseInfo(Number(info.closest('tr').dataset.id));
});

const purchaseInfoModal = new bootstrap.Modal('#purchaseInfoModal');

async function openPurchaseInfo(id) {
  const po = await fetch('/api/purchases/' + id).then(r => r.json());
  $('#purchaseInfoTitle').textContent = `Purchase order #${po.id}`;
  $('#purchaseInfoMeta').innerHTML = `
    <span class="badge text-bg-secondary">${esc(po.supplier)}</span>
    <span class="badge text-bg-light text-muted">${esc(po.created_at)}</span>`;
  $('#purchaseInfoRows').innerHTML = po.items.map(it => `<tr>
    <td>${it.is_new ? '<span class="badge text-bg-success me-1">new</span>' : ''}${esc(it.name)}</td>
    <td>
      <div class="d-flex flex-column gap-1 align-items-start">
        <span class="badge text-bg-dark">${esc(it.sku)}</span>
        <span class="badge text-bg-secondary">${esc(it.ean)}</span>
      </div>
    </td>
    <td>${esc(it.quantity)}</td>
    <td class="text-nowrap">${eur(it.cost)}</td>
    <td class="text-nowrap">${eur(it.cost * it.quantity)}</td>
  </tr>`).join('');
  $('#purchaseInfoProducts').textContent = eur(po.total);
  $('#purchaseInfoShipping').textContent = po.shipping == null ? '—' : eur(po.shipping);
  $('#purchaseInfoTotal').textContent = eur(po.total + (po.shipping || 0));
  purchaseInfoModal.show();
}

// ---------- purchase import ----------
const importModal = new bootstrap.Modal('#importModal');
const importModalElement = $('#importModal');
const importSupplierAc = createAutocomplete($('#importSupplierAc'), 'suppliers');
let importExisting = []; // rows matching existing products (updates)
let importNew = [];      // rows for new products
let allowImportModalHide = false;

function hasImportOrderData() {
  return Boolean(
    importSupplierAc.value ||
    $('#importShipping').value.trim() ||
    xlsxInput.files.length
  );
}

importModalElement.addEventListener('hide.bs.modal', event => {
  if (allowImportModalHide || !hasImportOrderData()) return;
  event.preventDefault();
  showUnsavedChangesPrompt($('#importError'));
});
importModalElement.addEventListener('click', event => {
  if (!event.target.closest('[data-bs-dismiss="modal"], .btn-close')) return;
  event.preventDefault();
  event.stopPropagation();
  allowImportModalHide = true;
  importModal.hide();
}, true);
importModalElement.addEventListener('hidden.bs.modal', () => {
  allowImportModalHide = false;
});

function importError(msg) {
  const el = $('#importError');
  el.textContent = msg;
  el.hidden = false;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function ensureDatalists() {
  if (document.getElementById('dl-categories')) return;
  for (const type of ['categories', 'locations', 'brands']) {
    const rows = await fetch(`/api/entities/${type}`).then(r => r.json());
    const dl = document.createElement('datalist');
    dl.id = `dl-${type}`;
    dl.innerHTML = rows.map(r => `<option value="${esc(r.name)}"></option>`).join('');
    document.body.appendChild(dl);
  }
}

$('#importOrderBtn').addEventListener('click', async () => {
  // reset state
  importExisting = [];
  importNew = [];
  allowImportModalHide = false;
  importSupplierAc.set([]);
  $('#importShipping').value = '';
  $('#importerSelect').value = 'KOFF';
  $('#importError').hidden = true;
  $('#importExistingWrap').hidden = true;
  $('#importNewWrap').hidden = true;
  $('#importProgress').hidden = true;
  $('#completeImportBtn').disabled = true;
  $('#xlsxDrop').classList.remove('loaded');
  $('#xlsxDrop').querySelector('div').innerHTML = 'Click or drop the supplier\'s <strong>.xlsx</strong> purchase order here';
  xlsxInput.value = '';
  await ensureDatalists();
  importModal.show();
});

const xlsxInput = $('#xlsxInput');
$('#xlsxDrop').addEventListener('click', () => xlsxInput.click());
$('#xlsxDrop').addEventListener('dragover', e => { e.preventDefault(); $('#xlsxDrop').classList.add('dragover'); });
$('#xlsxDrop').addEventListener('dragleave', () => $('#xlsxDrop').classList.remove('dragover'));
$('#xlsxDrop').addEventListener('drop', e => {
  e.preventDefault();
  $('#xlsxDrop').classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleXlsx(file);
});
xlsxInput.addEventListener('change', () => {
  if (xlsxInput.files[0]) handleXlsx(xlsxInput.files[0]);
});

async function handleXlsx(file) {
  if (!/\.xlsx$/i.test(file.name)) return importError('Please provide an .xlsx file');
  $('#importError').hidden = true;
  $('#importExistingWrap').hidden = true;
  $('#importNewWrap').hidden = true;
  $('#importProgressText').textContent = `Parsing ${file.name}…`;
  $('#importProgress').hidden = false;
  $('#xlsxDrop').classList.add('loaded');
  $('#xlsxDrop').querySelector('div').innerHTML = `<strong>${esc(file.name)}</strong>`;
  const importer = $('#importerSelect').value.toLowerCase();
  try {
    const data = await fetch(`/api/purchases/parse-${importer}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: await fileToBase64(file) })
    }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Parse failed');
      return r.json();
    });
    const nextModel = parseInt((await fetch('/api/products/next-model').then(r => r.json())).model, 10);
    importExisting = [];
    importNew = [];
    let mi = 0;
    let fileOrder = 0;
    for (const row of data.rows) {
      fileOrder++;
      if (row.existing) {
        importExisting.push({
          include: true,
          sort: fileOrder,
          product_id: row.existing.id,
          name: row.existing.name,
          db: row.existing,
          file: { supplier_name: row.supplier_name, ean: row.ean, quantity: row.quantity, cost: row.cost }
        });
      } else {
        importNew.push({
          include: true,
          updated: 0,
          sort: fileOrder,
          model: String(nextModel + mi++),
          name: row.parsed.name || '',
          sku: row.sku,
          ean: row.ean,
          color: row.parsed.color || '',
          quantity: row.quantity,
          price: row.parsed.brand_price != null ? row.parsed.brand_price : '',
          cost: row.cost,
          category: '',
          location: '',
          brand: row.parsed.brand || '',
          supplier_name: row.supplier_name,
          devices: row.parsed.devices || [],
          features: []
        });
      }
    }
    renderImportTables();
  } catch (e) {
    importError(e.message);
  } finally {
    $('#importProgress').hidden = true;
  }
}

function diffCell(oldVal, newVal, showChanged = true) {
  const changed = String(oldVal ?? '') !== String(newVal ?? '');
  if (!changed) return esc(newVal ?? '');
  return `<s class="text-muted">${esc(oldVal ?? '')}</s> <i class="bi bi-arrow-right"></i> ${esc(newVal ?? '')}${showChanged ? ' <span class="badge text-bg-warning">changed</span>' : ''}`;
}

function renderImportTables() {
  $('#importExistingWrap').hidden = importExisting.length === 0;
  $('#importExistingRows').innerHTML = importExisting.map((r, i) => `<tr>
    <td><input class="form-check-input imp-ex-check" type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''}></td>
    <td>${esc(r.name)}<div class="small text-muted">${esc(r.db.sku)}</div></td>
    <td class="small">${diffCell(r.db.supplier_name, r.file.supplier_name)}</td>
    <td class="small">${diffCell(r.db.ean, r.file.ean)}</td>
    <td class="small">${diffCell(r.db.cost, r.file.cost)}</td>
    <td class="text-nowrap"><s class="text-muted">${r.db.quantity}</s> <i class="bi bi-arrow-right"></i> <strong>${r.db.quantity + r.file.quantity}</strong> <span class="badge text-bg-secondary">+${r.file.quantity}</span></td>
  </tr>`).join('');

  $('#importNewWrap').hidden = importNew.length === 0;
  $('#importNewRows').innerHTML = importNew.map((r, i) => `<tr class="${r.updated ? 'import-updated' : ''}">
    <td><input class="form-check-input imp-new-check" type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''}></td>
    <td>${esc(r.model)}</td>
    <td>
      <div>${esc(r.name)}</div>
      <div class="d-flex flex-wrap gap-1 mt-1">
        ${r.devices.map(d => `<span class="badge text-bg-primary">${esc(d.name)}</span>`).join('')}
        ${r.features.map(f => `<span class="badge text-bg-success">${esc(f.name)}</span>`).join('')}
      </div>
    </td>
    <td>
      <div class="d-flex flex-column gap-1 align-items-start">
        <span class="badge text-bg-dark">${esc(r.sku)}</span>
        <span class="badge text-bg-secondary">${esc(r.ean)}</span>
      </div>
    </td>
    <td>${esc(r.category) || '<span class="text-muted">—</span>'}</td>
    <td>${esc(r.brand) || '<span class="text-muted">—</span>'}</td>
    <td>${esc(r.color)}</td>
    <td>${r.quantity}</td>
    <td class="text-nowrap">${r.price === '' ? '<span class="badge text-bg-danger">missing</span>' : eur(r.price)}</td>
    <td class="text-nowrap">${eur(r.cost)}</td>
    <td>
      <button class="btn btn-sm btn-outline-secondary imp-edit" data-i="${i}" title="Edit product">
        <i class="bi bi-pencil"></i>
      </button>
    </td>
  </tr>`).join('');

  $('#completeImportBtn').disabled = false;
}

$('#importExistingRows').addEventListener('change', e => {
  const c = e.target.closest('.imp-ex-check');
  if (c) importExisting[Number(c.dataset.i)].include = c.checked;
});
$('#importNewRows').addEventListener('change', e => {
  const c = e.target.closest('.imp-new-check');
  if (c) importNew[Number(c.dataset.i)].include = c.checked;
});

// ---------- import product edit modal ----------
const importProductModal = new bootstrap.Modal('#importProductModal');
const importProductModalElement = $('#importProductModal');
importProductModalElement.addEventListener('click', event => {
  if (!event.target.closest('[data-bs-dismiss="modal"], .btn-close')) return;
  event.preventDefault();
  event.stopPropagation();
  allowImportProductHide = true;
  $('#ipfWarning').hidden = true;
  importProductModal.hide();
}, true);

function raiseImportProductModal() {
  importProductModalElement.style.zIndex = '1070';
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.style.zIndex = '1060';
  });
}

importProductModalElement.addEventListener('show.bs.modal', () => {
  raiseImportProductModal();
  setTimeout(raiseImportProductModal, 0);
});
importProductModalElement.addEventListener('hidden.bs.modal', () => {
  importProductModalElement.style.zIndex = '';
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.style.zIndex = '';
  });
});

const importProductForm = $('#importProductForm');
let importEditIndex = null;
const ipfCategories = createAutocomplete($('#ipfCategory'), 'categories');
const ipfLocations = createAutocomplete($('#ipfLocation'), 'locations');
const ipfBrands = createAutocomplete($('#ipfBrand'), 'brands');
const ipfDevices = createAutocomplete($('#ipfDevices'), 'devices');
const ipfFeatures = createAutocomplete($('#ipfFeatures'), 'features');
let importFormSnapshot = '';
let allowImportProductHide = false;

function serializeImportProductForm() {
  const f = importProductForm;
  return JSON.stringify({
    fields: ['model', 'name', 'sku', 'ean', 'color', 'quantity', 'price', 'cost', 'supplier_name']
      .map(name => f[name].value),
    categories: ipfCategories.getSelected().map(item => item.id ?? item.name),
    locations: ipfLocations.getSelected().map(item => item.id ?? item.name),
    brands: ipfBrands.getSelected().map(item => item.id ?? item.name),
    devices: ipfDevices.getSelected().map(item => item.id ?? item.name).sort(),
    features: ipfFeatures.getSelected().map(item => item.id ?? item.name).sort()
  });
}

importProductModalElement.addEventListener('hide.bs.modal', event => {
  if (allowImportProductHide || serializeImportProductForm() === importFormSnapshot) return;
  event.preventDefault();
  const warning = $('#ipfWarning');
  warning.textContent = 'You have unsaved changes. Save the product or undo your changes before closing.';
  warning.hidden = false;
  warning.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
importProductModalElement.addEventListener('hidden.bs.modal', () => {
  allowImportProductHide = false;
  importFormSnapshot = '';
});

async function setImportAutocomplete(widget, name, type) {
  widget.set([]);
  if (!name) return;
  const rows = await fetch(`/api/entities/${type}?q=` + encodeURIComponent(name)).then(r => r.json());
  const exact = rows.find(r => r.name.toLowerCase() === name.toLowerCase());
  if (exact) widget.set([exact]);
  else widget.set([{ id: null, name }]);
}

$('#importNewRows').addEventListener('click', async e => {
  const editBtn = e.target.closest('.imp-edit');
  if (!editBtn) return;
  const i = Number(editBtn.dataset.i);
  const r = importNew[i];
  importEditIndex = i;
  importProductForm.reset();
  $('#importProductTitle').textContent = `Edit import product #${i + 1}`;
  importProductForm.model.value = r.model;
  importProductForm.name.value = r.name;
  importProductForm.sku.value = r.sku;
  importProductForm.ean.value = r.ean;
  importProductForm.color.value = r.color;
  importProductForm.quantity.value = r.quantity;
  importProductForm.price.value = r.price;
  importProductForm.cost.value = r.cost;
  importProductForm.supplier_name.value = r.supplier_name;
  await setImportAutocomplete(ipfCategories, r.category, 'categories');
  await setImportAutocomplete(ipfLocations, r.location, 'locations');
  await setImportAutocomplete(ipfBrands, r.brand, 'brands');
  ipfDevices.set(r.devices);
  ipfFeatures.set(r.features || []);
  $('#ipfWarning').hidden = true;
  importFormSnapshot = serializeImportProductForm();
  importProductModal.show();
});

$('#saveImportProductBtn').addEventListener('click', () => {
  const f = importProductForm;
  const warn = $('#ipfWarning');
  const required = [['name', 'Name'], ['sku', 'SKU'], ['color', 'Color'],
    ['quantity', 'Quantity'], ['price', 'Price'], ['cost', 'Cost']];
  const missing = required.filter(([field]) => !String(f[field].value).trim()).map(([, label]) => label);
  if (missing.length) {
    warn.textContent = 'Please fill in required fields before saving: ' + missing.join(', ');
    warn.hidden = false;
    return;
  }
  warn.hidden = true;
  const r = importNew[importEditIndex];
  r.model = f.model.value;
  r.name = f.name.value;
  r.sku = f.sku.value;
  r.ean = f.ean.value;
  r.color = f.color.value;
  r.quantity = Number(f.quantity.value);
  r.price = f.price.value === '' ? '' : Number(f.price.value);
  r.cost = f.cost.value === '' ? 0 : Number(f.cost.value);
  r.supplier_name = f.supplier_name.value;
  r.category = ipfCategories.getSelected()[0]?.name || '';
  r.location = ipfLocations.getSelected()[0]?.name || '';
  r.brand = ipfBrands.getSelected()[0]?.name || '';
  r.devices = ipfDevices.getSelected();
  r.features = ipfFeatures.getSelected();
  r.updated = 1;
  importFormSnapshot = serializeImportProductForm();
  allowImportProductHide = true;
  importProductModal.hide();
  renderImportTables();
});

// Brands created by this import get a suggested sale price taken from their
// products; when one new brand has several different prices, ask the user.
const brandPriceModal = new bootstrap.Modal('#brandPriceModal');

async function resolveBrandPrices(newProducts) {
  const byBrand = {};
  for (const np of newProducts) {
    if (!np.brand) continue;
    (byBrand[np.brand] = byBrand[np.brand] || []).push(np);
  }
  const brandPrices = {};
  const conflicts = [];
  for (const [brand, prods] of Object.entries(byBrand)) {
    const rows = await fetch('/api/entities/brands?q=' + encodeURIComponent(brand)).then(r => r.json());
    if (rows.some(b => b.name.toLowerCase() === brand.toLowerCase())) continue; // existing brand keeps its price
    const prices = [...new Set(prods.map(p => Number(p.price)))];
    if (prices.length === 1) {
      brandPrices[brand] = prices[0];
    } else {
      conflicts.push({ brand, prods });
    }
  }
  if (conflicts.length) {
    const chosen = await new Promise(resolve => {
      $('#brandPriceBody').innerHTML = conflicts.map((c, ci) => `
        <div class="mb-3">
          <div class="fw-bold">${esc(c.brand)}</div>
          ${c.prods.map((p, pi) => `
            <div class="form-check">
              <input class="form-check-input bp-radio" type="radio" name="bp-${ci}" id="bp-${ci}-${pi}"
                     value="${p.price}" data-brand="${esc(c.brand)}" ${pi === 0 ? 'checked' : ''}>
              <label class="form-check-label" for="bp-${ci}-${pi}">
                ${eur(p.price)} — ${esc(p.name)} <span class="text-muted small">${esc(p.sku)}</span>
              </label>
            </div>`).join('')}
        </div>`).join('');
      const onContinue = () => {
        brandPriceModal.hide();
        $('#brandPriceContinue').removeEventListener('click', onContinue);
        const picks = {};
        document.querySelectorAll('.bp-radio:checked').forEach(r => picks[r.dataset.brand] = Number(r.value));
        resolve(picks);
      };
      $('#brandPriceContinue').addEventListener('click', onContinue);
      brandPriceModal.show();
    });
    Object.assign(brandPrices, chosen);
  }
  return brandPrices;
}

$('#completeImportBtn').addEventListener('click', async () => {
  $('#importError').hidden = true;
  const supplier_id = importSupplierAc.value;
  if (!supplier_id) return importError('Select a supplier');
  const updates = importExisting.filter(r => r.include).map(r => ({
    product_id: r.product_id,
    add_quantity: r.file.quantity,
    purchase_price: r.file.cost,
    ean: r.file.ean,
    cost: r.file.cost,
    supplier_name: r.file.supplier_name,
    sort: r.sort
  }));
  const new_products = importNew.filter(r => r.include).map(r => ({
    model: r.model || null,
    name: r.name, ean: r.ean, sku: r.sku, color: r.color,
    quantity: Number(r.quantity), price: Number(r.price), cost: Number(r.cost),
    supplier_name: r.supplier_name || null,
    brand: r.brand || null, category: r.category || null, location: r.location || null,
    device_ids: r.devices.map(d => d.id),
    feature_ids: r.features.map(f => f.id),
    sort: r.sort
  }));
  if (updates.length === 0 && new_products.length === 0) return importError('Nothing selected to import');
  for (const np of new_products) {
      if (!np.name || !np.sku || !np.color ||
          Number.isNaN(np.quantity) || np.quantity < 1 ||
          Number.isNaN(np.price) || np.price < 0 ||
          Number.isNaN(np.cost) || np.cost < 0) {
      return importError(`New product "${np.name || np.sku || '?'}" is missing required fields (name, SKU, color, quantity, price, cost)`);
    }
  }
  try {
    const brand_prices = await resolveBrandPrices(new_products);
    const res = await fetch('/api/purchases/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier_id, shipping: $('#importShipping').value === '' ? null : Number($('#importShipping').value), updates, new_products, brand_prices })
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Import failed');
    const out = await res.json();
    toast(`Purchase order #${out.id} imported — ${out.created} new, ${out.updated} updated (${eur(out.total)})`);
    allowImportModalHide = true;
    importModal.hide();
    loadProducts();
    loadPurchases();
  } catch (e) { importError(e.message); }
});
