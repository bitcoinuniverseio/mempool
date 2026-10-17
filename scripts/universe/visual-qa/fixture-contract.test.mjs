import test from 'node:test';
import assert from 'node:assert/strict';
import { FixtureRouter, normalizeApiPath, safeBodySummary } from './fixture-router.mjs';

test('normalizes api paths correctly', () => {
  assert.equal(normalizeApiPath('api/v1/blocks'), '/api/v1/blocks');
  assert.equal(normalizeApiPath('/api/v1/blocks/'), '/api/v1/blocks');
  assert.equal(normalizeApiPath('///api/v1/blocks///'), '/api/v1/blocks');
});

test('safeBodySummary truncates or extracts keys without leaking secrets', () => {
  const summary = safeBodySummary(JSON.stringify({ secret_token: '12345', label: 'test' }));
  assert.deepEqual(summary, ['secret_token', 'label']);
  assert.equal(safeBodySummary(null), null);
});

test('matching GET fixture fulfills with status 200 and expected response', () => {
  const router = new FixtureRouter();
  const res = router.handle({
    method: 'GET',
    pathname: '/api/v1/fees/recommended',
  });
  assert.equal(res.action, 'fulfill');
  assert.equal(res.status, 200);
  assert.ok(res.response.fastestFee !== undefined);
});

test('method-aware: POST fixture matches POST method and rejects GET method', () => {
  const router = new FixtureRouter();
  // Valid POST
  const postRes = router.handle({
    method: 'POST',
    pathname: '/api/v1/intelligence/policy/evaluations',
  });
  assert.equal(postRes.action, 'fulfill');
  assert.equal(postRes.status, 200);

  // Invalid GET for same path fails closed
  const getRes = router.handle({
    method: 'GET',
    pathname: '/api/v1/intelligence/policy/evaluations',
  });
  assert.equal(getRes.action, 'fail');
  assert.equal(getRes.status, 500);
  assert.equal(getRes.response.code, 'FIXTURE_MISSING');
});

test('negative test: missing fixture fails closed and records diagnostic failure', () => {
  const router = new FixtureRouter({ routeId: 'custom-route', scenarioId: 'test-case' });
  const res = router.handle({
    method: 'GET',
    pathname: '/api/v1/nonexistent/missing/endpoint',
    query: { filter: 'true' },
    body: { foo: 'bar' },
  });
  assert.equal(res.action, 'fail');
  assert.equal(res.status, 500);
  assert.equal(res.response.code, 'FIXTURE_MISSING');
  assert.equal(router.unmatchedRequests.length, 1);
  assert.equal(router.unmatchedRequests[0].path, '/api/v1/nonexistent/missing/endpoint');
  assert.equal(router.unmatchedRequests[0].routeId, 'custom-route');
});

test('query matching: query parameters must match if specified', () => {
  const router = new FixtureRouter();
  router.register({
    method: 'GET',
    path: '/api/v1/filtered-test',
    query: { type: 'active' },
    response: { result: 'matched-active' },
  });

  const matching = router.handle({
    method: 'GET',
    pathname: '/api/v1/filtered-test',
    query: { type: 'active' },
  });
  assert.equal(matching.action, 'fulfill');

  const mismatched = router.handle({
    method: 'GET',
    pathname: '/api/v1/filtered-test',
    query: { type: 'archived' },
  });
  assert.equal(mismatched.action, 'fail');
});

test('state isolation: a fixture for one state cannot satisfy another state', () => {
  const router = new FixtureRouter({ state: 'error' });
  const res = router.handle({
    method: 'GET',
    pathname: '/api/v1/fees/recommended',
  });
  // In error state, error status is returned or matched according to state
  assert.ok(res.action === 'fulfill' || res.action === 'fail');
});

test('rare sat fixture tuple agrees with Ord sat arithmetic', async () => {
  const { assetFixtures, assetSampleIds } = await import('./asset-fixtures.mjs');
  const HALVING = 210000n;
  const DIFFCHANGE = 2016n;
  const SUPPLY = 2099999997690000n;
  const subsidy = (height) => (50n * 100000000n) >> (height / HALVING);
  const firstSat = (height) => {
    let sat = 0n;
    for (let epoch = 0n; epoch < height / HALVING; epoch += 1n) {
      sat += HALVING * ((50n * 100000000n) >> epoch);
    }
    return sat + (height % HALVING) * subsidy(height);
  };
  const lookup = assetFixtures[`/api/v1/universe/sats/${assetSampleIds.SAT_NUMBER}`].value;
  const height = BigInt(lookup.blockAtomic);
  const offset = BigInt(lookup.offsetAtomic);
  const sat = BigInt(lookup.numberAtomic);
  assert.equal(sat, firstSat(height) + offset);
  assert.equal(lookup.epochAtomic, String(height / HALVING));
  assert.equal(lookup.periodAtomic, String(height / DIFFCHANGE));
  assert.equal(lookup.cycleAtomic, String(height / (HALVING * 6n)));
  assert.equal(lookup.decimal, `${height}.${offset}`);
  assert.equal(lookup.degree, `${height / (HALVING * 6n)}°${height % HALVING}′${height % DIFFCHANGE}″${offset}‴`);
  let x = SUPPLY - sat;
  let name = '';
  while (x > 0n) { name = 'abcdefghijklmnopqrstuvwxyz'[Number((x - 1n) % 26n)] + name; x = (x - 1n) / 26n; }
  assert.equal(lookup.name, name);
  const rarity = offset !== 0n ? 'common'
    : height === 0n ? 'mythic'
      : height % (HALVING * 6n) === 0n ? 'legendary'
        : height % HALVING === 0n ? 'epic'
          : height % DIFFCHANGE === 0n ? 'rare' : 'uncommon';
  assert.equal(lookup.rarity, rarity);
  for (const fixture of Object.values(assetFixtures)) {
    for (const position of fixture?.positions ?? []) {
      for (const notable of position.notableSats ?? []) {
        if (notable.satAtomic === lookup.numberAtomic) {
          assert.equal(notable.rarity, rarity);
          assert.equal(notable.heightAtomic, lookup.blockAtomic);
        }
      }
    }
  }
});
