import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('an HTTPS authority failure stays a typed gateway failure without crashing the listener', async () => {
  // A plain loopback server deliberately cannot complete a TLS handshake.
  // The gateway must attempt TLS and remain alive when the authority fails.
  const peer = http.createServer();
  peer.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  peer.listen(0, '127.0.0.1');
  await once(peer, 'listening');
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const gatewayPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const gateway = spawn(process.execPath, ['scripts/universe/gateway.mjs'], {
    cwd: new URL('../../', import.meta.url), windowsHide: true,
    env: { ...process.env, UNIVERSE_GATEWAY_NO_LISTEN: '', UNIVERSE_GATEWAY_PORT: String(gatewayPort),
      UNIVERSE_GATEWAY_BACKEND: `https://127.0.0.1:${peer.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  gateway.stderr.on('data', chunk => { logs += chunk; });
  try {
    const port = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`gateway startup timeout: ${logs}`)), 5000);
      gateway.once('exit', code => { clearTimeout(deadline); reject(new Error(`gateway exited ${code}: ${logs}`)); });
      gateway.stdout.on('data', chunk => {
        const match = String(chunk).match(/listening on 127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(deadline); resolve(Number(match[1])); }
      });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/backend-info`, { signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'upstream-unavailable' });
    }
  } finally {
    gateway.kill();
    await new Promise(resolve => peer.close(resolve));
  }
});
