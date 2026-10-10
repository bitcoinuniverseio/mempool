import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const networks = { bitcoin: ['signet', 'testnet', 'testnet4'], dogecoin: ['testnet'], zcash: ['testnet'], fractal: ['testnet'], liquid: ['testnet'], local: ['offline'] };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const operationContextKey = row => JSON.stringify([row.protocol, row.operation, row.variant]);
export function acceptanceContextsDigest(candidate) {
  return hash(Buffer.from(JSON.stringify({
    contexts: [...candidate.contexts].sort((a, b) => order(a.id, b.id)),
    operationContexts: [...candidate.operationContexts].sort((a, b) => order(operationContextKey(a), operationContextKey(b))),
    applicationContexts: candidate.applicationContexts.map(row => ({ ...row, contextIds: [...row.contextIds].sort(order) })).sort((a, b) => order(a.operationId, b.operationId)),
  })));
}

/** Explicit v2 profiles: names alone never identify public/private Signet. */
export function validateAcceptanceContexts(candidate, readProof, deploymentNetwork) {
  assert(Array.isArray(candidate.contexts) && candidate.contexts.length > 0, 'Missing acceptance contexts');
  assert(Array.isArray(candidate.operationContexts) && candidate.operationContexts.length > 0, 'Missing protocol context assignments');
  assert(Array.isArray(candidate.applicationContexts) && candidate.applicationContexts.length > 0, 'Missing application context assignments');
  const contexts = new Map();
  const read = file => {
    assert(text(file?.path) && sha(file.sha256) && file.path.startsWith('docs/') && !file.path.includes('\\') && !file.path.split('/').includes('..'), 'Unsafe context evidence path');
    const bytes = readProof(file.path);
    assert.equal(hash(bytes), file.sha256, 'Context evidence byte drift');
    return bytes;
  };
  for (const context of candidate.contexts) {
    assert(text(context.id) && !contexts.has(context.id), 'Duplicate or missing context identity');
    assert(networks[context.chain]?.includes(context.acceptanceNetwork), 'Unsupported acceptance chain/network');
    assert(context.chain === 'local' ? context.deploymentNetwork === 'offline' : ['mainnet', ...networks[context.chain]].includes(context.deploymentNetwork), 'Unsupported deployment chain/network');
    if (deploymentNetwork && context.chain !== 'local') assert.equal(context.deploymentNetwork, deploymentNetwork, 'Wrong deployment context');
    if (context.acceptanceNetwork !== 'signet') assert(text(context.justification), 'Non-Signet context needs governing justification');
    assert(sha(context.acceptanceProfileDigest) && sha(context.deploymentConfigurationDigest), 'Missing profile/configuration commitment');
    assert.equal(context.profileProof?.sha256, context.acceptanceProfileDigest);
    const profile = JSON.parse(read(context.profileProof).toString('utf8'));
    assert.equal(profile.schemaVersion, 'universe-acceptance-chain-profile-v1');
    assert.equal(profile.chain, context.chain); assert.equal(profile.network, context.acceptanceNetwork);
    assert.equal(profile.sourceSha, candidate.sourceSha); assert.equal(profile.dependencyRevision, candidate.dependencyRevision);
    assert(candidate.specificationRevisions.includes(profile.specificationRevision), 'Profile specification drift');
    if (context.chain === 'local') {
      assert.equal(profile.kind, 'local'); assert.equal(profile.network, 'offline');
      assert.equal(profile.genesisHash, undefined); assert.equal(profile.nonGenesis, undefined);
    } else {
      assert.equal(profile.kind, 'blockchain'); assert(sha(profile.genesisHash), 'Missing genesis identity');
      assert(/^[1-9]\d*$/.test(profile.nonGenesis?.heightAtomic) && sha(profile.nonGenesis?.blockHash) && profile.nonGenesis.blockHash !== profile.genesisHash, 'Missing non-genesis identity');
      if (context.chain === 'bitcoin' && context.acceptanceNetwork === 'signet') assert(typeof profile.signetChallengeHex === 'string' && /^(?:[0-9a-f]{2})+$/.test(profile.signetChallengeHex), 'Missing Signet challenge identity');
    }
    const proof = context.configurationProof;
    assert.equal(proof?.chain, context.chain); assert.equal(proof.network, context.deploymentNetwork);
    assert.equal(proof.configurationDigest, context.deploymentConfigurationDigest); assert.equal(proof.sourceRevision, candidate.sourceSha);
    assert.equal(proof.acceptanceProfileDigest, context.acceptanceProfileDigest);
    assert(Array.isArray(proof.assertions) && proof.assertions.length > 0 && Array.isArray(proof.evidence) && proof.evidence.length > 0, 'Missing independent configuration proof');
    proof.evidence.forEach(read);
    contexts.set(context.id, context);
  }
  const assignments = new Map(), used = new Set();
  for (const row of candidate.operationContexts) {
    assert(['protocol', 'operation', 'variant'].every(key => text(row[key])) && contexts.has(row.contextId), 'Malformed protocol context assignment');
    const key = operationContextKey(row); assert(!assignments.has(key), 'Duplicate protocol context assignment'); assignments.set(key, contexts.get(row.contextId)); used.add(row.contextId);
  }
  const application = new Map();
  for (const row of candidate.applicationContexts) {
    assert(text(row.operationId) && !application.has(row.operationId) && Array.isArray(row.contextIds) && row.contextIds.length > 0 && new Set(row.contextIds).size === row.contextIds.length, 'Malformed application context assignment');
    row.contextIds.forEach(id => { assert(contexts.has(id), 'Unknown application context'); used.add(id); });
    application.set(row.operationId, row.contextIds);
  }
  assert.equal(used.size, contexts.size, 'Unassigned acceptance context');
  assert.equal(candidate.acceptanceContextsSha256, acceptanceContextsDigest(candidate), 'Context assignment digest drift');
  const binding = JSON.parse(read(candidate.contextBindingProof).toString('utf8'));
  assert.equal(binding.schemaVersion, 'universe-acceptance-context-binding-proof-v1');
  assert.equal(binding.sourceSha, candidate.sourceSha); assert.equal(binding.configurationDigest, candidate.configurationDigest);
  assert.equal(binding.acceptanceContextsSha256, candidate.acceptanceContextsSha256);
  assert(Array.isArray(binding.assertions) && binding.assertions.length > 0, 'Missing global context/configuration assertions');
  return { contexts, assignments, application };
}
