import { describe, expect, it } from 'vitest';
import { protocolCoverageView } from './protocol-coverage';
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
