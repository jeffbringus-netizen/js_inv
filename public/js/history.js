import { $, esc, eur, copyToClipboard, listDiffCell, diffCell } from './ui.js';
import { HIST_TYPE_BADGE, HIST_ENTITY_TYPES, HISTORY_FIELD_LABELS, fmtHistField, productHistoryBody, salesHistoryBody, entityHistoryBody, purchasesHistoryBody } from './history-bodies.js';

let historyRows = [];

export async function loadHistory() {
  const type = $('#historyFilter').value;
  historyRows = await fetch('/api/history?type=' + type).then(r => r.json());
  renderHistory();
}

export function historyChangePreview(h) {
  // purchase imports: summarize what the import brought in (imports store no changes)
  if (h.entity_type === 'purchases' && h.snapshot) {
    const parts = [];
    if (Array.isArray(h.snapshot.created)) parts.push(`${h.snapshot.created.length} created`);
    if (Array.isArray(h.snapshot.updated)) parts.push(`${h.snapshot.updated.length} updated`);
    if (parts.length) return `<div class="small text-muted">${parts.join(' · ')}</div>`;
  }

  if (!h.changes) return '';
  const keys = Object.keys(h.changes);
  if (!keys.length) return '';

  // products added/removed on an entity: first item plus the remaining count
  if (h.changes.removed || h.changes.added) {
    const part = (key, word, suffix) => {
      const arr = h.changes[key];
      if (!Array.isArray(arr) || !arr.length) return '';
      const rest = arr.length > 1 ? ` and ${arr.length - 1} ${suffix}` : '';
      return `<div class="small text-muted">${word}: ${esc(arr[0])}${rest}</div>`;
    };
    return part('removed', 'Removed', 'others') + part('added', 'Added', 'more');
  }

  const f = keys[0];
  const c = h.changes[f];
  const label = HISTORY_FIELD_LABELS[f] || f;
  const val = v => (v === null || v === undefined || v === '') ? '—' : fmtHistField(f, v);
  const extra = keys.length > 1 ? ` <span class="text-muted">(+${keys.length - 1} more)</span>` : '';

  // single product + entity updates: name the changed fields, exact values on hover
  const isProductUpdate = h.entity_type === 'products' && h.action === 'update' && h.entity_id !== null;
  const isEntityUpdate = HIST_ENTITY_TYPES.includes(h.entity_type) && h.action === 'update';
  if (isProductUpdate || isEntityUpdate) {
    // unlinking a product stores a sentence, which reads best inline
    if (isEntityUpdate && keys.length === 1 && keys[0] === 'products') {
      return `<div class="small text-muted">${esc(label)}: <s>${esc(c.old ?? '—')}</s> → ${esc(c.new ?? '—')}</div>`;
    }
    const details = keys.map(k => {
      const ch = h.changes[k];
      const oldV = Array.isArray(ch.old) ? ch.old.join(', ') : ch.old;
      const newV = Array.isArray(ch.new) ? ch.new.join(', ') : ch.new;
      const fmt = v => (v === null || v === undefined || v === '') ? '—' : fmtHistField(k, v);
      return `${HISTORY_FIELD_LABELS[k] || k}: ${fmt(oldV)} → ${fmt(newV)}`;
    }).join('\n');
    return `<div class="small text-muted" title="${esc(details)}">${keys.map(k => esc(HISTORY_FIELD_LABELS[k] || k)).join(' / ')}</div>`;
  }

  // mass updates: products can start from different values, so only the new value matters
  if (h.entity_type === 'products' && h.action === 'update' && h.entity_id === null) {
    const newV = fmtHistField(f, Array.isArray(c.new) ? c.new.join(', ') : c.new);
    return `<div class="small text-muted">${esc(label)}: ${esc(newV ?? '—')}${extra}</div>`;
  }

  const oldV = val(Array.isArray(c.old) ? c.old.join(', ') : c.old);
  const newV = val(Array.isArray(c.new) ? c.new.join(', ') : c.new);
  return `<div class="small text-muted">${esc(label)}: <s>${esc(oldV)}</s> → ${esc(newV)}${extra}</div>`;
}

export function histLabelHtml(h) {
  const actionPrefix = h.action === 'create' ? '<strong>Created — </strong>'
    : h.action === 'delete' ? '<strong>Deleted — </strong>'
    : h.action === 'import' ? '<strong>Imported — </strong>'
    : h.action === 'complete' ? '<strong>Completed — </strong>'
    : h.action === 'cancel' ? '<strong>Canceled — </strong>'
    // mass update records already name the action in their label
    : h.action === 'update' && (h.entity_type === 'sales' || HIST_ENTITY_TYPES.includes(h.entity_type) || (h.entity_type === 'products' && h.entity_id !== null)) ? '<strong>Updated — </strong>'
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

$('#historyInfoBody').addEventListener('click', async e => {
  const code = e.target.closest('.code-badge');
  if (!code) return;
  await copyToClipboard(code.textContent.trim());
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

export function openHistoryInfo(h) {
  $('#historyInfoTitle').innerHTML =
    `<span class="badge ${HIST_TYPE_BADGE[h.entity_type] || 'text-bg-secondary'}">${h.entity_type}</span> ${histLabelHtml(h)}`;
  let body = `<div class="text-muted small mb-3">${esc(h.created_at)}</div>`;
  const snap = h.snapshot || {};

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
        body += `<td>${isList ? listDiffCell(b[k], snap.applied[k]) : (normCmp(k, b[k]) !== normCmp(k, snap.applied[k]) ? diffCell(oldV, newV, false) : esc(oldV ?? '—') || '—')}</td>`;
      }
      body += '</tr>';
    }
    body += '</tbody></table></div>';
    $('#historyInfoBody').innerHTML = body;
    historyInfoModal.show();
    return;
  }

  // product records reuse the products-table look (badges, toggles, € prices)
  if (h.entity_type === 'products') {
    body += productHistoryBody(h, snap);
    $('#historyInfoBody').innerHTML = body;
    historyInfoModal.show();
    return;
  }

  // sale orders list their items like the sale table on the sales page
  if (h.entity_type === 'sales') {
    body += salesHistoryBody(h, snap);
    $('#historyInfoBody').innerHTML = body;
    historyInfoModal.show();
    return;
  }

  // entities share the product modal style
  if (HIST_ENTITY_TYPES.includes(h.entity_type)) {
    body += entityHistoryBody(h, snap);
    $('#historyInfoBody').innerHTML = body;
    historyInfoModal.show();
    return;
  }

  // purchase imports: supplier, product lists and totals
  if (h.entity_type === 'purchases') {
    body += purchasesHistoryBody(h, snap);
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
