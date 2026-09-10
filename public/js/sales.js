import { $, esc, eur, toast, STATUS_BADGE } from './ui.js';
import { loadProducts } from './products.js';

// ---------- orders ----------
let orders = [];

export async function loadOrders() {
  orders = await fetch('/api/sale-orders').then(r => r.json());
  renderOrders();
}


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