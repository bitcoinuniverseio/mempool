import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommandMatrix, buildMatrix, describeArtifact, tableIds, uniqueIds, validateMatrix } from './acceptance-matrix.mjs';

test('current text source identities are portable across Git LF and CRLF checkouts but retain token changes', () => {
  const lf = Buffer.from('export const state = "ready";\nexport const count = 1;\n');
  const crlf = Buffer.from(lf.toString().replaceAll('\n', '\r\n'));
  for (const path of ['frontend/src/app/example.ts', 'backend/src/config.ts', 'scripts/universe/acceptance-matrix.mjs']) {
    const source = describeArtifact(path, lf);
    assert.equal(source.sha256Encoding, 'utf8-lf');
    assert.deepEqual(describeArtifact(path, crlf), source, path);
    assert.equal(source.bytes, lf.length);
    assert.notEqual(describeArtifact(path, Buffer.from(lf.toString().replace('count = 1', 'count = 2'))).sha256, source.sha256, path);
  }
});

test('historical and execution evidence retain raw bytes including handoff scripts and explicitly submitted application files', () => {
  const lf = Buffer.from('const assertion = "observed";\n');
  const crlf = Buffer.from(lf.toString().replaceAll('\n', '\r\n'));
  for (const [path, options] of [
    ['docs/acceptance/health-runtime-2026-09-06/review.json', {}],
    ['docs/acceptance/handoff/gateway-anima-regression.test.mjs', {}],
    ['scripts/universe/visual-qa/mobile-check.mjs', {}],
    ['backend/src/config.ts', { executionEvidence: true }],
  ]) {
    const artifact = describeArtifact(path, crlf, options);
    assert.equal(artifact.sha256Encoding, 'raw-bytes', path);
    assert.equal(artifact.sha256, createHash('sha256').update(crlf).digest('hex'), path);
    assert.equal(artifact.bytes, crlf.length, path);
    assert.equal(artifact.text, crlf.toString(), path);
    assert.notEqual(artifact.sha256, describeArtifact(path, lf, options).sha256, path);
  }
});

test('the regeneration command retains every reviewed execution assertion by default', () => {
  const evidence = JSON.parse(readFileSync(new URL('../../docs/acceptance/current-execution-evidence.json', import.meta.url), 'utf8'));
  const matrix = buildCommandMatrix();
  const byId = new Map(matrix.rows.map(row => [row.id, row]));
  assert(evidence.rows.some(row => row.status === 'PASS LOCAL'));
  assert(evidence.rows.some(row => row.status === 'BLOCKED'));
  for (const assertion of evidence.rows) {
    const row = byId.get(assertion.id);
    assert.equal(row.status, assertion.status, assertion.id);
    assert.equal(row.acceptanceScope, assertion.scope, assertion.id);
    assert(row.evidence.length > 0, assertion.id);
    for (const entry of row.evidence) {
      assert.equal(entry.sha256Encoding, 'raw-bytes');
      assert.equal(entry.sha256, createHash('sha256').update(readFileSync(new URL('../../' + entry.artifact, import.meta.url))).digest('hex'));
    }
  }
  assert.equal(matrix.operationDenominatorReconciled, false);
  assert.equal(matrix.realNetworkE2ePasses, 0);
});

test('an incomplete evidence option cannot reset the ledger to source-only rows', () => {
  assert.throws(() => buildCommandMatrix(['--evidence']), /requires a file path/);
  assert.throws(() => buildCommandMatrix(['--evidence', '--check']), /requires a file path/);
});

test('markdown imports retain expanded ranges, compact IDs and separate operation/evidence identities', () => {
  assert.deepEqual(tableIds('OV-04 to OV-07'), ['OV-04', 'OV-05', 'OV-06', 'OV-07']);
  assert.deepEqual(tableIds('SP-STORE-001 / SP-01,02,03'), ['SP-STORE-001', 'SP-01', 'SP-02', 'SP-03']);
  assert.deepEqual(tableIds('Q07-A03'), ['Q07-A03']);
  assert.deepEqual(tableIds('SW-UI-INSPECT'), ['SW-UI-INSPECT']);
  assert.throws(() => tableIds('OV-07 to OV-04'), /Invalid ID range/);
});

test('duplicate source IDs cannot be silently deduplicated', () => {
  assert.throws(() => uniqueIds([{ id: 'P01' }, { id: 'P01' }], 'source'), /duplicate/);
});

test('current acceptance evidence must exist and keep its actual artifact hash lineage', () => {
  const overlay = join(tmpdir(), `mempool-matrix-evidence-${process.pid}.json`);
  try {
    const row = { id: 'SP-05', status: 'PASS LOCAL', scope: 'Actual local parser artifact',
      evidence: [{ artifact: 'docs/acceptance/does-not-exist-evidence.json' }] };
    writeFileSync(overlay, JSON.stringify({ schemaVersion: 'universe-operation-evidence-v1', rows: [row] }));
    assert.throws(() => buildMatrix({ evidencePath: overlay }), /ENOENT|evidence artifact/);
    row.evidence = [{ artifact: 'docs/acceptance/2026-09-05-inventory.json' }];
    writeFileSync(overlay, JSON.stringify({ schemaVersion: 'universe-operation-evidence-v1', rows: [row] }));
    const matrix = buildMatrix({ evidencePath: overlay });
    const accepted = matrix.rows.find(entry => entry.id === 'SP-05');
    assert.match(accepted.evidence[0].sha256, /^[0-9a-f]{64}$/);
    accepted.evidence[0].sha256 = '0'.repeat(64);
    assert.throws(() => validateMatrix(matrix), /evidence hash lineage/);
    // A source file submitted as concrete evidence must still use raw bytes,
    // including the shared artifact entry referenced by other source rows.
    const artifact = 'backend/src/config.ts';
    row.evidence = [{ artifact, sha256: createHash('sha256').update(readFileSync(new URL('../../' + artifact, import.meta.url))).digest('hex') }];
    writeFileSync(overlay, JSON.stringify({ schemaVersion: 'universe-operation-evidence-v1', rows: [row] }));
    const sourceEvidence = buildMatrix({ evidencePath: overlay });
    assert.equal(sourceEvidence.sources.find(entry => entry.path === artifact).sha256Encoding, 'raw-bytes');
    assert.equal(sourceEvidence.rows.find(entry => entry.id === 'SP-05').evidence[0].sha256, row.evidence[0].sha256);
  } finally { unlinkSync(overlay); }
});

