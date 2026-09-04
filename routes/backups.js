const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { DB_PATH } = require('../db');
const { BACKUP_DIR, safeName, listBackups, createBackup, shouldAutoBackup } = require('../backup');

const router = express.Router();

// GET /api/backups — list all backup files
router.get('/', (req, res) => {
  res.json(listBackups());
});

// POST /api/backups — create a backup now (manual, always runs)
router.post('/', (req, res) => {
  createBackup('manual')
    .then(b => res.status(201).json(b))
    .catch(e => res.status(500).json({ error: 'Backup failed: ' + e.message }));
});

// GET /api/backups/auto-check — used by tests/scheduler preview: would an auto backup run now?
router.get('/auto-check', (req, res) => {
  res.json({ needed: shouldAutoBackup() });
});

// GET /api/backups/:name/download
router.get('/:name/download', (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid backup name' });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  res.download(file, name);
});

// POST /api/backups/:name/restore — replace current DB with the backup and restart.
// Locally we respawn a fresh server process; inside Docker we exit and let the
// container restart policy bring the app back up.
router.post('/:name/restore', (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid backup name' });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  db.close();
  fs.copyFileSync(file, DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    const f = DB_PATH + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  res.json({ ok: true, restarting: true });
  setTimeout(() => {
    if (process.env.IS_DOCKER === '1') {
      // docker compose `restart: unless-stopped` restarts the container
      process.exit(0);
    }
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      detached: true, stdio: 'ignore', cwd: path.join(__dirname, '..')
    });
    child.unref();
    process.exit(0);
  }, 300);
});

// DELETE /api/backups/:name
router.delete('/:name', (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid backup name' });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

module.exports = router;
