import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const list = value => Array.isArray(value) && value.length > 0 && value.every(nonempty);

/** Semantic review joins source candidates to independently testable operations.
 * This is a successor, never an in-place rewrite of historical acceptance.
 * Review must identify actual method/role/context/contracts/lifecycle and source proof.
 * Neither a complete mapping nor component tests constitute functional acceptance.
 */
export function reconcileOperations(historical, review, readProof) {
  assert.equal(historical.operationDenominatorReconciled, false);
  assert(Array.isArray(historical.rows));
  assert.equal(new Set(historical.rows.map(r => r.id)).size, historical.rows.length, 'Historical candidate IDs repeat');
  assert.equal(review.schemaVersion, 'universe-semantic-operation-review-v1');
  assert(Array.isArray(review.operations) && Array.isArray(review.mappings));
  const candidateIds = new Set(historical.rows.map(r => r.id));
  const operations = new Map();
  const meanings = new Set();
  const proof = refs => {
    assert(Array.isArray(refs) && refs.length > 0, 'Source proof is required');
    for (const ref of refs) {
      assert(nonempty(ref.path) && /^[0-9a-f]{64}$/.test(ref.sha256), 'Source proof binding is incomplete');
      assert.equal(sha256(readProof(ref.path)), ref.sha256, `Source proof drift: ${ref.path}`);
    }
  };
  for (const operation of review.operations) {
    for (const field of ['id', 'entryPoint', 'method', 'role', 'chain', 'network', 'inputContract', 'outputContract',
      'lifecycle', 'specificationRevision', 'owner', 'expectedResult']) assert(nonempty(operation[field]), `Missing operation ${field}`);
    for (const field of ['prerequisites', 'inputs', 'execution', 'assertions']) assert(list(operation[field]), `Missing operation ${field}`);
    assert(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'WS', 'UI', 'WORKER'].includes(operation.method), 'Unknown operation method');
    assert(!['unverified', 'unresolved', 'unknown'].includes(operation.network), 'Operation network is unresolved');
    assert(!['unverified', 'unresolved', 'unknown'].includes(operation.role), 'Operation role is unresolved');
    assert(!operations.has(operation.id), 'Duplicate operation ID');
    const meaning = JSON.stringify(['entryPoint', 'method', 'role', 'chain', 'network', 'inputContract', 'outputContract', 'lifecycle']
      .map(field => operation[field]));
    assert(!meanings.has(meaning), 'Two IDs describe the same operation; reconcile their candidates');
    meanings.add(meaning);
    proof(operation.sources);
    operations.set(operation.id, { ...structuredClone(operation), status: 'NOT TESTED', actualResult: null,
      evidence: [], environment: null, revision: null, ranAt: null });
  }
  const mappings = new Map();
  for (const mapping of review.mappings) {
    assert(candidateIds.has(mapping.candidateId), 'Mapping names an unknown historical candidate');
    assert(!mappings.has(mapping.candidateId), 'Duplicate candidate mapping');
    assert(nonempty(mapping.reason), 'Mapping has no semantic rationale');
    proof(mapping.sources);
    const linked = mapping.operationIds;
    if (mapping.excluded === true) {
      assert(Array.isArray(linked) && linked.length === 0, 'An exclusion cannot map operations');
      assert(nonempty(mapping.exclusionJustification), 'Exclusion has no specification justification');
    } else {
      assert(list(linked) && new Set(linked).size === linked.length, 'Mapping needs distinct operation IDs');
      for (const id of linked) assert(operations.has(id), `Mapping names unknown operation ${id}`);
    }
    mappings.set(mapping.candidateId, structuredClone(mapping));
  }
  const unused = [...operations.keys()].filter(id => ![...mappings.values()].some(m => m.operationIds.includes(id)));
  assert.equal(unused.length, 0, 'Operation has no source candidate lineage');
  const unresolved = [...candidateIds].filter(id => !mappings.has(id));
  const scopeBlockers = review.scopeBlockers ?? [];
  assert(Array.isArray(scopeBlockers));
  assert.equal(new Set(scopeBlockers.map(row => row.id)).size, scopeBlockers.length, 'Duplicate current-source scope blocker');
  for (const row of scopeBlockers) {
    assert(nonempty(row.id) && nonempty(row.reason), 'Current-source scope blocker needs provenance and reason');
    proof(row.sources);
  }
  const reconciled = unresolved.length === 0 && scopeBlockers.length === 0;
  return {
    schemaVersion: 'universe-reconciled-operations-v1', status: 'FUNCTIONAL NO-GO',
    historicalSha256: sha256(Buffer.from(JSON.stringify(historical))),
    historicalHashEncoding: 'UTF-8 JSON.stringify parsed document; CLI separately binds original file bytes',
    historical: structuredClone(historical),
    countingPolicy: 'Reviewed semantic operations only; source candidates and component checks are separate. No percentage while unresolved.',
    operationDenominatorReconciled: reconciled,
    operationDenominator: reconciled ? operations.size : null,
    mappings: [...mappings.values()], operations: [...operations.values()],
    blockers: [...unresolved.map(id => ({ candidateId: id, reason: 'Actual method, role, context, contract and lifecycle have not been semantically mapped or evidenced as excluded.' })),
      ...scopeBlockers.map(row => ({ ...structuredClone(row), kind: 'current-source-inventory-expansion' }))],
    original243RowEvidence: 'Not recovered; historical source candidates retained without inventing the absent original bundle.',
    functionalAcceptance: false,
  };
}

export function rootedProofReader(root) {
  const base = realpathSync(resolve(root));
  return path => {
    assert(!isAbsolute(path) && !/^[a-zA-Z]:/.test(path) && !path.split(/[\\/]/).includes('..'), 'Source proof escapes evidence root');
    const target = realpathSync(resolve(base, path));
    const local = relative(base, target);
    assert(local && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local), 'Source proof escapes evidence root');
    return readFileSync(target);
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, 'Usage: reconciled-operations.mjs HISTORICAL_JSON REVIEW_JSON PROOF_ROOT NEW_OUTPUT_JSON');
  const historicalBytes = readFileSync(resolve(args[0]));
  const historical = JSON.parse(historicalBytes.toString('utf8'));
  const review = JSON.parse(readFileSync(resolve(args[1]), 'utf8'));
  const successor = reconcileOperations(historical, review, rootedProofReader(args[2]));
  successor.historicalArtifactSha256 = sha256(historicalBytes);
  writeFileSync(resolve(args[3]), JSON.stringify(successor, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: successor.status, unresolved: successor.blockers.length,
    operationDenominator: successor.operationDenominator, functionalAcceptance: false }));
}
