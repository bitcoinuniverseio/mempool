import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, connect } from 'node:net';
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

// Each test takes its own pair of ports, and asks the operating system for
// them rather than counting from a fixed base.
//
// Sharing ports let a gateway from a finished test still be listening when the
// next one started, and the next test then measured the wrong process. Counting
// from 8794 has the same fault against anything outside this file: the test
// asserts that nothing is listening on the upstream port, on a port it never
// owned. On a runner where something else holds 8795 the connection is accepted
// and then never answered, so instead of the instant ECONNREFUSED the gateway
// retries on, the request waits. That is what happened on universe-runner-07:
// the same assertion that takes six seconds locally gave up after 106 seconds.
//
// The visual matrix in this repository learned this already, and its workflow
// step says so: a fixed port once had it measuring another job's build. Moving
// this job onto the shared runner pool turned a rare collision into a likely
// one, which is a good change finding an old fault rather than causing one.
function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('listening', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

async function reservePorts() {
  const [gatewayPort, upstreamPort] = await Promise.all([freePort(), freePort()]);
  return { gatewayPort, upstreamPort };
}

/**
 * Refuse to measure a port this test does not own.
 *
 * "An upstream that is genuinely gone" is only a true premise if nothing is
 * listening. If something is, the test is timing a stranger's service and
 * whatever it concludes is about them.
 */
async function assertNothingIsListening(port) {
  const refused = await new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(2_000);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(false));
    socket.once('error', (error) => done(error.code === 'ECONNREFUSED'));
  });
  assert.ok(
    refused,
    `port ${port} is not free: something answered or hung, so this test would be measuring it rather than the gateway`,
  );
}

function startGateway({ gatewayPort, upstreamPort, esploraPort }) {
  return spawn(process.execPath, [GATEWAY], {
    env: {
      ...process.env,
      UNIVERSE_GATEWAY_HOST: '127.0.0.1',
      UNIVERSE_GATEWAY_PORT: String(gatewayPort),
      UNIVERSE_GATEWAY_BACKEND: `http://127.0.0.1:${upstreamPort}`,
      UNIVERSE_GATEWAY_OVERLAY: `http://127.0.0.1:${upstreamPort}`,
      ...(esploraPort ? { UNIVERSE_GATEWAY_ESPLORA: `http://127.0.0.1:${esploraPort}` } : {}),
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
  const ports = await reservePorts();
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
  const ports = await reservePorts();
  await assertNothingIsListening(ports.upstreamPort);
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
  const ports = await reservePorts();
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

/**
 * The address index restarts too, and it is a separate process from the two
 * above with its own reasons to go away: a rebuild, a compaction that ran the
 * volume low, the disk guard stopping it.
 *
 * What must not happen while it is down is the rest of the site going with it.
 * The address page is allowed to say it cannot answer right now; a block page,
 * a transaction page, and the frontend itself are not, because none of them
 * reads that index. A gateway that treated one dead upstream as a dead origin
 * would turn a bounded degradation into an outage.
 */
test('an index restart is bridged, and only address traffic waits for it', async (t) => {
  const ports = await reservePorts();
  const esploraPort = await freePort();
  await assertNothingIsListening(esploraPort);

  const backend = http.createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"gitCommit":"abc1234"}');
  });
  await new Promise((resolve) => backend.listen(ports.upstreamPort, '127.0.0.1', resolve));
  t.after(() => backend.close());

  const gateway = startGateway({ ...ports, esploraPort });
  t.after(() => gateway.kill());
  await sleep(1200);

  // The index is down. An address request enters the retry loop.
  const address = ask(ports.gatewayPort, '/api/address/1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3');

  // Everything that does not read the index keeps working while it waits.
  const backendInfo = await ask(ports.gatewayPort, '/api/v1/backend-info');
  assert.equal(backendInfo.status, 200, 'a down index must not take the explorer backend with it');
  const document = await ask(ports.gatewayPort, '/');
  assert.ok(document.status === 200 || document.status === 503, 'the frontend must still be served');

  // The index comes back, and the waiting request is answered rather than failed.
  const index = http.createServer((request, response) => {
    assert.equal(request.url, '/address/1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3', 'the /api prefix must be stripped');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"address":"1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3"}');
  });
  await new Promise((resolve) => index.listen(esploraPort, '127.0.0.1', resolve));
  t.after(() => index.close());

  const bridged = await address;
  assert.equal(bridged.status, 200, 'an index restart should be bridged, not reported as a failure');
});

test('an index that is genuinely gone is reported as unavailable, not as an empty address', async (t) => {
  const ports = await reservePorts();
  const esploraPort = await freePort();
  await assertNothingIsListening(esploraPort);

  const gateway = startGateway({ ...ports, esploraPort });
  t.after(() => gateway.kill());
  await sleep(1200);

  const dead = await ask(ports.gatewayPort, '/api/address/1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3');
  // Never 200 with an empty body. An address page that renders a zero balance
  // because the index is down has told somebody their money is gone.
  assert.equal(dead.status, 502, 'a dead index must be a gateway failure, never an empty success');
  assert.ok(dead.ms < 12_000, `gave up after ${dead.ms}ms, which is too long to hold a reader`);
});

test('the index administrative surface is refused rather than proxied', async (t) => {
  const ports = await reservePorts();
  const esploraPort = await freePort();

  let reachedTheIndex = false;
  const index = http.createServer((_, response) => {
    reachedTheIndex = true;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  await new Promise((resolve) => index.listen(esploraPort, '127.0.0.1', resolve));
  t.after(() => index.close());

  const gateway = startGateway({ ...ports, esploraPort });
  t.after(() => gateway.kill());
  await sleep(1200);

  const internal = await ask(ports.gatewayPort, '/api/internal/txs');
  assert.equal(internal.status, 404, 'the index administrative routes must not be public');
  assert.equal(reachedTheIndex, false, 'the request must not have reached the index at all');
});
