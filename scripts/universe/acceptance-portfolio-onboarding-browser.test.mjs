import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { assertOnboardingDefinition, portfolioOnboardingFixtures } from './acceptance-portfolio-onboarding-browser.mjs';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const fixtures = portfolioOnboardingFixtures();
const record = fixture => ({ name: 'Local public fixture', archived: false,
  accounts: fixture.accounts.map((account, index) => ({ ...structuredClone(account), id: 'public-account-' + index })) });

test('fixtures contain checksummed public inputs for every offered local entry format', () => {
  const { createBase58check } = require('@scure/base');
  const { HDKey } = require('@scure/bip32');
  const { Address, NETWORK } = require('@scure/btc-signer');
  const { checksumVerify } = require('utxo-descriptors');
  const codec = createBase58check(bytes => createHash('sha256').update(bytes).digest());
  assert.deepEqual(fixtures.map(fixture => fixture.id), ['P01', 'P02-XPUB', 'P02-YPUB', 'P02-ZPUB', 'P03', 'P04', 'P05']);
  const extended = fixtures.filter(fixture => fixture.id.startsWith('P02'));
  const payloads = extended.map(fixture => codec.decode(fixture.material));
  for (const [index, payload] of payloads.entries()) {
    assert.equal(payload.length, 78);
    assert.deepEqual(payload.slice(4), payloads[0].slice(4));
    const version = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
    const key = HDKey.fromExtendedKey(extended[index].material, { public: version, private: 0 });
    assert.equal(key.privateKey, null);
    assert.equal(key.publicKey.length, 33);
  }
  assert.match(extended[0].material, /^xpub/);
  assert.match(extended[1].material, /^ypub/);
  assert.match(extended[2].material, /^zpub/);
  const [expression, checksum] = fixtures.find(fixture => fixture.id === 'P03').material.split('#');
  assert.equal(checksumVerify(expression, checksum), true);
  for (const fixture of fixtures) for (const account of fixture.accounts) {
    for (const address of account.addresses || []) assert.ok(Address(NETWORK).decode(address));
  }
  assert.match(fixtures.find(fixture => fixture.id === 'P04').material, /^address,chain,network,label,group\n/);
  assert.equal(JSON.parse(fixtures.find(fixture => fixture.id === 'P05').material).length, 2);
});

test('downloaded definition checker refuses missing, extra, relabeled or wrong-network accounts', () => {
  for (const fixture of fixtures) {
    const portfolio = record(fixture);
    const result = assertOnboardingDefinition(portfolio, fixture, portfolio.name);
    assert.equal(result.accountCount, fixture.accounts.length);
    for (const change of [
      value => { value.accounts = []; },
      value => { value.accounts.push({ ...value.accounts[0], id: 'unexpected-account' }); },
      value => { value.accounts[0].network = 'testnet'; },
      value => { value.accounts[0].name = 'lost label'; },
      value => { value.archived = true; },
    ]) {
      const changed = structuredClone(portfolio);
      change(changed);
      assert.throws(() => assertOnboardingDefinition(changed, fixture, portfolio.name));
    }
  }
});

test('downloaded definition checker refuses altered public material and script semantics', () => {
  for (const fixture of fixtures) {
    const portfolio = record(fixture);
    if (portfolio.accounts[0].xpub) portfolio.accounts[0].xpub.script = 'p2tr';
    else if (portfolio.accounts[0].descriptor) portfolio.accounts[0].descriptor.value += 'changed';
    else portfolio.accounts[0].addresses = ['changed-address'];
    assert.throws(() => assertOnboardingDefinition(portfolio, fixture, portfolio.name));
  }
  assert.throws(() => assertOnboardingDefinition(undefined, fixtures[0], 'missing'));
});
