import { describe, expect, it } from 'vitest';
import { protocolCoverageView } from './protocol-coverage';
import { qualifiedCoverageFixture, qualifiedMixedCoverageFixture } from './protocol-coverage.fixture';
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


describe('mixed-chain and multi-profile v2 acceptance', () => {
  const now = Date.parse('2026-10-09T13:00:00Z');
  it('keeps every 39/123 identity and names exact per-chain tested contexts', () => {
    const response = qualifiedMixedCoverageFixture();
    expect(response.protocols).toHaveLength(39);
    expect(response.protocols.reduce((n, row) => n + row.readOperationDescriptors.length, 0)).toBe(123);
    for (const row of response.protocols) {
      response.functionalAcceptanceBinding.chain = row.chain;
      const view = protocolCoverageView(row, response, 'mainnet', now);
      expect(view.functionalKnown).toBe(true);
      expect(view.functionalLabel).toContain(row.chain === 'bitcoin' ? 'Bitcoin' : row.chain === 'fractal' ? 'Fractal Bitcoin Testnet' : row.chain === 'dogecoin' ? 'Dogecoin Testnet' : 'Zcash Testnet');
      expect(view.functionalLabel).toContain('2026-10-09');
    }
    expect(protocolCoverageView(response.protocols[0], { ...response, functionalAcceptanceBinding: { ...response.functionalAcceptanceBinding, chain: 'bitcoin' } }, 'mainnet', now).functionalLabel).toContain('Bitcoin Signet and Bitcoin Testnet');
  });
  it.each([
    ['ambiguous scalar network', r => { r.protocols[0].functionalAcceptance.acceptanceNetwork = 'signet'; }],
    ['claim context digest', r => { r.protocols[0].functionalAcceptance.acceptanceContextsSha256 = 'a'.repeat(64); }],
    ['malformed claim context', r => { r.protocols[0].functionalAcceptance.contexts = [null]; }],
    ['missing claim context', r => { r.protocols[0].functionalAcceptance.contexts.pop(); }],
    ['extra claim context', r => { r.protocols[0].functionalAcceptance.contexts.push(r.functionalAcceptanceBinding.contexts.find(c => c.chain === 'zcash')); }],
    ['claim profile', r => { r.protocols[0].functionalAcceptance.contexts[0].acceptanceProfileDigest = 'a'.repeat(64); }],
    ['wrong row context', r => { r.protocols[0].functionalAcceptance.rows[0].contextId = 'dogecoin-test'; }],
    ['duplicate context', r => { r.functionalAcceptanceBinding.contexts.push(r.functionalAcceptanceBinding.contexts[0]); }],
    ['Doge Signet', r => { r.functionalAcceptanceBinding.contexts.find(c => c.chain === 'dogecoin').acceptanceNetwork = 'signet'; }],
    ['profile proof hash', r => { r.functionalAcceptanceBinding.contexts[0].profileProof.sha256 = 'a'.repeat(64); }],
    ['context source revision', r => { r.functionalAcceptanceBinding.contexts[0].configurationProof.sourceRevision = 'd'.repeat(40); }],
    ['context deployment network', r => { r.functionalAcceptanceBinding.contexts[0].deploymentNetwork = 'testnet'; }],
    ['context config proof', r => { r.functionalAcceptanceBinding.contexts[0].configurationProof.chain = 'dogecoin'; }],
    ['missing mapping', r => { r.functionalAcceptanceBinding.operationContexts.pop(); }],
    ['duplicate mapping', r => { r.functionalAcceptanceBinding.operationContexts.push(r.functionalAcceptanceBinding.operationContexts[0]); }],
    ['indexed offline assignment', r => { r.functionalAcceptanceBinding.contexts[0].chain = 'local'; r.functionalAcceptanceBinding.contexts[0].acceptanceNetwork = 'offline'; }],
    ['application context missing', r => { r.functionalAcceptanceBinding.applicationContexts.pop(); }],
    ['application context duplicate', r => { r.functionalAcceptanceBinding.applicationContexts[0].contextIds.push(r.functionalAcceptanceBinding.applicationContexts[0].contextIds[0]); }],
    ['application unknown context', r => { r.functionalAcceptanceBinding.applicationContexts[0].contextIds = ['unqualified']; }],
    ['descriptor vs variant count', r => { r.protocols[0].functionalAcceptance.declaredOperations++; }],
    ['variant vs evidence count', r => { r.protocols[0].functionalAcceptance.declaredOperationVariants++; }],
    ['wrong evidence cells', r => { r.protocols[0].functionalAcceptance.evidenceCells--; }],
    ['v1/v2 schema coercion', r => { r.functionalAcceptanceBinding.schemaVersion = 'universe-functional-acceptance-binding-v1'; }],
  ] as [string, (r: any) => void][])('rejects %s', (_name, mutate) => {
    const response = qualifiedMixedCoverageFixture(); mutate(response);
    expect(protocolCoverageView(response.protocols[0], response, 'mainnet', now).functionalKnown).toBe(false);
  });
  it('preserves two evidence cells for two required variants of one descriptor', () => {
    const response = qualifiedMixedCoverageFixture(); const row = response.protocols[0];
    const claim = row.functionalAcceptance;
    if (claim.schemaVersion !== 'universe-protocol-functional-acceptance-v2' || response.functionalAcceptanceBinding.schemaVersion !== 'universe-functional-acceptance-binding-v2') throw Error('Wrong fixture');
    const op = row.readOperationDescriptors[0]; op.requiredVariants = ['default', 'recovery'];
    claim.rows.push({ ...structuredClone(claim.rows[0]), variant: 'recovery' });
    response.functionalAcceptanceBinding.operationContexts.push({ protocol: row.id, operation: op.id, variant: 'recovery', contextId: claim.rows[0].contextId });
    claim.declaredOperationVariants++; claim.evidenceCells++; claim.declared++; claim.applicable++; claim.passed++;
    expect(claim.declaredOperations).toBe(row.readOperationDescriptors.length);
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalKnown).toBe(true);
    claim.rows.pop();
    expect(protocolCoverageView(row, response, 'mainnet', now).functionalKnown).toBe(false);
  });
});


