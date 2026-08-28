import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A release restarts the backend and the overlay, and they take a few seconds
 * to listen again. The gateway used to answer 502 the instant the connection
 * was refused, so every request in that window became a visible failure and the
 * production monitor recorded the deploy as an outage.
 *
 * These start the real gateway against an upstream that is not listening, and
 * check that a request waits for it to come back rather than failing, while an
 * upstream that is genuinely gone is still reported promptly.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY = join(HERE, 'gateway.mjs');
const ROOT = join(HERE, '..', '..', 'frontend', 'dist', 'mempool', 'browser');

const GATEWAY_PORT = 8794;
const UPSTREAM_PORT = 8795;

function startGateway() {
  return spawn(process.execPath, [GATEWAY], {
    env: {
      ...process.env,
      UNIVERSE_GATEWAY_HOST: '127.0.0.1',
      UNIVERSE_GATEWAY_PORT: String(GATEWAY_PORT),
      UNIVERSE_GATEWAY_BACKEND: `http://127.0.0.1:${UPSTREAM_PORT}`,
      UNIVERSE_GATEWAY_OVERLAY: `http://127.0.0.1:${UPSTREAM_PORT}`,
      UNIVERSE_GATEWAY_ROOT: ROOT,
    },
    stdio: 'ignore',
  });
}

function ask(path = '/api/v1/backend-info') {
  return new Promise((resolve) => {
    const started = Date.now();
    http
      .get({ host: '127.0.0.1', port: GATEWAY_PORT, path }, (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, ms: Date.now() - started }));
      })
      .on('error', (error) => resolve({ status: 0, error: error.code, ms: Date.now() - started }));
  });
}

test('a request waits for an upstream that is restarting, rather than failing', async (t) => {
  const gateway = startGateway();
  t.after(() => gateway.kill());
  await sleep(1200);

  // Nothing is listening yet, exactly as during a restart.
  const inFlight = ask();
  await sleep(1000);

  const upstream = http.createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  const bridged = await inFlight;
  assert.equal(bridged.status, 200, 'a restart should be bridged, not reported as a failure');
});

test('an upstream that is genuinely gone is still reported, and promptly', async (t) => {
  const gateway = startGateway();
  t.after(() => gateway.kill());
  await sleep(1200);

  const dead = await ask();
  assert.equal(dead.status, 502, 'a dead upstream must be a gateway failure, never an empty success');
  // Bounded well inside the page's own request budget, so the interface still
  // reaches a terminal state quickly.
  assert.ok(dead.ms < 12_000, `gave up after ${dead.ms}ms, which is too long to hold a reader`);
});
