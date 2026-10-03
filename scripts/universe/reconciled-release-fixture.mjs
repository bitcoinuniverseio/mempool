import { createHash } from 'node:crypto';
import { reconcileOperations } from './reconciled-operations.mjs';
import { qualifyApplication } from './reconciled-release.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));

export function fixture(protocolEnvelope, chain = 'chain-independent local vault') {
  const source = Buffer.from('controlled regression source');
  const sources = [{ path: 'source.ts', sha256: digest(source) }];
  const operation = { id: 'local.delete', entryPoint: '/local/vault', method: 'UI', role: 'vault owner',
    chain, network: 'network-independent local store', inputContract: 'owned record ID',
    outputContract: 'atomic deletion and unchanged unrelated records', lifecycle: 'commit and reopen',
    specificationRevision: 'fixture source', owner: 'vault', expectedResult: 'owned record deleted',
    prerequisites: ['unlocked vault'], inputs: ['record ID'], execution: ['delete and reopen'],
    assertions: ['unrelated record retained'], sources };
  const roster = reconcileOperations({ operationDenominatorReconciled: false, rows: [{ id: 'historic', evidence: ['preserved'] }] },
    { schemaVersion: 'universe-semantic-operation-review-v1', operations: [operation],
      mappings: [{ candidateId: 'historic', operationIds: [operation.id], reason: 'actual fixture handler', sources }] }, () => source);
  const rosterBytes = encode(roster);
  const candidate = protocolEnvelope?.candidate ?? { artifactCommit: 'a'.repeat(40), sourceSha: 'b'.repeat(40), configurationDigest: 'c'.repeat(64), dependencyRevision: 'lock revision' };
  const protocolBytes = encode(protocolEnvelope ?? { candidate });
  const componentBindings = ['frontend', 'backend', 'gateway', 'overlay'].map(component => ({ component,
    revision: component === 'overlay' ? candidate.sourceSha : candidate.artifactCommit,
    artifactSha256: 'd'.repeat(64), configurationSha256: 'e'.repeat(64) }));
  const receipt = { schemaVersion: 'universe-functional-operation-receipt-v1', operationId: operation.id, operation,
    candidateIdentitySha256: digest(encode(candidate)), componentBindingsSha256: digest(encode(componentBindings)),
    command: 'controlled regression command', environment: 'fixture only; no real acceptance', ranAt: new Date().toISOString(),
    qualificationScope: 'functional', mainnetFunctionalTest: false,
    testContext: { chain: 'local', network: 'offline', justification: 'local vault persistence has no blockchain effect' },
    phases: Object.fromEntries(['execution', 'authoritativeReadback', 'consumer', 'refreshRecovery'].map(phase => [phase,
      { result: 'PASS', observation: 'controlled test observation' }])),
    assertions: [{ assertion: operation.assertions[0], result: 'PASS', observation: 'other ID present after reopen' }] };
  let receiptBytes = encode(receipt);
  const acceptance = { schemaVersion: 'universe-application-acceptance-v1', rosterSha256: digest(rosterBytes),
    protocolAcceptanceSha256: digest(protocolBytes), candidate, componentBindings,
    operations: [{ id: operation.id, result: 'PASS', files: [{ path: 'docs/acceptance/evidence/application/receipt.json', sha256: digest(receiptBytes) }] }] };
  return { roster, rosterBytes, acceptance, receipt, protocolBytes, get receiptBytes() { return receiptBytes; },
    updateReceipt() { receiptBytes = encode(receipt); acceptance.operations[0].files[0].sha256 = digest(receiptBytes); },
    run(bytes = rosterBytes) { return qualifyApplication(bytes, acceptance, protocolBytes, candidate.artifactCommit, () => receiptBytes); } };
}