it('names multiple qualified profiles even when their network labels coincide', () => {
  const response = qualifiedMixedCoverageFixture();
  if (response.functionalAcceptanceBinding.schemaVersion !== 'universe-functional-acceptance-binding-v2' || response.protocols[0].functionalAcceptance.schemaVersion !== 'universe-protocol-functional-acceptance-v2') throw Error('Fixture schema mismatch');
  const binding = response.functionalAcceptanceBinding;
  const extra = binding.contexts.find(context => context.id === 'bitcoin-testnet');
  extra.acceptanceNetwork = 'signet'; extra.acceptanceProfileDigest = 'f'.repeat(64); extra.profileProof.sha256 = extra.acceptanceProfileDigest; extra.configurationProof.acceptanceProfileDigest = extra.acceptanceProfileDigest;
  const claim = response.protocols[0].functionalAcceptance;
  claim.contexts = structuredClone(binding.contexts.filter(context => claim.rows.some(row => row.contextId === context.id)));
  expect(protocolCoverageView(response.protocols[0], response, 'mainnet', Date.parse('2026-10-09T13:00:00Z')).functionalLabel).toBe('Functionality verified on Bitcoin Signet (2 test profiles) (2026-10-09)');
});


describe('v2 static application local/offline exception', () => {
  const now = Date.parse('2026-10-09T13:00:00Z');
  it('accepts the full 39/123 metadata and 632 commitment with a local app context beside Mainnet deployments', () => {
    const response = qualifiedMixedCoverageFixture();
    const binding = response.functionalAcceptanceBinding;
    if (binding.schemaVersion !== 'universe-functional-acceptance-binding-v2') throw Error('Fixture version');
    expect(response.protocols).toHaveLength(39);
    expect(response.protocols.reduce((n, protocol) => n + protocol.readOperationDescriptors.length, 0)).toBe(123);
    expect(binding.requiredCoverageCount).toBe(632);
    expect(binding.contexts.find(context => context.id === 'local-offline').deploymentNetwork).toBe('offline');
    expect(binding.applicationContexts.some(assignment => assignment.contextIds.includes('local-offline'))).toBe(true);
    expect(binding.operationContexts.some(assignment => assignment.contextId === 'local-offline')).toBe(false);
    for (const protocol of response.protocols) {
      binding.chain = protocol.chain;
      expect(protocolCoverageView(protocol, response, 'mainnet', now).functionalKnown).toBe(true);
    }
  });
  it('rejects a local context substituted into both claim and top-level indexed operation mapping', () => {
    const response = qualifiedMixedCoverageFixture();
    const claim = response.protocols[0].functionalAcceptance, binding = response.functionalAcceptanceBinding;
    if (claim.schemaVersion !== 'universe-protocol-functional-acceptance-v2' || binding.schemaVersion !== 'universe-functional-acceptance-binding-v2') throw Error('Fixture version');
    const row = claim.rows.find(item => item.operation !== 'registry');
    row.contextId = 'local-offline';
    binding.operationContexts.find(item => item.protocol === claim.protocol && item.operation === row.operation && item.variant === row.variant).contextId = 'local-offline';
    claim.contexts = structuredClone(binding.contexts.filter(context => claim.rows.some(item => item.contextId === context.id)));
    expect(protocolCoverageView(response.protocols[0], response, 'mainnet', now).functionalKnown).toBe(false);
  });
  it('rejects a local profile labelled Mainnet or an indexed chain labelled offline even if claim and binding agree', () => {
    for (const localOnMainnet of [true, false]) {
      const response = qualifiedMixedCoverageFixture();
      const binding = response.functionalAcceptanceBinding;
      if (binding.schemaVersion !== 'universe-functional-acceptance-binding-v2') throw Error('Fixture version');
      const context = binding.contexts.find(item => item.id === (localOnMainnet ? 'local-offline' : 'bitcoin-test'));
      context.deploymentNetwork = localOnMainnet ? 'mainnet' : 'offline'; context.configurationProof.network = context.deploymentNetwork;
      for (const protocol of response.protocols) {
        const claim = protocol.functionalAcceptance;
        if (claim.schemaVersion !== 'universe-protocol-functional-acceptance-v2') throw Error('Fixture version');
        claim.contexts = structuredClone(binding.contexts.filter(item => claim.rows.some(row => row.contextId === item.id)));
      }
      expect(protocolCoverageView(response.protocols[0], response, 'mainnet', now).functionalKnown).toBe(false);
    }
  });
});
