const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/history?type=products|sales|... (omit or "all" for everything)
router.get('/', (req, res) => {
  const type = req.query.type && req.query.type !== 'all' ? req.query.type : null;
  const rows = type
    ? db.prepare('SELECT * FROM history WHERE entity_type = ? ORDER BY id DESC LIMIT 500').all(type)
    : db.prepare('SELECT * FROM history ORDER BY id DESC LIMIT 500').all();
  res.json(rows.map(r => ({
    ...r,
    changes: r.changes ? JSON.parse(r.changes) : null,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null
  })));
});

module.exports = router;
