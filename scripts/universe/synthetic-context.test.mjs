import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProtocolsAreTruthful, failures, notes } from './synthetic-check.mjs';

const protocol = (id, chain, networks = ['mainnet']) => ({ id, chain, networks,
  indexerAuthority: 'shared-authority', releaseStatus: 'VERIFIED READ ONLY' });
const source = (id, chain, network = 'mainnet', changes = {}) => ({
  chain, network, authorityId: 'shared-authority', protocols: [id], status: 'ready', ready: true,
  checkpoint: { chain, network, heightAtomic: '10' }, ...changes,
});
async function check(protocols, sources) {
  failures.length = 0; notes.length = 0;
  const urls = [];
  await checkProtocolsAreTruthful(async (url) => {
    urls.push(url);
    if (url.endsWith('/protocols')) return { status: 200, body: { protocols } };
    const context = new URL(url, 'http://localhost').searchParams;
    const rows = sources[`${context.get('chain')}:${context.get('network')}`];
    return rows ? { status: 200, body: { sources: rows } } : { status: 400, body: {} };
  });
  return urls;
}

test('BTC and ZEC sharing authority IDs use distinct explicit snapshots', async () => {
  const urls = await check([protocol('btc', 'bitcoin'), protocol('zec', 'zcash')], {
    'bitcoin:mainnet': [source('btc', 'bitcoin')], 'zcash:mainnet': [source('zec', 'zcash')],
  });
  assert.deepEqual(failures, []);
  assert.deepEqual(urls, ['/api/v1/universe/protocols',
    '/api/v1/universe/sources?chain=bitcoin&network=mainnet',
    '/api/v1/universe/sources?chain=zcash&network=mainnet']);
  assert.ok(notes.every((note) => note.includes('source telemetry only')));
});

test('a shared authority cannot validate another network or protocol', async () => {
  await check([protocol('btc', 'bitcoin', ['mainnet', 'signet'])], {
    'bitcoin:mainnet': [source('btc', 'bitcoin')],
    'bitcoin:signet': [source('btc', 'bitcoin')],
  });
  assert.ok(failures.some((failure) => failure.includes('mismatched source context')));
  await check([protocol('btc', 'bitcoin')], { 'bitcoin:mainnet': [source('other', 'bitcoin')] });
  assert.match(failures.join('\n'), /not claimed/);
});

for (const state of ['unconfigured', 'unreachable', 'stale', 'degraded', 'unknown']) {
  test(`${state} telemetry cannot pass availability`, async () => {
    await check([protocol('btc', 'bitcoin')], { 'bitcoin:mainnet': [source('btc', 'bitcoin', 'mainnet', { status: state })] });
    assert.match(failures.join('\n'), new RegExp(state));
    assert.equal(notes.length, 0);
  });
}

test('pending, absent, malformed, unsupported, and checkpoint-less evidence fail', async () => {
  await check([protocol('btc', 'bitcoin')], { 'bitcoin:mainnet': [source('btc', 'bitcoin', 'mainnet', { measurementPending: true })] });
  assert.match(failures.join('\n'), /measurement-pending/);
  await check([protocol('btc', 'bitcoin')], { 'bitcoin:mainnet': [] });
  assert.match(failures.join('\n'), /absent/);
  await check([protocol('btc', 'bitcoin', [])], {});
  assert.match(failures.join('\n'), /malformed/);
  await check([protocol('btc', 'bitcoin', ['unsupported'])], {});
  assert.match(failures.join('\n'), /HTTP 400/);
  await check([protocol('btc', 'bitcoin')], { 'bitcoin:mainnet': [source('btc', 'bitcoin', 'mainnet', { checkpoint: null })] });
  assert.match(failures.join('\n'), /no matching checkpoint/);
});

test('malformed array entries report failures without hiding remaining contexts', async () => {
  const urls = await check([null, 'invalid', [], {}, protocol('btc', 'bitcoin'), protocol('zec', 'zcash')], {
    'bitcoin:mainnet': [null, 'invalid', [], {}, source('btc', 'bitcoin')],
    'zcash:mainnet': [source('zec', 'zcash')],
  });
  assert.equal(failures.filter((failure) => failure.includes('malformed protocol identity')).length, 4);
  assert.equal(failures.filter((failure) => failure.includes('malformed source identity')).length, 4);
  assert.equal(urls.length, 3);
  assert.ok(notes.some((note) => note.includes('protocols:zcash:mainnet')));
});
