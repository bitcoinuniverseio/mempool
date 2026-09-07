import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { executeSyntheticRequest, operationLog, failures } from './synthetic-check.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

for (const trickle of [false, true]) {
  test(`whole response deadline aborts ${trickle ? 'trickling' : 'stalled'} body after real headers`, async () => {
    let closed = false;
    await withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
      const interval = trickle ? setInterval(() => res.write(' '), 15) : null;
      res.on('close', () => { closed = true; clearInterval(interval); });
    }, async (origin) => {
      const start = performance.now();
      const result = await executeSyntheticRequest({ origin, path: '/', timeoutMs: 150 });
      assert.equal(result.status, null);
      assert.equal(result.httpStatus, 200);
      assert.equal(result.transportError.isTimeout, true);
      assert.equal(result.transportError.stage, 'body');
      assert.ok(performance.now() - start < 650);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(closed, true, 'aborted body releases the connection');
    });
  });
}

test('actual HTTP 504 is preserved and retries share one total budget', async () => {
  let count = 0;
  await withServer((req, res) => {
    count++; res.writeHead(504); res.end('{"error":"gateway-timeout"}');
  }, async (origin) => {
    const result = await executeSyntheticRequest({ origin, path: '/', timeoutMs: 180, maxRetries: 2 });
    assert.equal(result.status, 504);
    assert.equal(result.httpStatus, 504);
    assert.equal(result.transportError, null);
    assert.ok(count <= 2);
  });
});

test('POST timeout cannot retry a write', async () => {
  let count = 0;
  await withServer((req, res) => { count++; res.writeHead(200); res.flushHeaders(); }, async (origin) => {
    const result = await executeSyntheticRequest({ origin, path: '/', method: 'POST', timeoutMs: 80, maxRetries: 2 });
    assert.equal(result.transportError.isTimeout, true);
    assert.equal(count, 1);
  });
});

test('connection failure has no invented gateway status and clears its timer', async () => {
  let signal;
  const result = await executeSyntheticRequest({ path: '/', timeoutMs: 30,
    fetchFn: async (url, options) => { signal = options.signal; throw new TypeError('connection refused'); } });
  assert.equal(result.status, null);
  assert.equal(result.httpStatus, null);
  assert.equal(result.transportError.isTimeout, false);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(signal.aborted, false, 'failure timer was cleared');
});

test('malformed JSON remains raw text, and complete response duration includes body consumption', async () => {
  await withServer((req, res) => {
    res.writeHead(200); res.write('not ');
    setTimeout(() => res.end('JSON'), 60);
  }, async (origin) => {
    operationLog.length = 0; failures.length = 0;
    const result = await executeSyntheticRequest({ origin, path: '/', timeoutMs: 500 });
    assert.equal(result.status, 200);
    assert.equal(result.body, null);
    assert.equal(result.text, 'not JSON');
    assert.ok(operationLog[0].durationMs >= 50);
    assert.equal(failures.length, 0);
  });
});

test('oversized streamed bodies are cancelled within the smoke memory bound', async () => {
  await withServer((req, res) => { res.writeHead(200); res.end(Buffer.alloc(17 * 1024 * 1024)); }, async (origin) => {
    const result = await executeSyntheticRequest({ origin, path: '/', timeoutMs: 2000 });
    assert.equal(result.status, null);
    assert.match(result.transportError.message, /16 MiB/);
    assert.equal(result.httpStatus, 200);
  });
});
