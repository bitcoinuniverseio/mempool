import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const evidence = fileURLToPath(new URL('.', import.meta.url));
const backend = 'D:/universe/backend-apis/.tmp/explorer-health-cc524f6d97b5';
const mempool = 'D:/universe/mempool/.tmp/explorer-health-cc524f6d97b5';
const mode = process.argv[2];
if (!['overlay', 'gateway'].includes(mode)) throw new Error('Expected overlay or gateway');
const port = mode === 'overlay' ? 3400 : 4310;
await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => server.close(resolve));
});
const env = { ...process.env, NODE_ENV: 'development' };
if (mode === 'overlay') Object.assign(env, {
  UNIVERSE_EXPLORER_HOST: '127.0.0.1', UNIVERSE_EXPLORER_PORT: '3400',
  UNIVERSE_EXPLORER_RELEASE_SHA: '8b2aea3afd4b2f26e2ee5f1275171a937515cbc2',
  UNIVERSE_EXPLORER_SOURCES_JSON: JSON.stringify([{ authorityId: 'mempool-backend', origin: 'https://explorer.bitcoinuniverse.io', protocols: ['bitcoin'], network: 'bitcoin:mainnet', readyPath: '/api/v1/backend-info' }]),
  UNIVERSE_DOGECOIN_BLOCKBOOK_ORIGIN: '', UNIVERSE_ZCASH_INDEXER_ORIGIN: '',
  UNIVERSE_EXPLORER_CANDIDATE_MODE: '0',
});
else Object.assign(env, {
  UNIVERSE_GATEWAY_HOST: '127.0.0.1', UNIVERSE_GATEWAY_PORT: '4310',
  UNIVERSE_GATEWAY_BACKEND: 'https://explorer.bitcoinuniverse.io',
  UNIVERSE_GATEWAY_OVERLAY: 'http://127.0.0.1:3400',
  UNIVERSE_GATEWAY_ESPLORA: '',
  UNIVERSE_GATEWAY_ROOT: `${mempool}/frontend/dist/mempool/browser`,
});
const script = mode === 'overlay' ? `${backend}/dist/universe-explorer-main.js` : `${mempool}/scripts/universe/gateway.mjs`;
const child = spawn(process.execPath, [script], {
  cwd: mode === 'overlay' ? backend : mempool, env, detached: true, windowsHide: true,
  stdio: ['ignore', fs.openSync(`${evidence}/${mode}-stdout.log`, 'a'), fs.openSync(`${evidence}/${mode}-stderr.log`, 'a')],
});
child.unref();
fs.writeFileSync(`${evidence}/${mode}-process.json`, JSON.stringify({ pid: child.pid, script, port, startedAt: new Date().toISOString(), scope: 'local candidate; first-party read-only public Bitcoin upstream; no DOGE/ZEC private authority configured' }, null, 2));
console.log(JSON.stringify({ mode, pid: child.pid, port }));
