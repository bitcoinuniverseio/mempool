import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the runner's actual page-preparation block without starting a browser
// or replacing the product's fixture responses. A reset failure must reach the
// outer measurement catch before any new route can be measured.
const source = readFileSync(new URL('./mobile-check.mjs', import.meta.url), 'utf8');
const start = source.indexOf('if (page && !page.isClosed()) {');
const end = source.indexOf("measurement.phase = 'navigation';", start);
assert.ok(start >= 0 && end > start, 'mobile runner page-preparation block must be present');
const prepare = (storage) => runInNewContext(
  `(async (context, page) => { ${source.slice(start, end)} return page; })`,
  { sessionStorage: storage },
);

function pageAdapter({ closed = false, url = 'https://explorer.test/previous', evaluateError, navigationError } = {}) {
  const calls = [];
  return {
    calls,
    isClosed: () => closed,
    url: () => url,
    async evaluate(callback) {
      calls.push('evaluate');
      if (evaluateError) throw evaluateError;
      return callback();
    },
    async goto(destination) {
      calls.push(destination);
      if (navigationError) throw navigationError;
    },
  };
}

test('a reused page clears its previous route session before creating a new document', async () => {
  const session = new Map([['previous-route-result', 'cached success']]);
  const page = pageAdapter();
  const returned = await prepare({ clear: () => session.clear() })({}, page);
  assert.equal(returned, page);
  assert.equal(session.size, 0);
  assert.deepEqual(page.calls, ['evaluate', 'about:blank']);
});

for (const reason of ['session storage access denied', 'execution context was destroyed']) {
  test(`a failed reset cannot measure a subsequent route: ${reason}`, async () => {
    const error = new Error(reason);
    const page = pageAdapter({ evaluateError: error });
    await assert.rejects(prepare({ clear() {} })({}, page), (actual) => actual === error);
    assert.deepEqual(page.calls, ['evaluate'], 'must not navigate after an unverified reset');
  });
}

test('a failed new-document navigation also reaches the measurement failure handler', async () => {
  const error = new Error('navigation timed out');
  const page = pageAdapter({ navigationError: error });
  await assert.rejects(prepare({ clear() {} })({}, page), (actual) => actual === error);
});

test('a fresh blank page does not try to access storage on an opaque origin', async () => {
  const page = pageAdapter({ url: 'about:blank' });
  await prepare({ clear() { throw new Error('opaque origin'); } })({}, page);
  assert.deepEqual(page.calls, ['about:blank']);
});

test('a missing or closed page is replaced without reading its old session', async () => {
  for (const previous of [undefined, pageAdapter({ closed: true })]) {
    const fresh = pageAdapter({ url: 'about:blank' });
    let created = 0;
    const context = { async newPage() { created++; return fresh; } };
    assert.equal(await prepare({ clear() { throw new Error('old session accessed'); } })(context, previous), fresh);
    assert.equal(created, 1);
    if (previous) assert.deepEqual(previous.calls, []);
  }
});
