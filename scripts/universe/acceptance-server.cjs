// Local, isolated host for the actual compiled parser and swap route modules.
// This is not a full node/indexer deployment or a substitute for chain evidence.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const backendRequire = createRequire(path.join(root, 'backend/package.json'));
if (!process.env.MEMPOOL_CONFIG_FILE) throw new Error('Set an explicit isolated MEMPOOL_CONFIG_FILE.');
const config = JSON.parse(fs.readFileSync(process.env.MEMPOOL_CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''));
if (config.MEMPOOL?.ENABLED !== false || config.DATABASE?.ENABLED !== false ||
    config.CORE_RPC?.HOST !== '127.0.0.1' || config.CORE_RPC?.PORT !== 1) {
  throw new Error('Acceptance host requires disabled indexing/storage and a disabled loopback RPC dependency.');
}
const express = backendRequire('express');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const supplied = req.get('x-request-id');
  res.set('x-request-id', supplied && /^[a-zA-Z0-9-]{1,64}$/.test(supplied) ? supplied : randomUUID());
  next();
});
app.use(express.json({ limit: '2mb' }));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
app.get(['/__acceptance', '/api/v1/__acceptance'], (_req, res) => res.json({
  scope: 'isolated compiled route handlers and candidate frontend', revision,
  nodeAvailable: false, persistenceAvailable: false, realNetworkE2ePasses: 0,
}));
require(path.join(root, 'backend/dist/api/intelligence/silent-payments/silent-payments.routes')).default.initRoutes(app);
require(path.join(root, 'backend/dist/api/intelligence/swaps/swaps.routes')).default.initRoutes(app);
const apiPrefixes = ['', '/signet', '/testnet', '/testnet4', '/regtest']
  .flatMap(network => ['/api/v1', '/api/v2', '/api/v3'].map(api => network + api));
app.use(apiPrefixes, (_req, res) => {
  res.status(503).json({ code: 'ACCEPTANCE_DEPENDENCY_UNAVAILABLE',
    error: 'This isolated localhost host has no chain, indexer or portfolio authority configured.' });
});
// Handler-only mode lets the actual gateway own the one frontend origin.
// It does not start indexing, supply authority data or claim full backend boot.
if (process.env.UNIVERSE_ACCEPTANCE_HANDLER_ONLY === '1') {
  app.use((_req, res) => res.status(404).json({ code: 'ACCEPTANCE_ROUTE_NOT_MOUNTED' }));
} else {
  const build = path.join(root, 'frontend/dist/mempool/browser');
  if (!fs.existsSync(path.join(build, 'index.html'))) throw new Error('Build the candidate frontend first.');
  app.use(express.static(build));
  app.get('*', (_req, res) => res.sendFile(path.join(build, 'index.html')));
}
app.use((error, _req, res, _next) => {
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: 'INVALID_REQUEST', error: 'Invalid JSON request body.' });
});
const port = Number(process.env.UNIVERSE_ACCEPTANCE_PORT || 4310);
const server = app.listen(port, '127.0.0.1', () => console.log(`Local acceptance host listening on http://localhost:${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
