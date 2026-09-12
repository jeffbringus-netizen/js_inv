import { esc, eur, eur4, listDiffCell, STATUS_BADGE } from './ui.js';
export function fmtHistField(k, v) {
  if (k === 'is_online') return (v === 1 || v === '1') ? 'online' : 'offline';
  if ((k === 'price' || k === 'cost') && v !== null && v !== undefined && v !== '') return eur(v);
  return v;
}


// ---------- history ----------
export const HIST_TYPE_BADGE = {
  products: 'text-bg-primary', sales: 'text-bg-success', purchases: 'text-bg-info',
  devices: 'text-bg-info', features: 'text-bg-success', brands: 'text-bg-warning',
  categories: 'text-bg-secondary', locations: 'text-bg-dark', suppliers: 'text-bg-secondary', backups: 'text-bg-dark'
};
const HIST_ACTION_BADGE = {
  create: 'text-bg-success', update: 'text-bg-warning', delete: 'text-bg-danger',
  complete: 'text-bg-success', cancel: 'text-bg-danger', import: 'text-bg-info'
};
export const HIST_ENTITY_TYPES = ['devices', 'features', 'brands', 'categories', 'locations', 'suppliers', 'colors'];
export const HISTORY_FIELD_LABELS = {
  model: 'Model', short_name: 'Short name', name: 'Name', ean: 'EAN', sku: 'SKU', color: 'Color', color_name: 'Color',
  quantity: 'Quantity', price: 'Price', cost: 'Cost',
  supplier_name: "Supplier's product name", brand: 'Brand', category: 'Category',
  supplier: 'Supplier', location: 'Location', devices: 'Devices', features: 'Features',
  is_archived: 'Archived',
  customer: 'Customer', total: 'Total', status: 'Status', year: 'Year',
  full_name: 'Full name', products: 'Products', shipping: 'Shipping', is_online: 'Online',
  note: 'Note', product_count: 'Product count', model: 'Model',
  brand: 'Brand', series: 'Series',
  brands: 'Brands', categories: 'Categories', locations: 'Locations', colors: 'Colors'
};
// product history modals reuse the products-table look: code badges with
// click-to-copy, € prices with net value, switch toggles, colored color badge
const PRODUCT_MODAL_FIELDS = ['model', 'name', 'ean', 'sku', 'color_name', 'quantity', 'price', 'cost',
  'supplier_name', 'is_online', 'is_archived', 'brand', 'category', 'supplier', 'location', 'devices', 'features'];
const histEmpty = v => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function histToggle(checked, onLabel, offLabel) {
  return `<div class="form-check form-switch m-0" title="${checked ? onLabel : offLabel}">
    <input class="form-check-input" type="checkbox" role="switch" ${checked ? 'checked' : ''} disabled>
  </div>`;
}

function histColorBadge(snap, name, faded) {
  if (histEmpty(name)) return '';
  const bg = snap.tag_color || '#6c757d', fg = snap.tag_text || '#ffffff', border = snap.tag_border || '#6c757d';
  return `<span class="badge${faded ? ' opacity-50' : ''}" title="${esc(`background: ${bg} · text: ${fg} · border: ${border}`)}" style="background:${esc(bg)};color:${esc(fg)};border:1px solid ${esc(border)}">${esc(name)}</span>`;
}

function histProductFieldValue(key, v, snap) {
  switch (key) {
    case 'sku':
      return `<span class="badge text-bg-dark badge-click code-badge" title="Click to copy">${esc(v)}</span>`;
    case 'ean':
      return `<span class="badge text-bg-secondary badge-click code-badge" title="Click to copy">${esc(v)}</span>`;
    case 'color_name':
      return histColorBadge(snap, v);
    case 'price':
      return `<div class="fw-bold money">${eur(v)}</div><div class="small text-muted money">${eur4(v / 1.2)}</div>`;
    case 'cost':
      return eur(v);
    case 'devices': case 'features':
      return v.map(x => esc(x.full_name ?? x.name)).join(', ');
    case 'is_online':
      return histToggle(v == 1 || v === '1' || v === true, 'online', 'offline');
    case 'is_archived':
      return histToggle(v == 1 || v === '1' || v === true, 'archived', 'active');
    default:
      return esc(v);
  }
}

