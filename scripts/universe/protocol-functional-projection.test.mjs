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
import { controlled } from './protocol-functional-fixture.mjs';

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
    for (const name of ['protocol-contract.mjs', 'reconciled-release.mjs', 'reconciled-operations.mjs', 'required-application-roster.mjs', 'acceptance-contexts.mjs', 'protocol-functional-projection.mjs']) {
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
