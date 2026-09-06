import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run: node --test <this file> [uses the default isolated checkout below].
// Override only the checkout through GATEWAY_TEST_REPO. All listeners use
// ephemeral loopback ports; this does not interact with the frontend listener.
const repo = process.env.GATEWAY_TEST_REPO || String.raw`D:\universe\mempool\.tmp\explorer-health-cc524f6d97b5`;
const evidenceDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(repo, 'frontend', 'package.json'));
const { WebSocket, WebSocketServer } = require('ws');
const openssl = process.env.GATEWAY_TEST_OPENSSL || String.raw`C:\Program Files\Git\usr\bin\openssl.exe`;
const checks = [];
let ports = [];

function childEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('UNIVERSE_GATEWAY_') || key.startsWith('LISTEN_') ||
        ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  ports.push(port);
  return port;
}

async function startGateway(upstream, ca) {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--dns-result-order=ipv4first', 'scripts/universe/gateway.mjs'], {
    cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({
      UNIVERSE_GATEWAY_HOST: '127.0.0.1', UNIVERSE_GATEWAY_PORT: String(port),
      UNIVERSE_GATEWAY_BACKEND: upstream, UNIVERSE_GATEWAY_OVERLAY: upstream,
      ...(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}),
    }),
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Gateway startup timeout: ${logs}`)), 8000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Gateway exited ${code}: ${logs}`)); });
    child.stdout.on('data', chunk => {
      logs += chunk;
      if (logs.includes(`listening on 127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
    });
  });
  try { await ready; } catch (error) { child.kill(); throw error; }
  return {
    port,
    async stop() {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    },
  };
}

async function websocketEcho(gatewayPort, path, expectedHost, upgrades) {
  const ws = new WebSocket(`ws://127.0.0.1:${gatewayPort}${path}`, { handshakeTimeout: 5000 });
  try {
    await once(ws, 'open');
    const text = once(ws, 'message');
    ws.send('verified TLS websocket text');
    const [textData, textBinary] = await text;
    assert.equal(textData.toString(), 'verified TLS websocket text');
    assert.equal(textBinary, false);
    const binary = once(ws, 'message');
    ws.send(Buffer.from([0, 255, 17, 31, 128]), { binary: true });
    const [binaryData, isBinary] = await binary;
    assert.deepEqual(binaryData, Buffer.from([0, 255, 17, 31, 128]));
    assert.equal(isBinary, true);
    const pong = once(ws, 'pong');
    ws.ping('probe');
    assert.equal((await pong)[0].toString(), 'probe');
    const observed = upgrades.at(-1);
    assert.equal(observed.path, path);
    assert.equal(observed.host, expectedHost);
    assert.ok(/^TLSv1\.[23]$/.test(observed.tls));
    if (expectedHost.startsWith('localhost:')) assert.equal(observed.sni, 'localhost');
    const closed = once(ws, 'close');
    ws.close(1000, 'done');
    assert.equal((await closed)[0], 1000);
    checks.push({ transport: 'WSS upstream', path, ...observed, textEcho: true, binaryEcho: true, pingPong: true, closeHandshake: true });
  } finally { ws.terminate(); }
}

test('gateway forwards successful HTTPS and WSS with scoped CA trust and rejects an untrusted CA', { timeout: 45000 }, async () => {
  const certDir = mkdtempSync(join(evidenceDir, 'gateway-test-cert-'));
  const ca = join(certDir, 'ca.pem');
  const key = join(certDir, 'server.key');
  const cert = join(certDir, 'server.pem');
  const run = (...args) => execFileSync(openssl, args, { cwd: certDir, windowsHide: true, stdio: 'pipe' });
  let peer;
  let wss;
  const sockets = new Set();
  const upgrades = [];
  let gateway;
  try {
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=Explorer temporary gateway test CA', '-keyout', 'ca.key', '-out', 'ca.pem',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-subj', '/CN=localhost',
      '-keyout', 'server.key', '-out', 'server.csr');
    writeFileSync(join(certDir, 'server.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
    run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', 'server.pem', '-days', '1', '-sha256', '-extfile', 'server.ext');

    peer = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        path: request.url, host: request.headers.host, method: request.method,
        body: Buffer.concat(chunks).toString(), tls: request.socket.getProtocol(), sni: request.socket.servername || null,
      }));
    });
    peer.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    peer.on('tlsClientError', () => {}); // Expected during the no-trust negative control.
    wss = new WebSocketServer({ noServer: true });
    peer.on('upgrade', (request, socket, head) => {
      upgrades.push({ path: request.url, host: request.headers.host, tls: socket.getProtocol(), sni: socket.servername || null });
      wss.handleUpgrade(request, socket, head, ws => {
        ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
      });
    });
    const upstreamPort = await listen(peer);

    gateway = await startGateway(`https://127.0.0.1:${upstreamPort}`);
    const noTrust = await fetch(`http://127.0.0.1:${gateway.port}/api/v1/backend-info`, { signal: AbortSignal.timeout(7000) });
    assert.equal(noTrust.status, 502);
    assert.deepEqual(await noTrust.json(), { error: 'upstream-unavailable' });
    const rejected = new WebSocket(`ws://127.0.0.1:${gateway.port}/api/v1/ws`, { handshakeTimeout: 5000 });
    const rejection = await new Promise(resolve => {
      rejected.once('error', error => resolve(error.message));
      rejected.once('open', () => resolve('UNEXPECTED_OPEN'));
    });
    rejected.terminate();
    assert.notEqual(rejection, 'UNEXPECTED_OPEN');
    assert.equal(upgrades.length, 0);
    checks.push({ transport: 'HTTPS and WSS upstream', control: 'same valid certificate without scoped CA trust', httpStatus: 502, websocketRejected: true });
    await gateway.stop();
    gateway = undefined;

    for (const hostname of ['127.0.0.1', 'localhost']) {
      const host = `${hostname}:${upstreamPort}`;
      gateway = await startGateway(`https://${host}`, ca);
      for (const path of ['/api/v1/backend-info?probe=one%20two', '/api/v1/universe/status?probe=overlay']) {
        const response = await fetch(`http://127.0.0.1:${gateway.port}${path}`, { signal: AbortSignal.timeout(7000) });
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.equal(data.path, path);
        assert.equal(data.host, host);
        assert.equal(data.method, 'GET');
        assert.ok(/^TLSv1\.[23]$/.test(data.tls));
        if (hostname === 'localhost') assert.equal(data.sni, 'localhost');
        checks.push({ transport: 'HTTPS upstream', ...data });
      }
      const post = await fetch(`http://127.0.0.1:${gateway.port}/api/v1/test-body`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"test":"body preserved"}', signal: AbortSignal.timeout(7000),
      });
      assert.equal(post.status, 200);
      const posted = await post.json();
      assert.equal(posted.method, 'POST');
      assert.equal(posted.body, '{"test":"body preserved"}');
      checks.push({ transport: 'HTTPS upstream', ...posted });
      await websocketEcho(gateway.port, '/api/v1/ws?probe=backend', host, upgrades);
      await websocketEcho(gateway.port, '/api/v1/universe/ws?probe=overlay', host, upgrades);
      await gateway.stop();
      gateway = undefined;
    }
    writeFileSync(join(evidenceDir, 'gateway-tls-success-evidence.json'), JSON.stringify({
      passed: true, recordedAt: new Date().toISOString(), repo, node: process.version,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true }).toString().trim(),
      gatewaySha256: createHash('sha256').update(readFileSync(join(repo, 'scripts/universe/gateway.mjs'))).digest('hex'),
      trust: 'NODE_EXTRA_CA_CERTS only in spawned gateway children; verification enabled; no certificate store changes',
      listenerAddress: '127.0.0.1', ephemeralPorts: ports, checks,
    }, null, 2) + '\n');
    console.log(`Verified ${checks.length} TLS transport scenarios; all test-owned listeners and certificates are cleaned in finally.`);
  } finally {
    if (gateway) await gateway.stop();
    if (wss) for (const ws of wss.clients) ws.terminate();
    for (const socket of sockets) socket.destroy();
    if (peer?.listening) await new Promise(resolve => peer.close(resolve));
    // Only the unpredictable directory created by this test can be removed.
    const safeDir = resolve(certDir);
    assert.ok(safeDir.startsWith(resolve(evidenceDir) + sep) && safeDir.includes('gateway-test-cert-'));
    rmSync(safeDir, { recursive: true, force: true });
  }
});
