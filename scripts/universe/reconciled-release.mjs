import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootedProofReader } from './reconciled-operations.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const contexts = { bitcoin: ['signet', 'testnet', 'testnet4'], dogecoin: ['testnet'],
  zcash: ['testnet'], fractal: ['testnet'], liquid: ['testnet'], local: ['offline'] };

/** Admission is separate from source reconciliation and protocol qualification.
 * Every application operation needs its own candidate-bound functional receipt.
 * No source row, component check, aggregate percentage or PASS label is a receipt.
 */
export function qualifyApplication(rosterBytes, acceptance, protocolBytes, candidateCommit, readProof) {
  const roster = JSON.parse(rosterBytes.toString('utf8'));
  const protocol = JSON.parse(protocolBytes.toString('utf8'));
  assert.equal(roster.schemaVersion, 'universe-reconciled-operations-v1');
  assert.equal(roster.operationDenominatorReconciled, true, 'Application denominator is unresolved');
  assert.equal(roster.blockers.length, 0, 'Application candidates remain unresolved');
  assert(roster.operations.length > 0 && roster.operationDenominator === roster.operations.length);
  assert.equal(new Set(roster.operations.map(row => row.id)).size, roster.operations.length);
  assert.equal(roster.historicalSha256, digest(Buffer.from(JSON.stringify(roster.historical))), 'Historical lineage drift');
  assert.deepEqual(roster.mappings.map(row => row.candidateId).sort(), roster.historical.rows.map(row => row.id).sort(),
    'Application candidates were lost or duplicated');
  const operationIds = new Set(roster.operations.map(row => row.id));
  const mapped = new Set();
  for (const mapping of roster.mappings) {
    assert(text(mapping.reason) && mapping.sources.length > 0);
    if (mapping.excluded === true) {
      assert(text(mapping.exclusionJustification) && mapping.operationIds.length === 0, 'Exclusion lacks reviewed specification rationale');
    } else {
      assert(mapping.operationIds.length > 0);
      for (const id of mapping.operationIds) { assert(operationIds.has(id), 'Unknown mapped operation'); mapped.add(id); }
    }
  }
  assert.equal(mapped.size, operationIds.size, 'Application operation lacks historical lineage');
  assert.equal(acceptance.schemaVersion, 'universe-application-acceptance-v1');
  assert.equal(acceptance.rosterSha256, digest(rosterBytes), 'Acceptance roster drift');
  assert.equal(acceptance.protocolAcceptanceSha256, digest(protocolBytes), 'Protocol evidence drift');
  assert.deepEqual(acceptance.candidate, protocol.candidate, 'Application and protocol candidate bindings differ');
  assert(/^[0-9a-f]{40}$/.test(candidateCommit));
  assert.equal(acceptance.candidate.artifactCommit, candidateCommit, 'Wrong application artifact');
  assert(hash(acceptance.candidate.configurationDigest) && text(acceptance.candidate.dependencyRevision));
  assert(Array.isArray(acceptance.componentBindings));
  for (const binding of acceptance.componentBindings) {
    assert(text(binding.component) && /^[0-9a-f]{40}$/.test(binding.revision) &&
      hash(binding.artifactSha256) && hash(binding.configurationSha256), 'Invalid component binding');
  }
  assert.equal(new Set(acceptance.componentBindings.map(row => row.component)).size, acceptance.componentBindings.length);
  for (const name of ['frontend', 'backend', 'gateway', 'overlay']) {
    const binding = acceptance.componentBindings.find(row => row.component === name);
    assert(binding && hash(binding.artifactSha256) && hash(binding.configurationSha256), 'Component artifact/configuration binding is missing');
    assert.equal(binding.revision, name === 'overlay' ? protocol.candidate.sourceSha : candidateCommit,
      'Component source revision drift');
  }
  const componentDigest = digest(Buffer.from(JSON.stringify(acceptance.componentBindings)));
  const identityDigest = digest(Buffer.from(JSON.stringify(acceptance.candidate)));
  assert(Array.isArray(acceptance.operations));
  assert.deepEqual(acceptance.operations.map(row => row.id).sort(), [...operationIds].sort(), 'Missing or duplicate functional operation receipts');
  const files = new Map();
  for (const row of acceptance.operations) {
    const operation = roster.operations.find(operation => operation.id === row.id);
    assert.equal(row.result, 'PASS', `${row.id} is not functionally accepted; exclusions belong in reviewed candidate mappings`);
    assert(Array.isArray(row.files) && row.files.length > 0, 'Functional receipt is absent');
    const receipts = [];
    for (const file of row.files) {
      assert(text(file.path) && hash(file.sha256));
      assert(file.path.startsWith('docs/') && !file.path.includes('\\') && !file.path.split('/').includes('..'),
        'Functional evidence must be a plain path under the packed docs tree');
      const bytes = readProof(file.path);
      assert.equal(digest(bytes), file.sha256, 'Functional evidence byte drift');
      assert(!files.has(file.path) || files.get(file.path) === file.sha256, 'Conflicting functional evidence identity');
      files.set(file.path, file.sha256);
      const receipt = JSON.parse(bytes.toString('utf8'));
      assert.equal(receipt.schemaVersion, 'universe-functional-operation-receipt-v1', 'Source/component evidence cannot qualify an operation');
      assert.equal(receipt.operationId, row.id);
      assert.equal(receipt.candidateIdentitySha256, identityDigest, 'Functional candidate identity drift');
      assert.equal(receipt.componentBindingsSha256, componentDigest, 'Functional component identity drift');
      for (const field of ['entryPoint', 'method', 'role', 'chain', 'network', 'inputContract', 'outputContract', 'lifecycle', 'specificationRevision']) {
        assert.equal(receipt.operation[field], operation[field], `Functional contract drift: ${field}`);
      }
      assert(text(receipt.command) && text(receipt.environment) && Number.isFinite(Date.parse(receipt.ranAt)));
      assert.equal(receipt.qualificationScope, 'functional');
      assert.equal(receipt.mainnetFunctionalTest, false, 'Mainnet functional testing is not release qualification');
      assert(text(receipt.testContext.chain) && text(receipt.testContext.network));
      assert(contexts[receipt.testContext.chain]?.includes(receipt.testContext.network), 'Unsupported functional test context');
      const operationChain = operation.chain.toLowerCase();
      if (Object.hasOwn(contexts, operationChain)) assert.equal(receipt.testContext.chain, operationChain, 'Functional chain drift');
      if (receipt.testContext.chain === 'local') assert(
        /chain-independent|network-independent|local/i.test(operation.chain) ||
        operation.method === 'GET' && operation.entryPoint === '/api/v1/universe/protocols',
        'Indexed operations cannot be qualified as local static reads');
      if (receipt.testContext.network !== 'signet') assert(text(receipt.testContext.justification), 'Non-Signet context needs governing justification');
      for (const phase of ['execution', 'authoritativeReadback', 'consumer', 'refreshRecovery']) {
        assert.equal(receipt.phases[phase].result, 'PASS', `Unaccepted lifecycle phase: ${phase}`);
        assert(text(receipt.phases[phase].observation), 'Lifecycle phase has no observed result');
      }
      receipts.push(receipt);
    }
    for (const assertion of operation.assertions) {
      assert(receipts.some(receipt => receipt.assertions.some(observation => observation.assertion === assertion &&
        observation.result === 'PASS' && text(observation.observation))), `Unproved functional assertion: ${assertion}`);
    }
  }
  return { qualified: true, operationCount: operationIds.size, files: [...files].map(([path, sha256]) => ({ path, sha256 })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, rosterPath, acceptancePath, protocolPath, proofRoot, commit, stagePath] = process.argv.slice(2);
    assert(['check', 'stage'].includes(command) && process.argv.slice(2).length === (command === 'stage' ? 7 : 6));
    const root = realpathSync(resolve(proofRoot));
    const reader = rootedProofReader(root);
    const relativeInput = path => relative(root, realpathSync(resolve(path)));
    const rosterBytes = reader(relativeInput(rosterPath));
    const acceptanceBytes = reader(relativeInput(acceptancePath));
    const result = qualifyApplication(rosterBytes, JSON.parse(acceptanceBytes.toString('utf8')),
      reader(relativeInput(protocolPath)), commit, reader);
    if (command === 'stage') {
      const stage = realpathSync(resolve(stagePath));
      const targets = [
        ['docs/acceptance/reconciled-operations.json', rosterBytes],
        ['docs/acceptance/qualified-application-evidence.json', acceptanceBytes],
        ...result.files.map(file => [file.path, reader(file.path)]),
      ];
      assert.equal(new Set(targets.map(([path]) => path)).size, targets.length, 'Evidence collides with application manifests');
      const stagedReader = rootedProofReader(stage);
      for (const [path, bytes] of targets) {
        assert(!isAbsolute(path) && !path.split(/[\\/]/).includes('..'));
        const target = resolve(stage, path);
        let ancestor = dirname(target);
        while (!existsSync(ancestor)) ancestor = dirname(ancestor);
        const parent = relative(stage, realpathSync(ancestor));
        assert(parent !== '..' && !parent.startsWith('..\\') && !parent.startsWith('../') && !isAbsolute(parent));
        if (existsSync(target)) assert.equal(digest(stagedReader(path)), digest(bytes), 'Application staging target differs');
      }
      for (const [path, bytes] of targets) {
        const target = resolve(stage, path);
        if (existsSync(target)) continue;
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { flag: 'wx' });
      }
    }
    console.log(JSON.stringify({ applicationAcceptanceQualified: true, operations: result.operationCount }));
  } catch {
    console.error('Full application acceptance did not qualify; no release mutation authorized.');
    process.exitCode = 1;
  }
}
