import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function listen(server) {
  return new Promise((resolvePort) => {
    server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function waitForGateway(origin, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`gateway exited with ${child.exitCode}`);
    try {
      const response = await fetch(origin + '/__gateway/health', {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error('gateway did not become ready');
}

function openUpgrade(originPort) {
  return new Promise((resolveSocket, reject) => {
    const socket = createConnection(originPort, '127.0.0.1');
    let received = '';
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      received += chunk.toString('utf8');
      if (received.includes('-connected')) resolveSocket({ socket, received });
    });
    socket.once('connect', () => {
      socket.write(
        'GET /api/v1/universe/ws HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${originPort}\r\n` +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
      );
    });
  });
}

function waitForText(socket, expected) {
  return new Promise((resolveText, reject) => {
    const timeout = setTimeout(() => reject(new Error(`did not receive ${expected}`)), 2_000);
    const onData = (chunk) => {
      if (!chunk.toString('utf8').includes(expected)) return;
      clearTimeout(timeout);
      socket.off('data', onData);
      resolveText();
    };
    socket.on('data', onData);
  });
}

test('atomic handoff preserves old requests and sockets while new traffic reaches the candidate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gateway-overlay-handoff-'));
  const routeFile = join(directory, 'overlay-route.json');
  const routePending = `${routeFile}.new`;
  const oldSockets = new Set();
  const candidateSockets = new Set();
  let releaseHeldRequest;
  let markHeldRequestSeen;
  const heldRequestSeen = new Promise((resolveSeen) => {
    markHeldRequestSeen = resolveSeen;
  });
  const heldRequestGate = new Promise((resolveHeld) => {
    releaseHeldRequest = resolveHeld;
  });

  const old = createServer(async (request, response) => {
    if (request.url?.includes('hold=1')) {
      markHeldRequestSeen();
      await heldRequestGate;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ upstream: 'old' }));
  });
  old.on('upgrade', (_request, socket) => {
    oldSockets.add(socket);
    socket.on('close', () => oldSockets.delete(socket));
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\nold-connected\n',
    );
  });
  const candidate = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ upstream: 'candidate' }));
  });
  candidate.on('upgrade', (_request, socket) => {
    candidateSockets.add(socket);
    socket.on('close', () => candidateSockets.delete(socket));
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Connection: Upgrade\r\nUpgrade: websocket\r\n\r\ncandidate-connected\n',
    );
  });

  const oldPort = await listen(old);
  const candidatePort = await listen(candidate);
  const reservation = createServer();
  const gatewayPort = await listen(reservation);
  await close(reservation);
  const environment = { ...process.env };
  delete environment.LISTEN_PID;
  delete environment.LISTEN_FDS;
  Object.assign(environment, {
    UNIVERSE_GATEWAY_HOST: '127.0.0.1',
    UNIVERSE_GATEWAY_PORT: String(gatewayPort),
    UNIVERSE_GATEWAY_BACKEND: `http://127.0.0.1:${oldPort}`,
    UNIVERSE_GATEWAY_OVERLAY: `http://127.0.0.1:${oldPort}`,
    UNIVERSE_GATEWAY_OVERLAY_ROUTE_FILE: routeFile,
    UNIVERSE_GATEWAY_ROOT: directory,
    UNIVERSE_GATEWAY_PORTFOLIO_V2: '0',
  });
  const child = spawn(process.execPath, [resolve('scripts/universe/gateway.mjs')], {
    cwd: resolve('.'),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => {
    childOutput += chunk;
  });
  child.stderr.on('data', (chunk) => {
    childOutput += chunk;
  });

  const gateway = `http://127.0.0.1:${gatewayPort}`;
  let oldUpgrade;
  let candidateUpgrade;
  try {
    await waitForGateway(gateway, child);
    oldUpgrade = await openUpgrade(gatewayPort);
    assert.match(oldUpgrade.received, /old-connected/);

    const heldResponse = fetch(gateway + '/api/v1/universe/status?hold=1').then((response) =>
      response.json(),
    );
    await heldRequestSeen;

    const sha = 'a'.repeat(40);
    writeFileSync(
      routePending,
      `${JSON.stringify({
        schemaVersion: 'universe-overlay-route-v1',
        slot: 'candidate',
        origin: `http://127.0.0.1:${candidatePort}`,
        releaseSha: sha,
        portfolioV2: true,
      })}\n`,
    );
    renameSync(routePending, routeFile);

    const newResponse = await fetch(gateway + '/api/v1/universe/status').then((response) =>
      response.json(),
    );
    assert.equal(newResponse.upstream, 'candidate');
    candidateUpgrade = await openUpgrade(gatewayPort);
    assert.match(candidateUpgrade.received, /candidate-connected/);

    const oldStillOpen = waitForText(oldUpgrade.socket, 'old-still-serving');
    for (const socket of oldSockets) socket.write('old-still-serving\n');
    await oldStillOpen;
    releaseHeldRequest();
    assert.equal((await heldResponse).upstream, 'old');
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${childOutput}`);
  } finally {
    releaseHeldRequest?.();
    oldUpgrade?.socket.destroy();
    candidateUpgrade?.socket.destroy();
    for (const socket of oldSockets) socket.destroy();
    for (const socket of candidateSockets) socket.destroy();
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolveExit) => child.once('exit', resolveExit));
    }
    await Promise.all([close(old), close(candidate)]);
    rmSync(directory, { recursive: true, force: true });
  }
});
