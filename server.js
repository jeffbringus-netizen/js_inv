const express = require('express');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
require('./db'); // initialize schema

const app = express();
app.use(express.json());

// Inject the UI configuration script into the HTML so version/configuration
// values stay in a separate file instead of being hard-coded in index.html.
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const withConfig = html.replace(
    '</head>',
    '  <script src="js/config.js"></script>\n</head>'
  );
  res.type('html').send(withConfig);
});

app.use(express.static(path.join(__dirname, 'public')));

// Give mutating API requests human-readable action names. We deliberately do
// not log request bodies because imports can contain large or sensitive data.
function getMutationAction(method, url) {
  const pathname = url.split('?')[0];

  if (method === 'POST' && pathname === '/api/products') return 'Creating product';
  if (method === 'PUT' && /^\/api\/products\/\d+$/.test(pathname)) return 'Updating product';
  if (method === 'DELETE' && /^\/api\/products\/\d+$/.test(pathname)) return 'Deleting product';
  if (method === 'POST' && pathname === '/api/products/mass-update') return 'Mass updating products';

  if (method === 'POST' && /^\/api\/entities\/[^/]+$/.test(pathname)) return `Creating ${pathname.split('/')[3]}`;
  if (method === 'PUT' && /^\/api\/entities\/[^/]+\/\d+$/.test(pathname)) return `Updating ${pathname.split('/')[3]}`;
  if (method === 'DELETE' && /^\/api\/entities\/[^/]+\/\d+$/.test(pathname)) return `Deleting ${pathname.split('/')[3]}`;
  if (method === 'DELETE' && /^\/api\/entities\/[^/]+\/\d+\/products\/\d+$/.test(pathname)) return 'Unlinking product from entity';

  if (method === 'POST' && pathname === '/api/sale-orders') return 'Creating sale order';
  if (method === 'PUT' && /^\/api\/sale-orders\/\d+$/.test(pathname)) return 'Updating sale order';
  if (method === 'POST' && /^\/api\/sale-orders\/\d+\/complete$/.test(pathname)) return 'Completing sale order';
  if (method === 'POST' && /^\/api\/sale-orders\/\d+\/cancel$/.test(pathname)) return 'Canceling sale order';

  if (method === 'POST' && pathname === '/api/purchases/parse-koff') return 'Parsing purchase import file';
  if (method === 'POST' && pathname === '/api/purchases/complete') return 'Completing purchase import';

  if (method === 'POST' && pathname === '/api/backups') return 'Creating backup';
  if (method === 'POST' && /^\/api\/backups\/[^/]+\/restore$/.test(pathname)) return 'Restoring backup';
  if (method === 'DELETE' && /^\/api\/backups\/[^/]+$/.test(pathname)) return 'Deleting backup';

  return null;
}

// Log the outcome of every mutating application action. This captures both
// explicit route errors (400/409/etc.) and unexpected server failures (500).
app.use((req, res, next) => {
  const action = getMutationAction(req.method, req.originalUrl);
  if (!action) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    const meta = {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      duration_ms: Date.now() - startedAt
    };

    if (res.statusCode >= 500) {
      logger.error(`${action} failed`, meta);
    } else if (res.statusCode >= 400) {
      logger.warning(`${action} rejected`, meta);
    } else {
      logger.info(`${action} completed`, meta);
    }
  });

  next();
});

app.use('/api/products', require('./routes/products'));
app.use('/api/entities', require('./routes/entities'));
app.use('/api/sale-orders', require('./routes/sales'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/history', require('./routes/history'));
app.use('/api/backups', require('./routes/backups'));
app.use('/api/admin', require('./routes/admin'));

// Catch unhandled Express errors and make them visually obvious in container
// logs. Do not return the raw internal error to the client.
app.use((err, req, res, next) => {
  logger.error('Unhandled request error', {
    method: req.method,
    path: req.originalUrl,
    message: err && err.message ? err.message : String(err)
  });

  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Scheduled checks only create a backup when new history records exist.
const { createBackup, shouldAutoBackup } = require('./backup');

setInterval(() => {
  if (!shouldAutoBackup()) {
    logger.info('Auto backup skipped: no changes since last backup');
    return;
  }

  createBackup('auto-scheduled')
    .then(b => logger.info('Auto backup created', { name: b.name, size: b.size }))
    .catch(e => logger.error('Auto backup failed', { message: e.message }));
}, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => logger.info(`Inventory app running at http://localhost:${PORT}`));
