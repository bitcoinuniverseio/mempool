import { describe, expect, it } from 'vitest';
import { protocolCoverageView } from './protocol-coverage';
import { qualifiedCoverageFixture } from './protocol-coverage.fixture';
import { ExplorerProtocolDefinition } from './universe.types';

const protocol = {
  schemaVersion: 'universe-explorer-protocol-v1', id: 'ordinals', aliases: [],
  displayName: 'Ordinals', shortName: 'Ordinals', family: 'ORDINALS', chain: 'bitcoin',
  networks: ['signet'], icon: 'protocol-ordinals', visualToken: 'protocol-ordinals',
  implementedReadOperations: ['registry'], authorizedReadOperations: [],
  releaseStatus: 'VERIFIED READ ONLY', coverage: 'complete',
} satisfies ExplorerProtocolDefinition;

describe('shared functional protocol coverage', () => {
  it('retains a historical complete declaration but not a completion claim', () => {
    expect(protocolCoverageView(protocol)).toEqual({
      functionalLabel: 'Functional coverage: Unverified', functionalKnown: false,
      historicalLabel: 'Historical registry declaration: Complete',
    });
  });

  it.each(['NOT TESTED', 'PASS'] as const)('does not qualify source-contract %s', acceptance => {
    const row: ExplorerProtocolDefinition = { ...protocol, readOperationDescriptors: [
      { id: 'registry', method: 'GET', route: '/api/v1/universe/protocols', authorityPath: null, evidence: 'source-contract', acceptance },
    ] };
    expect(protocolCoverageView(row).functionalKnown).toBe(false);
  });

  it.each([
    { network: 'mainnet', registryRevision: 'old', passed: 123, applicable: 123 },
    { network: 'signet', registryRevision: 'current', passed: 123, applicable: 123 },
  ])('does not promote unknown extra network/revision/count fields', acceptance => {
    // The current wire contract has no such per-protocol summary. Even an
    // apparent match in unrecognized metadata is not a qualified contract.
    const row = { ...protocol, acceptance, sourceReady: true };
    expect(protocolCoverageView(row).functionalLabel).toBe('Functional coverage: Unverified');
    expect(protocolCoverageView(row).functionalKnown).toBe(false);
  });
});


