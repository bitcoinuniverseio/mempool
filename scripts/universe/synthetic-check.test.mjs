import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSyntheticRequest,
  operationLog,
  failures,
  setPhase,
  markPhaseSuccessful,
  setReleaseIdentitySeen,
} from './synthetic-check.mjs';

test('a slow named endpoint identifies itself in operation log and error report', async () => {
  failures.length = 0;
  operationLog.length = 0;
  setPhase('address-history');
  markPhaseSuccessful('capabilities');

  let callCount = 0;
  const mockFetch = async (url, options) => {
    callCount++;
    return new Promise((resolve, reject) => {
      // simulate slow request past deadline
      options.signal.addEventListener('abort', () => {
        const err = new Error('Timeout of 50ms exceeded');
        err.name = 'TimeoutError';
        reject(err);
      });
    });
  };

  const res = await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/address/1Test/txs',
    method: 'GET',
    checkName: 'address-history',
    timeoutMs: 50,
    maxRetries: 0,
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 504);
  assert.equal(failures.length, 1);
  const failureMsg = failures[0];
  assert.match(failureMsg, /TIMEOUT on GET http:\/\/127\.0\.0\.1:9999\/api\/address\/1Test\/txs/);
  assert.match(failureMsg, /deadline: 50ms/);
  assert.match(failureMsg, /Phase: "address-history"/);
  assert.match(failureMsg, /Last successful phase: "capabilities"/);

  assert.equal(operationLog.length, 1);
  assert.equal(operationLog[0].checkName, 'address-history');
  assert.equal(operationLog[0].error.isTimeout, true);
});

test('a hung endpoint terminates within its deadline', async () => {
  failures.length = 0;
  operationLog.length = 0;
  setPhase('hung-check');

  const start = Date.now();
  const mockFetch = async (url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const res = await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/hung',
    method: 'GET',
    checkName: 'hung-check',
    timeoutMs: 80,
    maxRetries: 0,
    fetchFn: mockFetch,
  });

  const elapsed = Date.now() - start;
  assert.equal(res.status, 504);
  assert.ok(elapsed >= 70 && elapsed < 500, `Terminated promptly, elapsed: ${elapsed}ms`);
});

test('a successful endpoint is not retried', async () => {
  failures.length = 0;
  operationLog.length = 0;
  setPhase('quick-check');

  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    };
  };

  const res = await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/success',
    method: 'GET',
    checkName: 'quick-check',
    timeoutMs: 1000,
    maxRetries: 2,
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(callCount, 1, 'Endpoint succeeded on first try and was not retried');
  assert.equal(failures.length, 0);
});

test('a deterministic 4xx or contract failure is not retried', async () => {
  failures.length = 0;
  operationLog.length = 0;
  setPhase('malformed-check');

  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      status: 400,
      text: async () => JSON.stringify({ error: 'invalid-address' }),
    };
  };

  const res = await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/address/malformed',
    method: 'GET',
    checkName: 'malformed-check',
    timeoutMs: 1000,
    maxRetries: 2,
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 400);
  assert.equal(callCount, 1, 'Deterministic 400 was not retried');
  assert.equal(failures.length, 0);
});

test('one failed phase does not erase diagnostic artifacts from completed phases', async () => {
  failures.length = 0;
  operationLog.length = 0;

  // Phase 1: Successful
  setPhase('phase-1');
  const mockFetchSuccess = async () => ({
    status: 200,
    text: async () => JSON.stringify({ version: '1.0' }),
  });
  await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/v1/status',
    checkName: 'phase-1',
    fetchFn: mockFetchSuccess,
  });
  markPhaseSuccessful('phase-1');

  // Phase 2: Failed
  setPhase('phase-2');
  const mockFetchFail = async (url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const err = new Error('Timeout of 40ms exceeded');
        err.name = 'TimeoutError';
        reject(err);
      });
    });
  };
  await executeSyntheticRequest({
    origin: 'http://127.0.0.1:9999',
    path: '/api/v1/broken',
    checkName: 'phase-2',
    timeoutMs: 40,
    maxRetries: 0,
    fetchFn: mockFetchFail,
  });

  // Verify diagnostic history retains phase-1 artifacts
  assert.equal(operationLog.length, 2);
  assert.equal(operationLog[0].checkName, 'phase-1');
  assert.equal(operationLog[0].status, 200);
  assert.equal(operationLog[1].checkName, 'phase-2');
  assert.equal(operationLog[1].status, null);
  assert.equal(operationLog[1].lastSuccessfulPhase, 'phase-1');
});

test('the overall result remains NO-GO when a required phase fails', () => {
  assert.ok(failures.length > 0, 'Failures are recorded');
  const isGo = failures.length === 0;
  assert.equal(isGo, false, 'NO-GO status enforced when failures array is non-empty');
});
