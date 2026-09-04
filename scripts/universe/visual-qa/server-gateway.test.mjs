import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayServer } from './server-gateway.mjs';

test('starts on random port and verifies exact identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-test-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>Gateway Test</body></html>');

  const gw = new GatewayServer({
    buildDir: dir,
    role: 'candidate',
    sourceCommit: 'abcdef1234567890',
    buildHash: 'hash-998877',
  });

  try {
    const started = await gw.start();
    assert.equal(started.host, '127.0.0.1');
    assert.ok(started.port > 0);

    const verified = await gw.verifyIdentity();
    assert.equal(verified, true);

    const res = await fetch(`http://127.0.0.1:${started.port}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, '<html><body>Gateway Test</body></html>');
    assert.equal(res.headers.get('x-gateway-nonce'), gw.nonce);
  } finally {
    await gw.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negative test: rejects when identity values mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gw-test-neg-'));
  writeFileSync(join(dir, 'index.html'), '<html><body>Negative Test</body></html>');

  const gw = new GatewayServer({
    buildDir: dir,
    role: 'candidate',
    sourceCommit: 'commit-a',
    buildHash: 'build-a',
  });

  try {
    await gw.start();

    // Verify rejection when caller expects another build hash
    await assert.rejects(
      async () => {
        await gw.verifyIdentity({ buildHash: 'build-different' });
      },
      /Build hash mismatch/,
    );
  } finally {
    await gw.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
