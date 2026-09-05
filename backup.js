// Database backup helper.
// Uses better-sqlite3's db.backup() which produces a consistent snapshot of
// inventory.db (WAL included) while the server keeps running.
// Auto backups are skipped when no new history records exist since the last
// backup — i.e. nothing in the app data changed.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./logger');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP_COUNT = 14;
const LAST_ID_KEY = 'last_backup_history_id';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const safeName = name => {
  if (!/^(?:auto|manual)-\d{4}-\d{2}-\d{2}_\d{6}\.db$/.test(name) &&
      !/^inventory-backup-\d{4}-\d{2}-\d{2}_\d{6}\.db$/.test(name)) return null;
  return name;
};

function maxHistoryId() {
  return db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM history').get().id;
}

function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function prune() {
  const files = listBackups();
  for (const f of files.slice(KEEP_COUNT)) {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      logger.info('Old backup removed', { name: f.name });
    } catch (e) {
      logger.warning('Could not remove old backup', { name: f.name, message: e.message });
    }
  }
}

// kind: 'manual' | 'auto-startup' | 'auto-scheduled'
function createBackup(kind) {
  logger.info('Backup started', { kind });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const prefix = kind.startsWith('auto') ? 'auto' : 'manual';
  const name = `${prefix}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`;
  const dest = path.join(BACKUP_DIR, name);

  return new Promise((resolve, reject) => {
    db.backup(dest)
      .then(() => {
        const size = fs.statSync(dest).size;

        // Record the backup in history first, then store the marker including
        // this record so this backup does not cause another automatic backup.
        db.prepare(`INSERT INTO history (entity_type, entity_id, action, label, changes, snapshot)
          VALUES ('backups', NULL, 'create', ?, NULL, ?)`)
          .run(name, JSON.stringify({ kind, size }));
        db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .run(LAST_ID_KEY, String(maxHistoryId()));

        prune();
        logger.info('Backup completed', { name, size, kind });
        resolve({ name, size, kind });
      })
      .catch(err => {
        logger.error('Backup failed', { name, kind, message: err.message });
        reject(err);
      });
  });
}

function shouldAutoBackup() {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(LAST_ID_KEY);
  const lastId = row ? Number(row.value) : -1;
  return maxHistoryId() > lastId;
}

module.exports = { BACKUP_DIR, safeName, listBackups, createBackup, shouldAutoBackup };
