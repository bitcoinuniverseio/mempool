/**
 * The release artifact carries its own acceptance, proven on real archives.
 *
 * Until 2026-09-23 the artifact workflow staged docs/ and then left it out of
 * the tar member list, and never staged the evidence files the acceptance
 * envelope names. A candidate that qualified in the checkout could not
 * qualify on the host. Regex checks on the workflow text did not notice,
 * because the text contained every expected string. These cases build actual
 * gzip tar archives, extract them into empty directories and run the gate the
 * archive carries, with no checkout involved.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { stageAcceptance, acceptanceEvidenceClosure } from './protocol-contract.mjs';
import { qualifyArtifact, memberProblems } from './qualify-artifact.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const workdir = mkdtempSync(join(tmpdir(), 'release-artifact-'));
test.after(() => rmSync(workdir, { recursive: true, force: true }));

const ARTIFACT_COMMIT = 'd'.repeat(40);
const SOURCE_SHA = 'a'.repeat(40);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// A minimal ustar writer, so an archive can hold members the host filesystem
// cannot create (a symlink on an unprivileged Windows account, a traversal
// name) and so no case depends on the packing tool it is testing.
// ---------------------------------------------------------------------------

function header(name, { size = 0, type = '0', linkname = '', mode = 0o644 } = {}) {
  const block = Buffer.alloc(512, 0);
  const put = (text, offset, length) => block.write(text, offset, Math.min(Buffer.byteLength(text), length), 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(1_758_000_000, 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put(linkname, 157, 100);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put('root', 265, 32);
  put('root', 297, 32);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return block;
}

/** entries: [name, Buffer | { symlink: target }] */
function archive(file, entries) {
  const parts = [];
  const directories = new Set();
  for (const [name] of entries) {
    const segments = name.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const directory = segments.slice(0, i).join('/') + '/';
      if (!directories.has(directory) && !directory.startsWith('..') && !directory.startsWith('/')) {
        directories.add(directory);
        parts.push(header(directory, { type: '5', mode: 0o755 }));
      }
    }
  }
  for (const [name, content] of entries) {
    if (Buffer.isBuffer(content)) {
      parts.push(header(name, { size: content.length }));
      parts.push(content);
      const padding = (512 - (content.length % 512)) % 512;
      if (padding) parts.push(Buffer.alloc(padding, 0));
    } else {
      parts.push(header(name, { type: '2', linkname: content.symlink, mode: 0o777 }));
    }
  }
  parts.push(Buffer.alloc(1024, 0));
  writeFileSync(file, gzipSync(Buffer.concat(parts)));
  return file;
}

// ---------------------------------------------------------------------------
// A candidate whose every declared operation passed on Signet, with a
// separate Mainnet configuration proof, as the release contract requires.
// ---------------------------------------------------------------------------

