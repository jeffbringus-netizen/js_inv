import { $, showUnsavedChangesPrompt, validateRequiredFields } from './ui.mjs';
import { S } from './store.mjs';
import { acWidgets } from './autocomplete.mjs';
import { loadProducts } from './products.mjs';

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
    f: ['model', 'name', 'ean', 'sku', 'quantity', 'price', 'cost', 'supplier_name'].map(n => form[n].value),
    online: form.is_online.checked,
    archived: form.is_archived.checked,
    ac: ['brands', 'categories', 'suppliers', 'locations', 'colors'].map(k => acWidgets[k].getSelected().map(x => x.id)),
    devices: acWidgets.devices.getSelected().map(x => x.id).sort((a, b) => a - b),
    features: acWidgets.features.getSelected().map(x => x.id).sort((a, b) => a - b)
  });
}


$('#productModal').addEventListener('hide.bs.modal', e => {
  if (allowModalHide) return;
  if (serializeProductForm() === formSnapshot) return; // nothing changed — close normally
  e.preventDefault();
  showUnsavedChangesPrompt($('#productModal .modal-error'));
});
$('#productModal').addEventListener('hidden.bs.modal', () => { allowModalHide = false; });

export async function openModal(id) {
  S.editingId = id ?? null;
  delete form.price.dataset.touched;
  delete form.cost.dataset.touched;
  form.reset();
  form.querySelectorAll('.is-invalid').forEach(input => input.classList.remove('is-invalid'));
  syncModalStatusToggles();
  form.model.placeholder = '';
  document.querySelectorAll('.selected-badges').forEach(b => b.innerHTML = '');
  $('.modal-error').hidden = true;
  $('.modal-error').textContent = '';

  if (id) {
    $('#modalTitle').textContent = 'Edit product';
    const p = S.allProducts.find(x => x.id === id);
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
    acWidgets.colors.set(p.color_id ? [{ id: p.color_id, name: p.color_name, tag_color: p.tag_color, tag_text: p.tag_text, tag_border: p.tag_border }] : []);
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
form.addEventListener('input', e => {
  if (e.target.classList.contains('is-invalid') && String(e.target.value).trim()) {
    e.target.classList.remove('is-invalid');
  }
});

$('#saveProductBtn').addEventListener('click', async () => {
  if (!validateRequiredFields(form, [['name', 'Name'], ['sku', 'SKU'], ['quantity', 'Quantity'], ['price', 'Price'], ['cost', 'Cost']], $('.modal-error'))) return;
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

  const url = S.editingId ? '/api/products/' + S.editingId : '/api/products';
  const res = await fetch(url, {
    method: S.editingId ? 'PUT' : 'POST',
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
