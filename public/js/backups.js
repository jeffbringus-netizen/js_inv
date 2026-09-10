import { $, esc, toast } from './ui.js';

// ---------- backups ----------
let backups = [];

export async function loadBackups() {
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