function signetQualifiedCandidate() {
  const root = mkdtempSync(join(workdir, 'checkout-'));
  const pinned = JSON.parse(readFileSync(join(repositoryRoot, 'docs', 'protocols', 'PROTOCOL-COVERAGE.json'), 'utf8'));
  const dependencyRevision = 'fixture-backend-dependencies-v1';
  const configurationDigest = 'b'.repeat(64);
  const specificationRevision = 'fixture-protocol-spec-v1';

  const journey = Buffer.from(JSON.stringify({ run: 'signet-fixture', journeys: 'every declared read' }));
  const configuration = Buffer.from(JSON.stringify({ network: 'mainnet', endpoints: 'first-party' }));
  const journeyPath = 'docs/acceptance/evidence/signet/run-1/journeys.json';
  const configurationPath = 'docs/acceptance/evidence/mainnet/configuration.json';
  for (const [relative, bytes] of [[journeyPath, journey], [configurationPath, configuration]]) {
    mkdirSync(dirname(join(root, relative)), { recursive: true });
    writeFileSync(join(root, relative), bytes);
  }

  const protocols = pinned.protocols.map((protocol) => ({
    ...protocol,
    networks: ['mainnet'],
    coverage: 'unknown',
    releaseStatus: 'BLOCKED',
    readOperationDescriptors: (protocol.readOperationDescriptors ?? []).map((operation) => ({ ...operation, acceptance: 'PASS' })),
  }));
  const declared = protocols.reduce((total, protocol) => total + protocol.readOperationDescriptors.length, 0);
  const manifest = {
    ...pinned,
    sourceSha: SOURCE_SHA,
    protocols,
    acceptance: { declared, passed: declared, failed: 0, blocked: 0, notApplicable: 0, notTested: 0, rejected: 0 },
  };
  const envelope = {
    schemaVersion: 'universe-explorer-acceptance-v1',
    generatedAt: '2026-09-23T20:00:00.000Z',
    provenance: {
      producer: 'universe-acceptance-runner-v1',
      executionEnvironment: 'controlled-offline-fixture',
      command: 'fixture acceptance command',
    },
    candidate: {
      sourceSha: SOURCE_SHA,
      artifactCommit: ARTIFACT_COMMIT,
      dependencyRevision,
      configurationDigest,
      specificationRevisions: [specificationRevision],
      acceptanceNetwork: 'signet',
      deploymentNetwork: 'mainnet',
      configurationProof: {
        network: 'mainnet',
        configurationDigest,
        sourceRevision: ARTIFACT_COMMIT,
        assertions: ['mainnet endpoints, credentials scope and schemas checked offline'],
        evidence: [{ path: configurationPath, sha256: sha256(configuration) }],
      },
    },
    rows: protocols.flatMap((protocol) => protocol.readOperationDescriptors.map((operation) => ({
      protocol: protocol.id,
      operation: operation.id,
      variant: 'default',
      role: 'read',
      chain: protocol.chain,
      network: 'signet',
      result: 'PASS',
      codeRevision: SOURCE_SHA,
      dependencyRevision,
      configurationDigest,
      specificationRevision,
      ranAt: '2026-09-23T19:00:00.000Z',
      checkpoint: { height: 1, blockHash: 'c'.repeat(64) },
      evidence: [{ path: journeyPath, sha256: sha256(journey) }],
      assertions: ['fixture evidence is bound to the qualified row'],
      authorityReadback: ['fixture authority readback is present'],
      consumerAssertions: ['fixture consumer assertion is present'],
    }))),
    exclusions: [],
  };
  mkdirSync(join(root, 'docs', 'protocols'), { recursive: true });
  const manifestPath = join(root, 'docs', 'protocols', 'PROTOCOL-COVERAGE.json');
  const acceptancePath = join(root, 'docs', 'acceptance', 'qualified-release-evidence.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(acceptancePath, JSON.stringify(envelope));
  return { root, manifestPath, acceptancePath, envelope, journeyPath, configurationPath };
}

/** Stages a candidate the way the workflow's Pack step does, minus the build outputs. */
function stagedRelease(candidate, { commit = ARTIFACT_COMMIT } = {}) {
  const stage = mkdtempSync(join(workdir, 'stage-'));
  const report = stageAcceptance({
    manifestPath: candidate.manifestPath,
    acceptancePath: candidate.acceptancePath,
    acceptanceRoot: candidate.root,
    stageRoot: stage,
  });
  assert.deepEqual(report.problems, []);
  mkdirSync(join(stage, 'scripts', 'universe'), { recursive: true });
  copyFileSync(join(here, 'protocol-contract.mjs'), join(stage, 'scripts', 'universe', 'protocol-contract.mjs'));
  writeFileSync(join(stage, 'RELEASE-MANIFEST.json'), JSON.stringify({ commit }));
  return stage;
}

function entriesOf(stage, relatives) {
  return relatives.map((relative) => [relative, readFileSync(join(stage, relative))]);
}

const CARRIED = (candidate) => [
  'RELEASE-MANIFEST.json',
  'scripts/universe/protocol-contract.mjs',
  'docs/protocols/PROTOCOL-COVERAGE.json',
  'docs/acceptance/qualified-release-evidence.json',
  candidate.journeyPath,
  candidate.configurationPath,
];

function packed(name, entries) {
  return archive(join(mkdtempSync(join(workdir, 'out-')), name), entries);
}

test('a Signet-qualified Mainnet candidate qualifies from its extracted archive alone', async () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  // The checkout is gone before the archive is judged.
  rmSync(candidate.root, { recursive: true, force: true });
  const file = packed('mempool-good.tar.gz', entriesOf(stage, CARRIED(candidate)));
  assert.deepEqual(await qualifyArtifact(file, { commit: ARTIFACT_COMMIT, network: 'mainnet' }), []);
});

