import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reconcileOperations, rootedProofReader } from './reconciled-operations.mjs';

const bytes = Buffer.from('reviewed actual source');
const proof = [{ path: 'source.ts', sha256: createHash('sha256').update(bytes).digest('hex') }];
const historical = { operationDenominatorReconciled: false, rows: [{ id: 'old-A', status: 'PASS LOCAL', evidence: ['historical'] }, { id: 'old-B', status: 'BLOCKED' }] };
const operation = { id: 'owned-read', entryPoint: '/api/read', method: 'GET', role: 'public-reader',
  chain: 'bitcoin', network: 'signet', inputContract: 'query-v1', outputContract: 'response-v1', lifecycle: 'normal-read',
  specificationRevision: 'spec-v1', owner: 'backend', expectedResult: 'exact authoritative result', prerequisites: ['owned source'],
  inputs: ['known chain reference'], execution: ['read actual API'], assertions: ['match owned source'], sources: proof };
const review = () => ({ schemaVersion: 'universe-semantic-operation-review-v1', operations: [operation], mappings: [
  { candidateId: 'old-A', operationIds: ['owned-read'], reason: 'actual dispatcher and consumer refer to this same read', sources: proof },
] });
const reconcile = r => reconcileOperations(historical, r, () => bytes);

test('omitted source candidates remain blockers and keep denominator unknown', () => {
  const result = reconcile(review());
  assert.equal(result.operationDenominator, null);
  assert.equal(result.operationDenominatorReconciled, false);
  assert.equal(result.blockers[0].candidateId, 'old-B');
  assert.deepEqual(result.historical, historical);
  assert.equal(result.operations[0].status, 'NOT TESTED');
});
test('reviewed many-to-one join does not count historical candidates as operations or inherit passes', () => {
  const r = review(); r.mappings.push({ ...r.mappings[0], candidateId: 'old-B' });
  const result = reconcile(r);
  assert.equal(result.operationDenominator, 1);
  assert.equal(result.functionalAcceptance, false);
  assert.equal(result.status, 'FUNCTIONAL NO-GO');
  assert.equal(result.operations[0].status, 'NOT TESTED');
});
test('duplicate meaning and candidate mappings are refused', () => {
  const duplicate = review(); duplicate.operations.push({ ...operation, id: 'double-count' });
  assert.throws(() => reconcile(duplicate), /same operation/);
  const repeated = review(); repeated.mappings.push(repeated.mappings[0]);
  assert.throws(() => reconcile(repeated), /Duplicate candidate/);
});
test('role, network and recovery lifecycle remain separate operations', () => {
  for (const [field, value] of [['role', 'owner'], ['network', 'testnet'], ['lifecycle', 'reconnect-recovery']]) {
    const r = review(); r.operations.push({ ...operation, id: 'separate', [field]: value });
    r.mappings.push({ ...r.mappings[0], candidateId: 'old-B', operationIds: ['separate'] });
    assert.equal(reconcile(r).operationDenominator, 2);
  }
});
test('exclusion needs specification/source evidence and drift is rejected', () => {
  const r = review(); r.mappings.push({ candidateId: 'old-B', operationIds: [], excluded: true, reason: 'source-only helper', sources: proof });
  assert.throws(() => reconcile(r), /specification justification/);
  r.mappings[1].exclusionJustification = 'Helper has no independently callable role; actual caller is mapped.';
  assert.equal(reconcile(r).operationDenominator, 1);
  assert.throws(() => reconcileOperations(historical, r, () => Buffer.from('drift')), /Source proof drift/);
});
test('successor retains every actual historical candidate ID and evidence', () => {
  const actual = JSON.parse(readFileSync(new URL('../../docs/acceptance/operation-matrix-2026-09-06.json', import.meta.url), 'utf8'));
  const result = reconcileOperations(actual, { schemaVersion: 'universe-semantic-operation-review-v1', operations: [], mappings: [] }, () => bytes);
  assert.equal(result.historical.rows.length, 1617);
  assert.deepEqual(result.historical.rows, actual.rows);
  assert.equal(result.blockers.length, 1617);
  assert.equal(result.operationDenominator, null);
});
test('proof paths cannot escape root', () => {
  const read = rootedProofReader(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.throws(() => read('../outside'), /escapes/);
});

test('complete historical joins cannot hide additional current-source scope', () => {
  const r = review(); r.mappings.push({ ...r.mappings[0], candidateId: 'old-B' });
  r.scopeBlockers = [{ id: 'current-worker', reason: 'Actual current worker needs an independent operation contract', sources: proof }];
  const result = reconcile(r);
  assert.equal(result.operationDenominatorReconciled, false);
  assert.equal(result.operationDenominator, null);
  assert.equal(result.blockers[0].kind, 'current-source-inventory-expansion');
  assert.deepEqual(result.historical, historical);
});

test('new source lineage includes reviewed current operations without inventing historical evidence', () => {
  const r = review(); r.mappings.push({ ...r.mappings[0], candidateId: 'old-B' });
  r.currentSourceCandidates = [{ id: 'current:delivery-worker', reason: 'Actual new worker has no historical inventory row', sources: proof }];
  const unjoined = reconcile(r);
  assert.equal(unjoined.operationDenominator, null);
  assert.equal(unjoined.blockers[0].candidateId, 'current:delivery-worker');
  r.operations.push({ ...operation, id: 'delivery-worker', method: 'WORKER', entryPoint: 'delivery.claim', lifecycle: 'claim effect acknowledgement and restart' });
  r.mappings.push({ candidateId: 'current:delivery-worker', operationIds: ['delivery-worker'], reason: 'Current worker dispatcher and durable store define this operation', sources: proof });
  const result = reconcile(r);
  assert.equal(result.operationDenominator, 2);
  assert.deepEqual(result.historical, historical);
  assert.deepEqual(result.currentSourceCandidates, r.currentSourceCandidates);
  assert.equal(result.operations[1].status, 'NOT TESTED');
  assert.equal(result.functionalAcceptance, false);
});

test('current source additions reject duplicate IDs, absent rationale and stale source bytes', () => {
  const candidate = { id: 'current:worker', reason: 'Reviewed actual dispatcher', sources: proof };
  for (const candidates of [[candidate, candidate], [{ ...candidate, id: 'old-A' }], [{ ...candidate, reason: '' }]]) {
    const r = review(); r.currentSourceCandidates = candidates;
    assert.throws(() => reconcile(r), /current|Current/);
  }
  const r = review(); r.currentSourceCandidates = [{ ...candidate, sources: [{ ...proof[0], sha256: '0'.repeat(64) }] }];
  assert.throws(() => reconcile(r), /Source proof drift/);
});
