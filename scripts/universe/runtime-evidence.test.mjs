import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectRuntimeEvidence } from './runtime-evidence.mjs';

const HASH = 'a'.repeat(64);
const NOW = '2026-10-03T12:00:00Z';
function fixture() {
  const config = { chain: 'bitcoin', network: 'signet', genesis: HASH, artifactSha256: HASH,
    configurationSha256: HASH, schemaVersion: 113, schemaSha256: HASH, databaseNamespace: 'qualification_signet',
    backendRevision: 'backend-fixture-v1', nodeRevision: 'core-fixture-v1', maximumLag: 2,
    maxIdentityAgeMs: 60000, signetChallengeSha256: createHash('sha256').update(Buffer.from('51', 'hex')).digest('hex'),
    authorities: [{ id: 'owned-indexer', revision: 'indexer-fixture-v1' }] };
  const state = revision => ({ chain: 'bitcoin', network: 'signet', genesis: HASH, signetChallenge: '51',
    observedAt: NOW, revision, version: '30.0', height: 10, blockHash: HASH,
    rpcPassword: 'secret-must-never-escape', arbitraryWallet: { seed: 'secret-must-never-escape' } });
  const nodeState = state(config.nodeRevision);
  const authorityState = state(config.authorities[0].revision);
  const providers = {
    backend: { identity: async () => ({ ...config, observedAt: NOW, revision: config.backendRevision, rpcPassword: 'secret-must-never-escape' }) },
    database: { identity: async () => ({ namespace: config.databaseNamespace, observedAt: NOW, schemaVersion: 113, schemaSha256: HASH, version: '8.4.0', password: 'secret-must-never-escape' }) },
    node: { identity: async () => ({ ...nodeState }), blockHash: async () => HASH },
    authorities: { 'owned-indexer': { identity: async () => ({ ...authorityState }), blockHash: async () => HASH } },
  };
  return { config, providers, nodeState, authorityState };
}
const collect = f => collectRuntimeEvidence(f.config, f.providers, { now: () => new Date(NOW), timeoutMs: 100 });

test('allowlisted identity proof binds a common checkpoint without claiming functional acceptance', async () => {
  const report = await collect(fixture());
  assert.equal(report.status, 'IDENTITY VERIFIED');
  assert.equal(report.functionalAcceptance, false);
  assert.deepEqual(report.commonCheckpoint, { heightAtomic: '10', blockHash: HASH });
  assert.doesNotMatch(JSON.stringify(report), /secret-must-never-escape|rpcPassword|arbitraryWallet/);
});
test('two Signets sharing genesis still need the exact challenge', async () => {
  const f = fixture(); f.authorityState.signetChallenge = '52';
  assert.deepEqual((await collect(f)).failures, ['owned-indexer:signet-challenge']);
});
test('wrong chain, stale identity, and lag fail independently', async () => {
  for (const [field, value, reason] of [['chain', 'dogecoin', 'network-identity'],
    ['observedAt', '2026-10-02T12:00:00Z', 'stale-or-malformed-identity'], ['height', 1, 'lag']]) {
    const f = fixture(); f.authorityState[field] = value;
    assert.ok((await collect(f)).failures.some(code => code.endsWith(reason)));
  }
});
test('equal heights on a fork cannot be called a common checkpoint', async () => {
  const f = fixture(); f.providers.authorities['owned-indexer'].blockHash = async () => 'b'.repeat(64);
  assert.deepEqual((await collect(f)).failures, ['checkpoint:fork']);
});
test('moving checkpoint retries boundedly then refuses unstable evidence', async () => {
  const f = fixture(); let calls = 0;
  f.providers.node.identity = async () => ({ ...f.nodeState, blockHash: (++calls % 2 ? HASH : 'b'.repeat(64)) });
  const report = await collect(f);
  assert.deepEqual(report.failures, ['checkpoint:unstable']);
  assert.equal(calls, 6);
});
test('permission errors and deadlines expose no provider secrets and abort work', async () => {
  const denied = fixture(); denied.providers.node.identity = async () => { throw Error('secret-must-never-escape'); };
  const report = await collect(denied);
  assert.deepEqual(report.failures, ['provider:permission-transport-or-deadline']);
  assert.doesNotMatch(JSON.stringify(report), /secret-must-never-escape/);
  const stuck = fixture(); let aborted = false;
  stuck.providers.node.identity = async ({ signal }) => new Promise(() => signal.addEventListener('abort', () => { aborted = true; }));
  assert.equal((await collect(stuck)).status, 'BLOCKED');
  assert.equal(aborted, true);
});
test('wrong backend/database candidate bindings are blocked', async () => {
  const f = fixture(); f.providers.database.identity = async () => ({ namespace: 'production', schemaVersion: 113, schemaSha256: HASH, version: '8.4.0' });
  assert.deepEqual((await collect(f)).failures, ['database:binding']);
});

test('unavailable backend and database do not erase separately observed node and indexer evidence', async () => {
  const f = fixture();
  f.providers.backend.identity = async () => { throw Error('secret-must-never-escape'); };
  f.providers.database.identity = async () => { throw Error('secret-must-never-escape'); };
  const report = await collect(f);
  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(report.failures, ['backend:permission-transport-or-deadline', 'database:permission-transport-or-deadline']);
  assert.equal(report.components.length, 2);
  assert.deepEqual(report.commonCheckpoint, { heightAtomic: '10', blockHash: HASH });
  assert.doesNotMatch(JSON.stringify(report), /secret-must-never-escape/);
});