test('staging carries the complete evidence closure the envelope names, and nothing is left behind', () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  const closure = acceptanceEvidenceClosure(candidate.envelope).map((entry) => entry.path).sort();
  assert.deepEqual(closure, [candidate.configurationPath, candidate.journeyPath].sort());
  for (const relative of closure) {
    assert.equal(readFileSync(join(stage, relative), 'utf8'), readFileSync(join(candidate.root, relative), 'utf8'));
  }
});

test('an archive packed without docs, as the workflow used to, does not qualify', async () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  const file = packed('mempool-no-docs.tar.gz', entriesOf(stage, ['RELEASE-MANIFEST.json', 'scripts/universe/protocol-contract.mjs']));
  const problems = (await qualifyArtifact(file, { commit: ARTIFACT_COMMIT })).join('\n');
  assert.match(problems, /does not carry docs\/protocols\/PROTOCOL-COVERAGE\.json/);
  assert.match(problems, /does not carry docs\/acceptance\/qualified-release-evidence\.json/);
});

test('an archive missing a nested evidence file does not qualify', async () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  const without = CARRIED(candidate).filter((relative) => relative !== candidate.journeyPath);
  const problems = (await qualifyArtifact(packed('mempool-missing.tar.gz', entriesOf(stage, without)), { commit: ARTIFACT_COMMIT })).join('\n');
  assert.match(problems, /names unreadable evidence docs\/acceptance\/evidence\/signet\/run-1\/journeys\.json/);
});

test('tampered evidence bytes inside the archive do not qualify', async () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  const entries = entriesOf(stage, CARRIED(candidate)).map(([name, bytes]) =>
    name === candidate.journeyPath ? [name, Buffer.from(bytes.toString('utf8').replace('signet-fixture', 'signet-forged!'))] : [name, bytes]);
  const problems = (await qualifyArtifact(packed('mempool-tampered.tar.gz', entries), { commit: ARTIFACT_COMMIT })).join('\n');
  assert.match(problems, /journeys\.json has SHA-256 [0-9a-f]{64}, not the recorded/);
});

test('a link in the evidence tree is refused before extraction', async () => {
  const candidate = signetQualifiedCandidate();
  const stage = stagedRelease(candidate);
  const entries = entriesOf(stage, CARRIED(candidate)).filter(([name]) => name !== candidate.journeyPath);
  entries.push([candidate.journeyPath, { symlink: '../../../../../../etc/passwd' }]);
  const problems = (await qualifyArtifact(packed('mempool-link.tar.gz', entries), { commit: ARTIFACT_COMMIT })).join('\n');
  assert.match(problems, /carries a link in its evidence tree/);
});

test('member names that are absolute or climb out of the release are refused', () => {
  const required = ['RELEASE-MANIFEST.json', 'docs/protocols/PROTOCOL-COVERAGE.json',
    'docs/acceptance/qualified-release-evidence.json', 'scripts/universe/protocol-contract.mjs'];
  assert.deepEqual(memberProblems(required, []), []);
  assert.match(memberProblems([...required, '../outside.json'], []).join('\n'), /escapes the release directory/);
  assert.match(memberProblems([...required, '/etc/cron.d/x'], []).join('\n'), /is absolute/);
  assert.match(memberProblems([...required, 'docs/../../x'], []).join('\n'), /escapes/);
});