test('actual source matrix preserves named inventories and required distinct variants without promoting source acceptance', () => {
  const matrix = buildMatrix(), byId = new Map(matrix.rows.map(row => [row.id, row]));
  assert.deepEqual(matrix.sourceCounts, { navigation: 351, namedOperations: 37, protocolIdentities: 39,
    uiCandidates: 304, apiCandidates: 546, additionalRouteDeclarations: 55, components: 302, controls: 1569, handlerBindings: 344 });
  assert.equal(matrix.sourceGroups['protocol-operation'].length, 119);
  assert.equal(matrix.sourceGroups['health-verification'].length, 40);
  const chainstates = matrix.rows.filter(row => row.route === '/api/v1/intelligence/bootstrap/chainstates' && row.method === 'GET');
  assert.equal(chainstates.length, 1, 'The current all-node chainstates route must be retained exactly once');
  assert.equal(chainstates[0].kind, 'current-api-addition');
  assert.equal(byId.get('API-4dc9791028b6').role, 'public request at this route; no handler authorization guard');
  assert.equal(matrix.healthHandoff.protocolOperationBindings, 119);
  assert.equal(byId.get('H-01').priorAssertion.status, 'FAIL');
  assert.equal(byId.get('H-01').status, 'NOT TESTED');
  assert.equal(byId.get('R-04-TX').route, '/api/v1/dogecoin/tx/:txid');
  assert.equal(byId.get('R-04-TX').entry, '/dogecoin/tx/:txid');
  assert.equal(byId.get('R-04-SPENT').entry, '/dogecoin/outpoint/:txid/:vout');
  assert.equal(byId.get('PRO-01/registry').handoffBinding.coverageId, 'PRO-01.registry');
  assert(!byId.has('PRO-01.registry'), 'A second handoff name must not duplicate the existing operation row');
  assert.equal(byId.get('R-07').links.length, 119);
  for (let n = 1; n <= 36; n++) assert(byId.has(`Q05-P${String(n).padStart(2, '0')}`));
  for (let n = 1; n <= 12; n++) assert(byId.has(`Q07-A${String(n).padStart(2, '0')}`));
  assert.equal(matrix.sourceGroups['admin-resource-variant'].length, 14);
  assert.equal(matrix.sourceGroups['admin-operation-variant'].length, 26);
  assert.equal(matrix.sourceGroups['portfolio-history-variant'].length, 6);
  assert(byId.has('Q07-A08/explorer.indexer.task.run/blocksPrices'));
  assert(byId.has('Q07-A08/explorer.indexer.task.run/coinStatsIndex'));
  assert(byId.has('Q05-P23/fromHeight-toTimestamp'));
  assert.equal(byId.get('PRO-32/status').route, '/api/v1/anima/status');
  assert.equal(byId.get('PRO-01/outpoints-batch').method, 'POST');
  assert.deepEqual(byId.get('PRO-01/outpoint').declaredNetworks, ['mainnet']);
  assert.equal(byId.get('PRO-01/outpoint').network, 'unverified');
  assert(matrix.rows.every(row => row.status === 'NOT TESTED' && row.evidence.length === 0));
  assert.equal(matrix.operationDenominator, null); assert.equal(matrix.realNetworkE2ePasses, 0);
  assert(matrix.gaps.some(gap => gap.kind === 'missing-handoff-bundle'));
  const lost = structuredClone(matrix); lost.rows = lost.rows.filter(row => row.id !== 'Q05-P01');
  assert.throws(() => validateMatrix(lost), /lost Q05-P01/);
  const duplicate = structuredClone(matrix); duplicate.rows.push(duplicate.rows[0]);
  assert.throws(() => validateMatrix(duplicate), /duplicate IDs/);
  const corrupted = structuredClone(matrix); corrupted.rows[0].sources[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateMatrix(corrupted), /source hash lineage/);
  const lostBinding = structuredClone(matrix);
  delete lostBinding.rows.find(row => row.id === 'PRO-01/registry').handoffBinding;
  assert.throws(() => validateMatrix(lostBinding), /Lost handoff operation binding/);
  const replacedBinding = structuredClone(matrix);
  replacedBinding.rows.find(row => row.id === 'PRO-01/registry').handoffBinding.ledgerId = 'PRO-01.registry';
  assert.throws(() => validateMatrix(replacedBinding), /changed the original ledger ID/);
  const falsePass = structuredClone(matrix); falsePass.rows[0].status = 'PASS LOCAL';
  assert.throws(() => validateMatrix(falsePass), /unsupported acceptance/);
});
