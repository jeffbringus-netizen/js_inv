import { $, esc, eur, toast, diffCell } from './ui.js';
import { S, selectedProductIds } from './store.js';
import { createAutocomplete } from './autocomplete.js';
import { loadProducts, updateMassEditBtn } from './products.js';

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

export function openMassEdit() {
  massProducts = S.allProducts.filter(p => selectedProductIds.has(p.id));
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
  massProducts = S.allProducts.filter(p => selectedProductIds.has(p.id));
  $('#massBackBtn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

$('#massSaveBtn').addEventListener('click', () => saveMassEdit(false));
$('#massSaveCloseBtn').addEventListener('click', () => saveMassEdit(true));