test('a stale revision does not qualify: the manifest commit and the envelope must name the release', async () => {
  const candidate = signetQualifiedCandidate();
  const stale = stagedRelease(candidate, { commit: 'e'.repeat(40) });
  const staleFile = packed('mempool-stale.tar.gz', entriesOf(stale, CARRIED(candidate)));
  const staleManifest = (await qualifyArtifact(staleFile, { commit: ARTIFACT_COMMIT })).join('\n');
  assert.match(staleManifest, /RELEASE-MANIFEST\.json names "e{40}", not the release commit d{40}/);
  const good = stagedRelease(signetQualifiedCandidate());
  const other = (await qualifyArtifact(packed('mempool-other.tar.gz', entriesOf(good, CARRIED(candidate))), { commit: 'f'.repeat(40) })).join('\n');
  assert.match(other, /names artifact d{40}, not the intended artifact f{40}/);
});

test('staging refuses evidence outside docs/, traversal, absolute paths and wrong digests, and copies nothing', () => {
  for (const [label, mutate, expected] of [
    ['outside docs', (entry) => { entry.path = 'scripts/universe/protocol-contract.mjs'; }, /not a plain path under docs\//],
    ['traversal', (entry) => { entry.path = 'docs/../../outside.json'; }, /not a plain path under docs\/|escapes the evidence root/],
    ['absolute', (entry) => { entry.path = '/etc/passwd'; }, /absolute evidence path|not a plain path/],
    ['digest', (entry) => { entry.sha256 = '0'.repeat(64); }, /not the recorded/],
    ['missing', (entry) => { entry.path = 'docs/acceptance/evidence/signet/run-1/absent.json'; }, /unreadable evidence/],
  ]) {
    const candidate = signetQualifiedCandidate();
    const envelope = JSON.parse(readFileSync(candidate.acceptancePath, 'utf8'));
    mutate(envelope.rows[0].evidence[0]);
    writeFileSync(candidate.acceptancePath, JSON.stringify(envelope));
    const stage = mkdtempSync(join(workdir, 'refused-'));
    const report = stageAcceptance({
      manifestPath: candidate.manifestPath, acceptancePath: candidate.acceptancePath, acceptanceRoot: candidate.root, stageRoot: stage,
    });
    assert.match(report.problems.join('\n'), expected, label);
    assert.equal(existsSync(join(stage, 'docs')), false, `${label} staged files despite refusing`);
  }
});

test('staging refuses an envelope that names no evidence at all', () => {
  const candidate = signetQualifiedCandidate();
  writeFileSync(candidate.acceptancePath, JSON.stringify({ ...candidate.envelope, rows: [], candidate: { ...candidate.envelope.candidate, configurationProof: undefined } }));
  const report = stageAcceptance({
    manifestPath: candidate.manifestPath, acceptancePath: candidate.acceptancePath, acceptanceRoot: candidate.root, stageRoot: mkdtempSync(join(workdir, 'empty-')),
  });
  assert.match(report.problems.join('\n'), /names no evidence files/);
});

test('the workflow stages the closure, packs docs, and qualifies the packed archive before upload', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github', 'workflows', 'universe-release-artifact.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(workflow, /protocol-contract\.mjs --stage-acceptance "\$stage"/);
  assert.match(workflow, /tar -czf "\$out" -C "\$stage" backend frontend scripts production docs RELEASE-MANIFEST\.json/);
  const qualify = workflow.indexOf('- name: Qualify the packed archive on its own');
  const pack = workflow.indexOf('- name: Pack');
  const upload = workflow.indexOf('- name: Upload');
  assert.ok(pack > 0 && qualify > pack && upload > qualify, 'qualification must sit between packing and upload');
  assert.match(workflow.slice(qualify, upload), /qualify-artifact\.mjs[\s\S]*--commit '\$\{\{ steps\.sha\.outputs\.sha \}\}' --network mainnet/);
});
