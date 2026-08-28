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

// Each test takes its own pair of ports. Sharing them let a gateway from a
// finished test still be listening when the next one started, and the next
// test then measured the wrong process.
let nextPort = 8794;
function reservePorts() {
  const gatewayPort = nextPort;
  const upstreamPort = nextPort + 1;
  nextPort += 2;
  return { gatewayPort, upstreamPort };
}

function startGateway({ gatewayPort, upstreamPort }) {
  return spawn(process.execPath, [GATEWAY], {
    env: {
      ...process.env,
      UNIVERSE_GATEWAY_HOST: '127.0.0.1',
      UNIVERSE_GATEWAY_PORT: String(gatewayPort),
      UNIVERSE_GATEWAY_BACKEND: `http://127.0.0.1:${upstreamPort}`,
      UNIVERSE_GATEWAY_OVERLAY: `http://127.0.0.1:${upstreamPort}`,
      UNIVERSE_GATEWAY_ROOT: ROOT,
    },
    stdio: 'ignore',
  });
}

function ask(gatewayPort, path = '/api/v1/backend-info') {
  return new Promise((resolve) => {
    const started = Date.now();
    http
      .get({ host: '127.0.0.1', port: gatewayPort, path }, (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode, ms: Date.now() - started }));
      })
      .on('error', (error) => resolve({ status: 0, error: error.code, ms: Date.now() - started }));
  });
}

test('a request waits for an upstream that is restarting, rather than failing', async (t) => {
  const ports = reservePorts();
  const gateway = startGateway(ports);
  t.after(() => gateway.kill());
  await sleep(1200);

  // Nothing is listening yet, exactly as during a restart.
  const inFlight = ask(ports.gatewayPort);
  await sleep(1000);

  const upstream = http.createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => upstream.listen(ports.upstreamPort, '127.0.0.1', resolve));
  t.after(() => upstream.close());

  const bridged = await inFlight;
  assert.equal(bridged.status, 200, 'a restart should be bridged, not reported as a failure');
});

test('an upstream that is genuinely gone is still reported, and promptly', async (t) => {
  const ports = reservePorts();
  const gateway = startGateway(ports);
  t.after(() => gateway.kill());
  await sleep(1200);

  const dead = await ask(ports.gatewayPort);
  assert.equal(dead.status, 502, 'a dead upstream must be a gateway failure, never an empty success');
  // Bounded well inside the page's own request budget, so the interface still
  // reaches a terminal state quickly.
  assert.ok(dead.ms < 12_000, `gave up after ${dead.ms}ms, which is too long to hold a reader`);
});

test('a reader who leaves mid-retry does not take the gateway down', async (t) => {
  // This crashed the gateway in CI. With no upstream listening, a request
  // enters the retry loop; the client then goes away, and the write that
  // follows throws from a timer callback where there is no request to fail.
  const ports = reservePorts();
  const gateway = startGateway(ports);
  t.after(() => gateway.kill());
  await sleep(1200);

  for (let i = 0; i < 6; i++) {
    const request = http.get({ host: '127.0.0.1', port: ports.gatewayPort, path: '/api/v1/backend-info' });
    request.on('error', () => undefined);
    // Abandon the request while it is still waiting on a refused upstream.
    await sleep(300);
    request.destroy();
  }

  // Long enough for every abandoned retry to have fired.
  await sleep(6000);

  const stillServing = await ask(ports.gatewayPort, '/');
  assert.notEqual(stillServing.status, 0, 'the gateway died while serving abandoned requests');
});
