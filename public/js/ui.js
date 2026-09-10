// Shared UI helpers: formatting, escaping, toasts, clipboard, small widgets.
// Errors from getJSON are surfaced through showApiError and the global
// unhandledrejection handler so nothing fails silently.
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const eur = n => '€ ' + Number(n).toFixed(2);
export const eur4 = n => '€ ' + Number(n).toFixed(4);
export function paginationHtml(meta, target, label) {
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
export function showUnsavedChangesPrompt(warningElement) {
  warningElement.textContent = 'You have unsaved changes. Save the product or undo your changes before closing.';
  warningElement.hidden = false;
  warningElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
export function validateRequiredFields(form, fields, errorElement) {
  const missing = [];
  for (const [field, label] of fields) {
    const input = form.elements[field];
    if (!input) continue;
    const empty = !String(input.value).trim();
    input.classList.toggle('is-invalid', empty);
    if (empty) missing.push(label);
  }
  if (missing.length) {
    errorElement.textContent = `Please fill in all required fields: ${missing.join(', ')}`;
    errorElement.hidden = false;
    return false;
  }
  errorElement.hidden = true;
  return true;
}
// list diff: shared values plain, removed struck, added green bold
export function listDiffCell(oldStr, newStr) {
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
// ---------- toast ----------
export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}
export const STATUS_BADGE = { draft: 'text-bg-secondary', completed: 'text-bg-success', canceled: 'text-bg-danger' };
export function diffCell(oldVal, newVal, field, rowIndex, changes) {
  const changed = String(oldVal ?? '') !== String(newVal ?? '');
  if (!changed) return esc(newVal ?? '');
  if (typeof field !== 'string') {
    const showChanged = field !== false;
    return `<s class="text-muted">${esc(oldVal ?? '')}</s> <i class="bi bi-arrow-right"></i> ${esc(newVal ?? '')}${showChanged ? ' <span class="badge text-bg-warning">changed</span>' : ''}`;
  }
  const active = changes[field];
  return `<s class="text-muted">${esc(oldVal ?? '')}</s> <i class="bi bi-arrow-right"></i> ${esc(newVal ?? '')}
    <button type="button" class="badge badge-click border-0 ${active ? 'text-bg-warning' : 'text-bg-danger'} imp-change-toggle"
      data-i="${rowIndex}" data-field="${field}" title="Toggle whether this value is imported">${active ? 'changed' : 'unchanged'}</button>`;
}
export const copyToClipboard = async text => {
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
};

// Fetch JSON and throw a descriptive error on non-2xx responses.
export async function getJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || res.statusText || 'Request failed');
    err.apiDetails = { method: options.method || 'GET', url, status: res.status };
    throw err;
  }
  return res.json();
}

// Visible, detailed error banner — internal tool, so show everything needed
// to track where an issue is coming from.
export function showApiError(err) {
  let banner = document.getElementById('apiErrorBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'apiErrorBanner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2000;background:#7a1d1d;color:#fff;' +
      'padding:.5rem 2.5rem .5rem 1rem;font-size:.85rem;white-space:pre-wrap;box-shadow:0 -2px 8px rgba(0,0,0,.35)';
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss error');
    close.style.cssText = 'position:absolute;top:.25rem;right:.5rem;background:none;border:0;color:#fff;font-size:1.2rem;cursor:pointer';
    close.addEventListener('click', () => banner.remove());
    banner.appendChild(close);
    const text = document.createElement('div');
    text.className = 'api-error-text';
    banner.appendChild(text);
    document.body.appendChild(banner);
  }
  const d = err.apiDetails;
  const where = d ? `${d.method} ${d.url} -> HTTP ${d.status}` : 'client error';
  banner.querySelector('.api-error-text').textContent = `${where}\n${err.message || err}`;
}
window.addEventListener('unhandledrejection', e => showApiError(e.reason || e.error || e));