function histProductChangeValue(key, change, snap) {
  const arrow = ' <i class="bi bi-arrow-right"></i> ';
  switch (key) {
    case 'devices': case 'features':
      return listDiffCell(change.old, change.new);
    case 'sku': case 'ean': {
      const code = v => `<span class="badge ${key === 'sku' ? 'text-bg-dark' : 'text-bg-secondary'} badge-click code-badge" title="Click to copy">${esc(v)}</span>`;
      const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${code(change.old)}</s>`;
      const neu = histEmpty(change.new) ? '—' : code(change.new);
      return old + arrow + neu;
    }
    case 'color_name': {
      // the snapshot only carries the old color's tag values
      const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${histColorBadge(snap, change.old, true)}</s>`;
      const neu = histEmpty(change.new) ? '—' : `<span class="badge text-bg-secondary">${esc(change.new)}</span>`;
      return old + arrow + neu;
    }
    case 'price': {
      const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${eur(change.old)}</s>`;
      return `${old}${arrow}<strong>${eur(change.new)}</strong><div class="small text-muted">${eur4(change.new / 1.2)}</div>`;
    }
    case 'cost': {
      const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${eur(change.old)}</s>`;
      return old + arrow + `<strong>${eur(change.new)}</strong>`;
    }
    case 'is_online': case 'is_archived': {
      const t = v => `<div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" role="switch" ${(v == 1 || v === '1' || v === true) ? 'checked' : ''} disabled></div>`;
      return `<div class="d-flex align-items-center gap-2"><span class="opacity-50">${t(change.old)}</span>${arrow}${t(change.new)}</div>`;
    }
    default: {
      const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${esc(change.old)}</s>`;
      const neu = histEmpty(change.new) ? '—' : `<strong>${esc(change.new)}</strong>`;
      return old + arrow + neu;
    }
  }
}

export function productHistoryBody(h, snap) {
  const rows = [];
  for (const key of PRODUCT_MODAL_FIELDS) {
    if (!(key in snap)) continue;
    const change = h.changes && h.changes[key];
    if (!change && histEmpty(snap[key])) continue;
    const value = change ? histProductChangeValue(key, change, snap) : histProductFieldValue(key, snap[key], snap);
    rows.push(`<tr><td style="width:220px;">${esc(HISTORY_FIELD_LABELS[key] || key)}</td><td>${value}</td></tr>`);
  }
  if (!rows.length) return '<div class="text-muted">No details stored.</div>';
  const heading = h.action === 'update'
    ? '<h6 class="mb-2">Data before change <span class="text-muted small">(crossed values were changed)</span></h6>'
    : `<h6 class="mb-2">Data at time of ${esc(h.action)}</h6>`;
  return heading + '<table class="table table-sm">' + rows.join('') + '</table>';
}
// sale orders: items listed like the sale table on the sales page
export function salesHistoryBody(h, snap) {
  const statusBadge = s => `<span class="badge ${STATUS_BADGE[s] || 'text-bg-secondary'}">${esc(s)}</span>`;
  let body = '';
  const custChange = h.changes && h.changes.customer;
  if (custChange) {
    body += `<div class="mb-2"><span class="text-muted">Customer:</span> <s class="text-muted">${esc(custChange.old ?? '—')}</s> <i class="bi bi-arrow-right"></i> <strong>${esc(custChange.new ?? '—')}</strong></div>`;
  } else if (snap.customer != null && snap.customer !== '') {
    body += `<div class="mb-2"><span class="text-muted">Customer:</span> <strong>${esc(snap.customer)}</strong></div>`;
  }
  if (h.changes && h.changes.status) {
    body += `<div class="mb-2">${statusBadge(h.changes.status.old)} <i class="bi bi-arrow-right"></i> ${statusBadge(h.changes.status.new)}</div>`;
  } else {
    const status = h.action === 'complete' ? 'completed' : h.action === 'cancel' ? 'canceled' : 'draft';
    body += `<div class="mb-2">${statusBadge(status)}</div>`;
  }
  // update records carry both item states: removed/changed rows struck, added rows badged
  const oldItems = Array.isArray(snap.items) ? snap.items : [];
  const newItems = Array.isArray(snap.new_items) ? snap.new_items : null;
  let displayItems;
  if (newItems) {
    const oldByPid = new Map(oldItems.map(it => [it.product_id, it]));
    const newByPid = new Map(newItems.map(it => [it.product_id, it]));
    displayItems = [];
    for (const pid of new Set([...oldByPid.keys(), ...newByPid.keys()])) {
      const before = oldByPid.get(pid), after = newByPid.get(pid);
      if (before && after && before.quantity === after.quantity) displayItems.push({ ...before, state: 'same' });
      else {
        if (before) displayItems.push({ ...before, state: 'old' });
        if (after) displayItems.push({ ...after, state: 'new' });
      }
    }
  } else {
    displayItems = oldItems.map(it => ({ ...it, state: 'same' }));
  }
  if (displayItems.length) {
    const rows = displayItems.map(it => {
      const wrap = x => it.state === 'old' ? `<s class="text-muted">${x}</s>` : x;
      const name = (it.state === 'new' ? '<span class="badge text-bg-success me-1">new</span>' : '') + wrap(esc(it.name));
      return `<tr>
        <td>${wrap(esc(it.model || ''))}</td>
        <td>${name}<div class="small text-muted">${wrap(esc(it.sku || ''))}</div></td>
        <td>${wrap(it.quantity)}</td>
        <td class="money">${wrap(eur(it.price))}</td>
        <td class="money">${wrap(eur(it.price * it.quantity))}</td>
      </tr>`;
    }).join('');
    body += '<table class="table table-sm align-middle"><thead class="table-light"><tr>' +
      '<th>Model</th><th>Product</th><th style="width:80px;">Qty</th><th>Price</th><th>Line total</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  } else {
    body += '<div class="text-muted">No items stored.</div>';
  }
  if (snap.total != null) {
    body += `<div class="text-end fw-bold money">Total: <span class="text-success">${eur(snap.total)}</span></div>`;
  }
  const extras = [];
  if (snap.stock_restored !== undefined) {
    extras.push(`<span class="text-muted">Stock restored:</span> <strong>${snap.stock_restored ? 'yes' : 'no'}</strong>`);
  }
  if (extras.length) body += `<div class="mt-2">${extras.join(' &nbsp;·&nbsp; ')}</div>`;
  return body || '<div class="text-muted">No details stored.</div>';
}
// entities (devices, brands, colors, …) share the product modal style
export function entityHistoryBody(h, snap) {
  const isColor = h.entity_type === 'colors';
  // product link changes: removed / added / resulting full product tables
  if (snap.removed || snap.added || snap.all) {
    const addedIds = new Set(histArrHas(snap.added) ? snap.added.map(p => p.id) : []);
    let out = '';
    if (histArrHas(snap.removed)) out += histProductTable('Removed products', snap.removed);
    if (histArrHas(snap.added)) out += histProductTable('Added products', snap.added);
    if (histArrHas(snap.all)) out += histProductTable('All products', snap.all, addedIds);
    return out || '<div class="text-muted">No details stored.</div>';
  }
  const row = (key, value) => `<tr><td style="width:220px;">${esc(HISTORY_FIELD_LABELS[key] || key)}</td><td>${value}</td></tr>`;
  const rows = [];
  let linkedProducts = null;
  for (const key of Object.keys(snap)) {
    if (key === 'id' || key.endsWith('_id')) continue;
    if (key === 'products') { linkedProducts = snap.products; continue; }
    if (key === 'product_count') continue; // redundant when the product table is shown
    if (isColor && (key === 'name' || key.startsWith('tag_'))) continue; // rendered as the badge row below
    const change = h.changes && h.changes[key];
    if (!change && histEmpty(snap[key])) continue;
    rows.push(row(key, histEntityValue(key, snap[key], change)));
  }
  if (isColor) {
    const changed = h.changes && ['name', 'tag_color', 'tag_text', 'tag_border'].some(k => h.changes[k]);
    const value = changed
      ? `<s class="text-muted">${histColorBadge(snap, snap.name, true)}</s> <i class="bi bi-arrow-right"></i> <span class="badge text-bg-secondary">${esc((h.changes.name && h.changes.name.new) || snap.name)}</span>`
      : histColorBadge(snap, snap.name);
    rows.unshift(row('color', value));
  }
  if (!rows.length && !histArrHas(linkedProducts)) return '<div class="text-muted">No details stored.</div>';
  const heading = h.action === 'update'
    ? '<h6 class="mb-2">Data before change <span class="text-muted small">(crossed values were changed)</span></h6>'
    : `<h6 class="mb-2">Data at time of ${esc(h.action)}</h6>`;
  let out = heading + (rows.length ? '<table class="table table-sm">' + rows.join('') + '</table>' : '');
  if (histArrHas(linkedProducts)) {
    out += histProductTable('Linked products', linkedProducts);
  }
  return out;
}

const histArrHas = a => Array.isArray(a) && a.length > 0;

// product table used by entity history modals; products in newIds get the green
// "new" badge (e.g. products just added to a device)
function histProductTable(title, products, newIds = null) {
  const rows = products.map(p => `
    <tr>
      <td>${esc(p.model || '')}</td>
      <td>${newIds && newIds.has(p.id) ? '<span class="badge text-bg-success me-1">new</span>' : ''}${esc(p.name)}</td>
      <td>
        <div class="d-flex flex-column gap-1 align-items-start">
          <span class="badge text-bg-dark badge-click code-badge" title="Click to copy">${esc(p.sku)}</span>
          ${p.ean ? `<span class="badge text-bg-secondary badge-click code-badge" title="Click to copy">${esc(p.ean)}</span>` : ''}
        </div>
      </td>
    </tr>`).join('');
  return `<h6 class="mt-3 mb-1">${esc(title)}</h6>
    <table class="table table-sm align-middle">
      <thead class="table-light"><tr><th style="width:90px;">Model</th><th>Product</th><th style="width:170px;">Codes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function histEntityValue(key, v, change) {
  const fmt = x => esc(fmtHistField(key, x));
  if (change) {
    const old = histEmpty(change.old) ? '—' : `<s class="text-muted">${fmt(change.old)}</s>`;
    return `${old} <i class="bi bi-arrow-right"></i> <strong>${fmt(change.new)}</strong>`;
  }
  return fmt(v);
}
// purchase imports: new entity badges, updated products, then all products —
// badge colors follow the products page table
export function purchasesHistoryBody(h, snap) {
  let body = `<div class="mb-2"><span class="text-muted">Supplier:</span> <strong>${esc(snap.supplier)}</strong></div>`;

  const ENTITY_BADGE = {
    created_brands: () => '<span class="badge filter-badge">',
    created_categories: () => '<span class="badge filter-badge">',
    created_locations: () => '<span class="badge filter-badge">',
    created_devices: () => '<span class="badge text-bg-primary">',
    created_features: () => '<span class="badge text-bg-success">'
  };
  const badgeGroups = [];
  for (const key of Object.keys(ENTITY_BADGE)) {
    if (histArrHas(snap[key])) badgeGroups.push(`<span class="text-muted small me-1">${HISTORY_FIELD_LABELS[key.replace('created_', '')] || key}:</span> ` +
      snap[key].map(name => `${ENTITY_BADGE[key]()}${esc(name)}</span>`).join(' '));
  }
  if (histArrHas(snap.created_colors)) {
    badgeGroups.push('<span class="text-muted small me-1">Colors:</span> ' + snap.created_colors.map(c => {
      const col = typeof c === 'string' ? { name: c } : c;
      return `<span class="badge" style="background:${esc(col.tag_color || '#6c757d')};color:${esc(col.tag_text || '#fff')};border:1px solid ${esc(col.tag_border || '#6c757d')}">${esc(col.name)}</span>`;
    }).join(' '));
  }
  if (badgeGroups.length) body += `<div class="mb-2">${badgeGroups.join('<br>')}</div>`;

  if (histArrHas(snap.updated)) {
    const diff = (pair, fmt = x => x) => pair
      ? `<s class="text-muted">${esc(fmt(pair.old) ?? '—')}</s> <i class="bi bi-arrow-right"></i> ${esc(fmt(pair.new) ?? '—')}`
      : '—';
    const plain = v => esc(v ?? '—');
    const rows = snap.updated.map(u => `
      <tr>
        <td>${esc(u.name)}<div class="small text-muted">${esc(u.sku)}</div></td>
        <td class="small">${u.fields && u.fields.supplier_name ? diff(u.fields.supplier_name) : plain(u.supplier_name)}</td>
        <td class="small">${u.fields && u.fields.ean ? diff(u.fields.ean) : plain(u.ean)}</td>
        <td class="small money">${u.fields && u.fields.cost ? diff(u.fields.cost, eur) : eur(u.cost)}</td>
        <td class="text-nowrap"><s class="text-muted">${u.old_quantity}</s> <i class="bi bi-arrow-right"></i> <strong>${u.old_quantity + u.add_quantity}</strong> <span class="badge text-bg-secondary">+${u.add_quantity}</span></td>
      </tr>`).join('');
    body += `<h6 class="mt-3 mb-1">Updated products</h6>
      <div class="table-responsive"><table class="table table-sm table-bordered align-middle">
        <thead class="table-light"><tr><th>Product</th><th>Supplier's product name</th><th>EAN</th><th>Cost</th><th>Quantity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  const allProducts = [
    ...(histArrHas(snap.updated) ? snap.updated.map(u => ({
      model: u.model, name: u.name, sku: u.sku, ean: u.ean, cost: u.cost, quantity: u.old_quantity + u.add_quantity, is_new: false
    })) : []),
    ...(histArrHas(snap.created) ? snap.created.map(p => ({ ...p, is_new: true })) : [])
  ];
  if (allProducts.length) {
    const rows = allProducts.map(it => `
      <tr>
        <td>${esc(it.model || '')}</td>
        <td>${it.is_new ? '<span class="badge text-bg-success me-1">new</span>' : ''}${esc(it.name)}</td>
        <td>
          <div class="d-flex flex-column gap-1 align-items-start">
            <span class="badge text-bg-dark">${esc(it.sku)}</span>
            ${it.ean ? `<span class="badge text-bg-secondary">${esc(it.ean)}</span>` : ''}
          </div>
        </td>
        <td>${it.quantity}</td>
        <td class="text-nowrap">${eur(it.cost)}</td>
        <td class="text-nowrap">${eur(it.cost * it.quantity)}</td>
      </tr>`).join('');
    body += `<h6 class="mt-3 mb-1">All products</h6>
      <table class="table table-sm align-middle">
        <thead class="table-light"><tr><th style="width:90px;">Model</th><th>Product</th><th>Codes</th><th style="width:70px;">Qty</th><th>Cost</th><th>Line total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
  if (snap.total != null) {
    body += `<div class="text-end">
      <div class="money">Products: <span class="fw-bold">${eur(snap.total)}</span></div>
      <div class="money">Shipping: <span>${snap.shipping == null ? '—' : eur(snap.shipping)}</span></div>
      <div class="fw-bold text-success money">Total: ${eur(snap.total + (snap.shipping || 0))}</div>
    </div>`;
  }
  return body || '<div class="text-muted">No details stored.</div>';
}