describe('sealed functional acceptance display contract', () => {
  const now = Date.parse('2026-10-09T13:00:00.000Z');
  it('retains the full 39/123 declaration and names the actual test network/date on Mainnet', () => {
    const response = qualifiedCoverageFixture();
    expect(response.protocols).toHaveLength(39);
    expect(response.protocols.reduce((sum, row) => sum + (row.readOperationDescriptors?.length ?? 0), 0)).toBe(123);
    for (const row of response.protocols) {
      // Each independent chain scope may consume the same complete artifact.
      response.functionalAcceptanceBinding.chain = row.chain;
      expect(protocolCoverageView(row, response, 'mainnet', now).functionalLabel).toBe('Functionality verified on Signet (2026-10-09)');
    }
  });
  it('uses the oldest required operation date without renewing it', () => {
    const response = qualifiedCoverageFixture(); const row = response.protocols[0];
    row.functionalAcceptance.rows[0].ranAt = '2026-09-01T12:00:00.000Z';
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalLabel).toContain('2026-09-01');
  });
  it.each([
    ['absent binding', r => { delete r.functionalAcceptanceBinding; }],
    ['malformed descriptors', r => { r.protocols[0].readOperationDescriptors = [null]; }],
    ['malformed rows', r => { r.protocols[0].functionalAcceptance.rows = [null]; }],
    ['malformed protocols', r => { r.protocols = [r.protocols[0], null]; }],
    ['absent claim', r => { delete r.protocols[0].functionalAcceptance; }],
    ['binding state', r => { r.functionalAcceptanceBinding.state = 'unqualified'; }],
    ['binding source', r => { r.sourceSha = 'd'.repeat(40); }],
    ...['schemaVersion', 'sourceSha', 'artifactCommit', 'registryVersion', 'dependencyRevision', 'configurationDigest', 'evidenceEnvelopeSha256', 'acceptanceNetwork', 'deploymentNetwork', 'chain', 'protocol'].map(key => [key, r => { r.protocols[0].functionalAcceptance[key] = 'wrong'; }]),
    ['specification', r => { r.protocols[0].functionalAcceptance.specificationRevisions = ['wrong']; }],
    ['missing row', r => { r.protocols[0].functionalAcceptance.rows.pop(); }],
    ['duplicate row', r => { r.protocols[0].functionalAcceptance.rows.push(r.protocols[0].functionalAcceptance.rows[0]); }],
    ['extra variant', r => { r.protocols[0].functionalAcceptance.rows[0].variant = 'extra'; }],
    ['forged count', r => { r.protocols[0].functionalAcceptance.passed = 123; }],
    ['declared NA cannot become PASS', r => { r.protocols[0].readOperationDescriptors[0].acceptance = 'NOT APPLICABLE'; }],
    ['NA counts', r => { r.protocols[0].functionalAcceptance.notApplicable = 1; }],
    ['blocked', r => { r.protocols[0].functionalAcceptance.rows[0].result = 'BLOCKED'; }],
    ['missing evidence', r => { r.protocols[0].functionalAcceptance.rows[0].evidence = []; }],
    ['bad hash', r => { r.protocols[0].functionalAcceptance.rows[0].evidence[0].sha256 = 'hash'; }],
    ['unsafe path', r => { r.protocols[0].functionalAcceptance.rows[0].evidence[0].path = '../outside.json'; }],
    ['future time', r => { r.protocols[0].functionalAcceptance.rows[0].ranAt = '2099-01-01T00:00:00.000Z'; }],
    ['invalid calendar date', r => { r.protocols[0].functionalAcceptance.rows[0].ranAt = '2026-02-30T12:00:00Z'; }],
    ['invalid time', r => { r.protocols[0].functionalAcceptance.rows[0].ranAt = 'now'; }],
    ['null dynamic checkpoint', r => { r.protocols[0].functionalAcceptance.rows.find(row => row.operation !== 'registry').checkpoint = null; }],
    ['negative height', r => { r.protocols[0].functionalAcceptance.rows.find(row => row.operation !== 'registry').checkpoint = { heightAtomic: '-1', blockHash: 'b'.repeat(64) }; }],
    ['missing config proof', r => { r.protocols[0].functionalAcceptance.configurationProof = null; }],
    ['wrong config proof', r => { r.protocols[0].functionalAcceptance.configurationProof.network = 'signet'; }],
    ['application count', r => { r.protocols[0].functionalAcceptance.applicationQualification.operationDenominator++; }],
    ['application closure', r => { r.protocols[0].functionalAcceptance.applicationQualification.evidenceClosureSha256 = 'a'.repeat(64); }],
    ['required denominator', r => { r.protocols[0].functionalAcceptance.applicationQualification.requiredCoverageCount--; }],
    ['required snapshot', r => { r.protocols[0].functionalAcceptance.applicationQualification.requiredCoverageSnapshotSha256 = 'a'.repeat(64); }],
  ] as [string, (r: any) => void][])('rejects %s', (_name, mutate) => {
    const response = qualifiedCoverageFixture(); mutate(response);
    expect(protocolCoverageView(response.protocols[0], response, 'mainnet', now).functionalKnown).toBe(false);
  });
  it('rejects the wrong selected deployment network and Mainnet execution claims', () => {
    const response = qualifiedCoverageFixture(); const row = response.protocols[0];
    expect(protocolCoverageView(row, response, 'signet', now).functionalKnown).toBe(false);
    row.functionalAcceptance.acceptanceNetwork = 'mainnet'; response.functionalAcceptanceBinding.acceptanceNetwork = 'mainnet';
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalKnown).toBe(false);
  });
  it('requires every declared variant and the row policy for a null static registry checkpoint', () => {
    const response = qualifiedCoverageFixture(); const row = response.protocols[0];
    row.readOperationDescriptors[0].requiredVariants = ['default', 'fault'];
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalKnown).toBe(false);
    delete row.readOperationDescriptors[0].requiredVariants;
    delete row.functionalAcceptance.rows.find(item => item.operation === 'registry').evidencePolicyVersion;
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalKnown).toBe(false);
  });
});


it('accepts qualified ISO offsets and structured configuration assertions without renewing time', () => {
  const response = qualifiedCoverageFixture(); const row = response.protocols[0];
  row.functionalAcceptance.rows[0].ranAt = '2026-10-09T12:00:00.000000+00:00';
  row.functionalAcceptance.configurationProof.assertions = [{ assertion: 'Synthetic configuration binding', passed: true }];
  expect(protocolCoverageView(row, response, 'mainnet', Date.parse('2026-10-09T13:00:00Z')).functionalKnown).toBe(true);
});
