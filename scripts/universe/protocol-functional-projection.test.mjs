import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { projectProtocolFunctionalAcceptance, releaseGate, stageAcceptance } from './protocol-contract.mjs';
import { qualifyApplication } from './reconciled-release.mjs';
import { fixture as applicationFixture } from './reconciled-release-fixture.mjs';
import { COVERAGE_PATH, COVERAGE_SHA256, validateRequiredApplicationCoverage } from './required-application-roster.mjs';
import { emitQualifiedFunctionalProjection, FUNCTIONAL_PROJECTION_PATH, stageQualifiedApplicationClosure } from './protocol-functional-projection.mjs';
import { qualifyArtifact } from './qualify-artifact.mjs';
import { spawnSync } from 'node:child_process';
const encode = value => Buffer.from(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Full-size controlled qualification fixtures are not an execution ledger,
// actual functional receipts or another operated/native acceptance run.
function controlled() {
  const root = mkdtempSync(join(tmpdir(), 'full-functional-projection-'));
  const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const manifest = JSON.parse(readFileSync(new URL('../../docs/protocols/PROTOCOL-COVERAGE.json', import.meta.url)));
  const runBytes = encode({ scope: 'controlled qualification fixture only' });
  put('docs/run.json', runBytes);
  const file = { path: 'docs/run.json', sha256: hash(runBytes) };
  const candidate = { sourceSha: 'a'.repeat(40), artifactCommit: 'b'.repeat(40), dependencyRevision: 'controlled-lock-v1', configurationDigest: 'c'.repeat(64), specificationRevisions: ['controlled-spec-v1'], acceptanceNetwork: 'testnet', deploymentNetwork: 'mainnet', configurationProof: { network: 'mainnet', sourceRevision: 'controlled-config-v1', configurationDigest: 'c'.repeat(64), assertions: ['controlled configuration binding'], evidence: [file] } };
  manifest.sourceSha = candidate.sourceSha;
  manifest.protocols = manifest.protocols.map(p => ({ ...p, networks: ['mainnet'], coverage: 'unknown', releaseStatus: 'BLOCKED', readOperationDescriptors: p.readOperationDescriptors.map(o => ({ ...o, acceptance: 'PASS' })) }));
  const rows = manifest.protocols.flatMap(p => p.readOperationDescriptors.map(o => ({ protocol: p.id, operation: o.id, variant: 'default', role: 'read', chain: p.chain, network: 'testnet', result: 'PASS', codeRevision: candidate.sourceSha, dependencyRevision: candidate.dependencyRevision, configurationDigest: candidate.configurationDigest, specificationRevision: 'controlled-spec-v1', ranAt: '2026-10-09T00:00:00.000Z', checkpoint: { height: 1, blockHash: 'd'.repeat(64) }, assertions: ['controlled assertion'], authorityReadback: ['controlled readback'], consumerAssertions: ['controlled consumer'], evidence: [file] })));
  const envelope = { schemaVersion: 'universe-explorer-acceptance-v1', generatedAt: '2026-10-09T00:00:00.000Z', provenance: { producer: 'universe-acceptance-runner-v1', command: 'controlled test only', executionEnvironment: 'temporary regression fixture' }, candidate, rows, exclusions: [] };
  manifest.acceptance = { declared: rows.length, passed: rows.length, failed: 0, blocked: 0, notApplicable: 0, notTested: 0, rejected: 0 };
  const base = applicationFixture(envelope);
  const coverageBytes = readFileSync(new URL('../../' + COVERAGE_PATH, import.meta.url));
  const snapshot = JSON.parse(coverageBytes);
  const source = Buffer.from('controlled regression source');
  const sourceFile = { path: 'docs/source.ts', sha256: hash(source) }; put(sourceFile.path, source); put(COVERAGE_PATH, coverageBytes);
  const operations = snapshot.rows.map((_, index) => ({ ...base.roster.operations[0], id: `controlled.operation.${index}`, sources: [sourceFile] }));
  const originalRoster = JSON.parse(readFileSync(new URL('../../docs/acceptance/reconciled-operations.json', import.meta.url)));
  const historical = originalRoster.historical;
  put(originalRoster.historicalRawProvenance.path, readFileSync(new URL('../../' + originalRoster.historicalRawProvenance.path, import.meta.url)));
  const roster = { ...base.roster, historicalRawProvenance: originalRoster.historicalRawProvenance, historical, historicalSha256: hash(encode(historical)), currentSourceCandidates: [], operations, operationDenominator: operations.length, operationDenominatorReconciled: true, blockers: [], mappings: historical.rows.map((h, index) => ({ candidateId: h.id, operationIds: [operations[index % operations.length].id], reason: 'controlled structural fixture, not reviewed real mapping', sources: [sourceFile] })) };
  roster.requiredApplicationCoverage = { schemaVersion: 'universe-required-application-coverage-v1', snapshot: { path: COVERAGE_PATH, sha256: COVERAGE_SHA256, hashEncoding: 'raw-bytes' }, coverageCount: 632, orderedCoverageIds: snapshot.rows.map(r => r.coverageId), sortedCoverageIdsSha256: hash(encode(snapshot.rows.map(r => r.coverageId).sort())), counts: { protocols: 39, protocolOperationDeclarations: 123 }, requiredFields: snapshot.requiredFields, mappingReviewComplete: true, mappings: snapshot.rows.map((row, index) => ({ coverageId: row.coverageId, rowPointer: `/rows/${index}`, fullRequirementSha256: hash(encode(row)), operationIds: [operations[index].id], candidateIds: [historical.rows[index].id], mappingStatus: 'REVIEWED', unresolved: [], coveredAssertionIndices: row.expectedAssertions.map((_, i) => i), coveredExecutionStepIndices: row.executionSteps.map((_, i) => i), coveredInputIndices: row.testInputs.map((_, i) => i), coveredPrerequisiteIndices: row.prerequisites.map((_, i) => i), reviewedNetworkPolicy: row.network, reviewedRolePolicy: { role: row.role, wallet: row.wallet } })) };
  roster.sourceCandidateCoverageLinks = historical.rows.map((h, index) => ({ candidateId: h.id, reviewedOperationIds: [operations[index % operations.length].id], coverageIds: index < snapshot.rows.length ? [snapshot.rows[index].coverageId] : [] }));
  const protocolBytes = encode(envelope), rosterBytes = encode(roster);
  const acceptance = { ...base.acceptance, candidate, rosterSha256: hash(rosterBytes), protocolAcceptanceSha256: hash(protocolBytes), operations: operations.map(operation => {
    const receipt = { ...base.receipt, operationId: operation.id, operation, candidateIdentitySha256: hash(encode(candidate)) };
    const path = `docs/receipts/${operation.id}.json`, bytes = encode(receipt); put(path, bytes);
    return { id: operation.id, result: 'PASS', files: [{ path, sha256: hash(bytes) }] };
  }) };
  const expected = { sourceSha: candidate.sourceSha, artifactCommit: candidate.artifactCommit, network: 'mainnet', acceptanceEvidence: envelope, acceptanceRoot: root, application: { rosterBytes, protocolBytes, acceptanceBytes: encode(acceptance), readProof: path => readFileSync(join(root, path)) } };
  put('docs/protocols/PROTOCOL-COVERAGE.json', encode(manifest));
  put('docs/acceptance/qualified-release-evidence.json', protocolBytes);
  put('docs/acceptance/reconciled-operations.json', rosterBytes);
  put('docs/acceptance/qualified-application-evidence.json', encode(acceptance));
  for (const name of ['protocol-contract.mjs', 'reconciled-release.mjs', 'reconciled-operations.mjs', 'required-application-roster.mjs', 'protocol-functional-projection.mjs']) put('scripts/universe/' + name, readFileSync(new URL('./' + name, import.meta.url)));
  return { root, manifest, envelope, roster, expected };
}

test('the same validators project full39/123 plus632 controlled application receipts', () => {
  const f = controlled();
  try {
    assert.deepEqual(releaseGate(f.manifest, f.expected).problems, []);
    const app = f.expected.application;
    qualifyApplication(app.rosterBytes, JSON.parse(app.acceptanceBytes), app.protocolBytes, f.expected.artifactCommit, app.readProof);
    assert.equal(validateRequiredApplicationCoverage(f.roster, app.readProof).mappingReviewComplete, true);
    const value = projectProtocolFunctionalAcceptance(f.manifest, f.expected);
    assert.ok(value);
    assert.equal(value.protocols.length, 39);
    assert.equal(value.protocols.reduce((n, p) => n + p.passed, 0), 123);
    assert.equal(value.applicationQualification.operationDenominator, 632);
    assert.equal(value.applicationQualification.requiredCoverageCount, 632);
    assert.equal(value.acceptanceNetwork, 'testnet'); assert.equal(value.deploymentNetwork, 'mainnet');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('the complete carried632 closure seals and requalifies independently, and projection tampering fails', async () => {
  const f = controlled();
  const out = mkdtempSync(join(tmpdir(), 'full-functional-packed-'));
  try {
    const stage = join(out, 'stage'); mkdirSync(stage);
    assert.deepEqual(stageAcceptance({ manifestPath: join(f.root, 'docs/protocols/PROTOCOL-COVERAGE.json'), acceptancePath: join(f.root, 'docs/acceptance/qualified-release-evidence.json'), acceptanceRoot: f.root, stageRoot: stage }).problems, []);
    const staged = spawnSync(process.execPath, [new URL('./reconciled-release.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), 'stage', join(f.root, 'docs/acceptance/reconciled-operations.json'), join(f.root, 'docs/acceptance/qualified-application-evidence.json'), join(f.root, 'docs/acceptance/qualified-release-evidence.json'), f.root, f.expected.artifactCommit, stage], { encoding: 'utf8' });
    assert.equal(staged.status, 0, staged.stderr);
    const files = stageQualifiedApplicationClosure(f.root, stage, f.expected.artifactCommit);
    assert.ok(files.some(file => file.path === COVERAGE_PATH));
    assert.ok(files.some(file => file.path === f.roster.historicalRawProvenance.path));
    assert.ok(files.some(file => file.path === 'docs/source.ts'));
    for (const name of ['protocol-contract.mjs', 'reconciled-release.mjs', 'reconciled-operations.mjs', 'required-application-roster.mjs', 'protocol-functional-projection.mjs']) {
      mkdirSync(join(stage, 'scripts/universe'), { recursive: true }); copyFileSync(join(f.root, 'scripts/universe', name), join(stage, 'scripts/universe', name));
    }
    const member = emitQualifiedFunctionalProjection(stage, { artifactCommit: f.expected.artifactCommit, network: 'mainnet' });
    const bytes = readFileSync(join(stage, FUNCTIONAL_PROJECTION_PATH));
    assert.equal(hash(bytes), member.sha256);
    writeFileSync(join(stage, 'RELEASE-MANIFEST.json'), encode({ schemaVersion: 'universe-release-manifest-v1', commit: f.expected.artifactCommit, functionalAcceptanceProjection: member }));
    const archive = join(out, 'full.tar.gz');
    const pack = () => {
      const result = spawnSync('tar', ['-czf', archive, '-C', stage, '.'], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    pack();
    assert.deepEqual(await qualifyArtifact(archive, { commit: f.expected.artifactCommit, network: 'mainnet' }), []);
    writeFileSync(join(stage, FUNCTIONAL_PROJECTION_PATH), '{}'); pack();
    assert.match((await qualifyArtifact(archive, { commit: f.expected.artifactCommit, network: 'mainnet' })).join('\n'), /functional projection differs/);
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('closure staging preflights symlink/conflict targets and preserves unchanged bytes', () => {
  const f = controlled(), stage = mkdtempSync(join(tmpdir(), 'qualified-stage-target-')), outside = mkdtempSync(join(tmpdir(), 'qualified-stage-outside-'));
  try {
    symlinkSync(outside, join(stage, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => stageQualifiedApplicationClosure(f.root, stage, f.expected.artifactCommit), /Unsafe stage ancestor/);
    assert.equal(existsSync(join(outside, 'acceptance')), false);
    rmSync(join(stage, 'docs')); mkdirSync(join(stage, 'docs/acceptance'), { recursive: true });
    const target = join(stage, 'docs/acceptance/reconciled-operations.json'); writeFileSync(target, 'keep-existing');
    assert.throws(() => stageQualifiedApplicationClosure(f.root, stage, f.expected.artifactCommit), /preserved existing bytes/);
    assert.equal(readFileSync(target, 'utf8'), 'keep-existing');
    assert.equal(existsSync(join(stage, COVERAGE_PATH)), false);
    rmSync(target);
    stageQualifiedApplicationClosure(f.root, stage, f.expected.artifactCommit);
    const first = readFileSync(target);
    stageQualifiedApplicationClosure(f.root, stage, f.expected.artifactCommit);
    assert.deepEqual(readFileSync(target), first);
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(stage, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('no application, unresolved review, lost receipt or altered protocol evidence never produces a projection', () => {
  const f = controlled();
  try {
    assert.equal(projectProtocolFunctionalAcceptance(f.manifest, { ...f.expected, application: undefined }), null);
    f.roster.operationDenominatorReconciled = false;
    assert.equal(projectProtocolFunctionalAcceptance(f.manifest, { ...f.expected, application: { ...f.expected.application, rosterBytes: encode(f.roster) } }), null);
    rmSync(join(f.root, 'docs/receipts/controlled.operation.631.json'));
    assert.equal(projectProtocolFunctionalAcceptance(f.manifest, f.expected), null);
    f.envelope.rows[0].codeRevision = 'wrong-revision';
    assert.equal(projectProtocolFunctionalAcceptance(f.manifest, f.expected), null);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
