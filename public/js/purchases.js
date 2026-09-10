import { $, esc, eur, toast, diffCell, validateRequiredFields, showUnsavedChangesPrompt } from './ui.js';
import { createAutocomplete } from './autocomplete.js';
import { loadProducts } from './products.js';

// ---------- purchases ----------
let purchases = [];

export async function loadPurchases() {
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
// keep the input's programmatic click from bubbling back to the drop zone (re-click loop cancels the chooser)
xlsxInput.addEventListener('click', e => e.stopPropagation());
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
    if (importer === 'tfo' && data.shipping != null) $('#importShipping').value = data.shipping;
    importExisting = [];
    importNew = [];
    let mi = 0;
    let fileOrder = 0;
    for (const row of data.rows) {
      fileOrder++;
      const sort = row.entry_number == null ? fileOrder : row.entry_number;
      if (row.existing) {
        importExisting.push({
          include: true,
          sort,
          product_id: row.existing.id,
          name: row.existing.name,
          db: row.existing,
          changes: { supplier_name: true, ean: true, cost: true },
          file: { supplier_name: row.supplier_name, ean: row.ean, quantity: row.quantity, cost: row.cost }
        });
      } else {
        importNew.push({
          include: true,
          updated: 0,
          sort,
          model: String(nextModel + mi++),
          name: row.parsed.name || '',
          sku: row.sku,
          ean: row.ean,
          color: row.parsed.color || '',
          color_id: row.parsed.color_id || null,
          tag_color: row.parsed.tag_color,
          tag_text: row.parsed.tag_text,
          tag_border: row.parsed.tag_border,
          quantity: row.quantity,
          price: row.parsed.brand_price != null ? row.parsed.brand_price : '',
          cost: row.cost,
          category: row.parsed.category || '',
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


function renderImportTables() {
  $('#importExistingWrap').hidden = importExisting.length === 0;
  $('#importExistingRows').innerHTML = importExisting.map((r, i) => `<tr>
    <td><input class="form-check-input imp-ex-check" type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''}></td>
    <td>${esc(r.name)}<div class="small text-muted">${esc(r.db.sku)}</div></td>
    <td class="small">${diffCell(r.db.supplier_name, r.file.supplier_name, 'supplier_name', i, r.changes)}</td>
    <td class="small">${diffCell(r.db.ean, r.file.ean, 'ean', i, r.changes)}</td>
    <td class="small">${diffCell(r.db.cost, r.file.cost, 'cost', i, r.changes)}</td>
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
    <td>${r.color ? `<span class="badge" style="background:${esc(r.tag_color || '#6c757d')};color:${esc(r.tag_text || '#fff')};border:1px solid ${esc(r.tag_border || '#6c757d')}">${esc(r.color)}</span>` : '<span class="text-muted">—</span>'}</td>
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
$('#importExistingRows').addEventListener('click', e => {
  const toggle = e.target.closest('.imp-change-toggle');
  if (!toggle) return;
  const row = importExisting[Number(toggle.dataset.i)];
  const field = toggle.dataset.field;
  row.changes[field] = !row.changes[field];
  renderImportTables();
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
const ipfColors = createAutocomplete($('#ipfColor'), 'colors');
const ipfDevices = createAutocomplete($('#ipfDevices'), 'devices');
const ipfFeatures = createAutocomplete($('#ipfFeatures'), 'features');
let importFormSnapshot = '';
let allowImportProductHide = false;

function serializeImportProductForm() {
  const f = importProductForm;
  return JSON.stringify({
    fields: ['model', 'name', 'sku', 'ean', 'quantity', 'price', 'cost', 'supplier_name']
      .map(name => f[name].value),
    categories: ipfCategories.getSelected().map(item => item.id ?? item.name),
    locations: ipfLocations.getSelected().map(item => item.id ?? item.name),
    brands: ipfBrands.getSelected().map(item => item.id ?? item.name),
    colors: ipfColors.getSelected().map(item => item.id ?? item.name),
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
  importProductForm.querySelectorAll('.is-invalid').forEach(input => input.classList.remove('is-invalid'));
  $('#importProductTitle').textContent = `Edit import product #${i + 1}`;
  importProductForm.model.value = r.model;
  importProductForm.name.value = r.name;
  importProductForm.sku.value = r.sku;
  importProductForm.ean.value = r.ean;
  importProductForm.quantity.value = r.quantity;
  importProductForm.price.value = r.price;
  importProductForm.cost.value = r.cost;
  importProductForm.supplier_name.value = r.supplier_name;
  await setImportAutocomplete(ipfCategories, r.category, 'categories');
  await setImportAutocomplete(ipfLocations, r.location, 'locations');
  await setImportAutocomplete(ipfBrands, r.brand, 'brands');
  await setImportAutocomplete(ipfColors, r.color, 'colors');
  ipfDevices.set(r.devices);
  ipfFeatures.set(r.features || []);
  $('#ipfWarning').hidden = true;
  importFormSnapshot = serializeImportProductForm();
  importProductModal.show();
});

$('#saveImportProductBtn').addEventListener('click', () => {
  const f = importProductForm;
  const warn = $('#ipfWarning');
  if (!validateRequiredFields(f, [['name', 'Name'], ['sku', 'SKU'], ['quantity', 'Quantity'], ['price', 'Price'], ['cost', 'Cost']], warn)) return;
  warn.hidden = true;
  const r = importNew[importEditIndex];
  r.model = f.model.value;
  r.name = f.name.value;
  r.sku = f.sku.value;
  r.ean = f.ean.value;
  r.color = ipfColors.getSelected()[0]?.name || '';
  r.color_id = ipfColors.value;
  r.tag_color = ipfColors.getSelected()[0]?.tag_color;
  r.tag_text = ipfColors.getSelected()[0]?.tag_text;
  r.tag_border = ipfColors.getSelected()[0]?.tag_border;
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
  const updates = importExisting.filter(r => r.include).map(r => {
    const update = {
      product_id: r.product_id,
      add_quantity: r.file.quantity,
      purchase_price: r.file.cost,
      update_fields: r.changes,
      sort: r.sort
    };
    if (r.changes.ean) update.ean = r.file.ean;
    if (r.changes.cost) update.cost = r.file.cost;
    if (r.changes.supplier_name) update.supplier_name = r.file.supplier_name;
    return update;
  });
  const new_products = importNew.filter(r => r.include).map(r => ({
    model: r.model || null,
    name: r.name, ean: r.ean, sku: r.sku, color: r.color, color_id: r.color_id,
    quantity: Number(r.quantity), price: Number(r.price), cost: Number(r.cost),
    supplier_name: r.supplier_name || null,
    brand: r.brand || null, category: r.category || null, location: r.location || null,
    device_ids: r.devices.map(d => d.id),
    feature_ids: r.features.map(f => f.id),
    sort: r.sort
  }));
  if (updates.length === 0 && new_products.length === 0) return importError('Nothing selected to import');
  for (const np of new_products) {
      if (!np.name || !np.sku ||
          Number.isNaN(np.quantity) || np.quantity < 1 ||
          Number.isNaN(np.price) || np.price < 0 ||
          Number.isNaN(np.cost) || np.cost < 0) {
      return importError(`New product "${np.name || np.sku || '?'}" is missing required fields (name, SKU, quantity, price, cost)`);
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