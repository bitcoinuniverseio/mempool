import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('real gateway serves dotted peer deep links and keeps missing assets absent', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'universe-gateway-peer-'));
  const document = '<!doctype html><title>Peer route test</title>';
  await writeFile(join(root, 'index.html'), document);
  const port = await new Promise(resolvePort => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close(() => resolvePort(selected)); });
  });
  const gateway = spawn(process.execPath, [fileURLToPath(new URL('./gateway.mjs', import.meta.url))], {
    env: { ...process.env, UNIVERSE_GATEWAY_NO_LISTEN: '0', UNIVERSE_GATEWAY_ROOT: root,
      UNIVERSE_GATEWAY_HOST: '127.0.0.1', UNIVERSE_GATEWAY_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((ready, fail) => {
      const timer = setTimeout(() => fail(new Error('Gateway startup timed out')), 5000);
      gateway.stdout.once('data', () => { clearTimeout(timer); ready(); });
      gateway.once('error', error => { clearTimeout(timer); fail(error); });
      gateway.once('exit', () => { clearTimeout(timer); fail(new Error('Gateway exited before readiness')); });
    });
    for (const prefix of ['', '/signet', '/testnet4']) {
      const response = await fetch(`http://127.0.0.1:${port}${prefix}/network/global/node/127.0.0.1%3A8333`, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 200, prefix || 'root');
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), document);
    }
    for (const asset of ['/missing.js', '/resources/missing.svg', '/missing.css']) {
      const response = await fetch(`http://127.0.0.1:${port}${asset}`, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 404, asset);
    }
  } finally {
    if (gateway.exitCode === null && gateway.signalCode === null) {
      const closed = new Promise(done => gateway.once('exit', done)); gateway.kill('SIGTERM'); await closed;
    }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('universe-gateway-peer-'));
    await rm(root, { recursive: true, force: true });
  }
});
