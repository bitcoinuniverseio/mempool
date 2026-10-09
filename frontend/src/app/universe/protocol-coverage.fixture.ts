// Test-only synthetic metadata. This is not deployable acceptance evidence.
import { readFileSync } from 'node:fs';
import { ExplorerProtocolDefinition, FunctionalAcceptanceBindingV1, FunctionalAcceptanceBindingV2, FunctionalAcceptanceContext, ProtocolFunctionalAcceptanceV2, ProtocolsResponse } from './universe.types';

export function qualifiedCoverageFixture(): ProtocolsResponse {
  const pinned = JSON.parse(readFileSync(new URL('../../../../docs/protocols/PROTOCOL-COVERAGE.json', import.meta.url), 'utf8')) as ProtocolsResponse;
  const h = 'b'.repeat(64);
  const binding: FunctionalAcceptanceBindingV1 = {
    schemaVersion: 'universe-functional-acceptance-binding-v1', state: 'qualified', chain: 'bitcoin', acceptanceNetwork: 'signet', deploymentNetwork: 'mainnet',
    sourceSha: 'a'.repeat(40), artifactCommit: 'c'.repeat(40), registryVersion: pinned.registryVersion,
    dependencyRevision: 'dependency-test-tag', configurationDigest: h, specificationRevisions: ['spec-test-v1'],
    evidenceEnvelopeSha256: h, validatorSha256: h, projectionSha256: h, sealedManifestSha256: h,
    applicationOperationDenominator: 600, applicationOperationIdsSha256: h, applicationRosterSha256: h, applicationAcceptanceSha256: h, applicationEvidenceClosureSha256: h,
    requiredCoverageCount: 632, requiredCoverageIdsSha256: h, requiredCoverageSnapshotSha256: h,
  };
  const protocols = pinned.protocols.map(protocol => {
    const rows = (protocol.readOperationDescriptors ?? []).flatMap(descriptor => {
      const variants = descriptor.requiredVariants ?? descriptor.variants;
      return (!Array.isArray(variants) || !variants.length ? ['default'] : [...new Set(variants.filter(variant => typeof variant === 'string' && variant))]).map(variant => ({
        operation: descriptor.id, variant, role: 'candidate-test-role', result: 'PASS' as const, ranAt: '2026-10-09T12:00:00.000Z', specificationRevision: 'spec-test-v1',
        evidencePolicyVersion: 2 as const,
        checkpoint: descriptor.id === 'registry' && descriptor.evidencePolicy?.checkpoint === 'not-required' ? null : { heightAtomic: '325621', blockHash: h },
        evidence: [{ path: 'evidence/test-only.json', sha256: h }],
      }));
    });
    return { ...protocol, functionalAcceptance: {
      schemaVersion: 'universe-protocol-functional-acceptance-v1' as const, protocol: protocol.id, chain: protocol.chain,
      acceptanceNetwork: binding.acceptanceNetwork, deploymentNetwork: binding.deploymentNetwork, registryVersion: binding.registryVersion,
      sourceSha: binding.sourceSha, artifactCommit: binding.artifactCommit, dependencyRevision: binding.dependencyRevision, configurationDigest: binding.configurationDigest,
      specificationRevisions: [...binding.specificationRevisions], evidenceEnvelopeSha256: h,
      configurationProof: { network: 'mainnet', configurationDigest: h, sourceRevision: 'config-test-tag', assertions: ['Synthetic test assertion'], evidence: [{ path: 'evidence/config-test-only.json', sha256: h }] },
      declared: rows.length, applicable: rows.length, passed: rows.length, failed: 0, blocked: 0, notApplicable: 0, notTested: 0, rows,
      applicationQualification: { operationDenominator: 600, operationIdsSha256: h, rosterSha256: h, acceptanceSha256: h, evidenceClosureSha256: h, requiredCoverageCount: 632, requiredCoverageIdsSha256: h, requiredCoverageSnapshotSha256: h },
    } } satisfies ExplorerProtocolDefinition;
  });
  return { ...pinned, sourceSha: binding.sourceSha, functionalAcceptanceBinding: binding, protocols };
}


export function qualifiedMixedCoverageFixture(): ProtocolsResponse {
  const response = qualifiedCoverageFixture();
  const old = response.functionalAcceptanceBinding as FunctionalAcceptanceBindingV1;
  const proof = { path: 'evidence/context-map-test.json', sha256: 'b'.repeat(64) };
  const contexts: FunctionalAcceptanceContext[] = ['bitcoin', 'fractal', 'dogecoin', 'zcash'].map((chain, index) => {
    const h = String(index + 1).repeat(64);
    return { id: chain + '-test', chain, acceptanceNetwork: chain === 'bitcoin' ? 'signet' : 'testnet', deploymentNetwork: 'mainnet', acceptanceProfileDigest: h, deploymentConfigurationDigest: h,
      ...(chain !== 'bitcoin' ? { justification: 'Synthetic governing test-network context' } : {}),
      profileProof: { path: 'evidence/' + chain + '-profile.json', sha256: h }, configurationProof: { chain, network: 'mainnet', configurationDigest: h, sourceRevision: old.sourceSha, acceptanceProfileDigest: h, assertions: ['Synthetic bound configuration'], evidence: [proof] } };
  });
  const btc = contexts[0];
  contexts.push({ ...structuredClone(btc), id: 'bitcoin-testnet', acceptanceNetwork: 'testnet', justification: 'Synthetic tested Mainnet/Testnet-only protocol context' });
  const operationContexts = response.protocols.flatMap(protocol => protocol.functionalAcceptance.rows.map((row, index) => ({ protocol: protocol.id, operation: row.operation, variant: row.variant,
    contextId: protocol.chain === 'bitcoin' && (['dust20', 'block20'].includes(protocol.id) || protocol.id === response.protocols[0].id && index === 1) ? 'bitcoin-testnet' : protocol.chain + '-test' })));
  const { acceptanceNetwork: _network, ...base } = old;
  const binding: FunctionalAcceptanceBindingV2 = { ...base, schemaVersion: 'universe-functional-acceptance-binding-v2', contexts, operationContexts,
    applicationContexts: Array.from({ length: old.applicationOperationDenominator }, (_, index) => ({ operationId: 'synthetic:semantic-operation:' + index, contextIds: [contexts[index % contexts.length].id] })),
    acceptanceContextsSha256: 'b'.repeat(64), contextBindingProof: proof };
  response.functionalAcceptanceBinding = binding;
  response.protocols = response.protocols.map(protocol => {
    const prior = protocol.functionalAcceptance;
    if (prior.schemaVersion !== 'universe-protocol-functional-acceptance-v1') throw Error('Fixture version drift');
    const { acceptanceNetwork: _acceptance, configurationProof: _proof, ...claim } = prior;
    const rows = prior.rows.map(row => ({ ...row, contextId: operationContexts.find(assignment => assignment.protocol === protocol.id && assignment.operation === row.operation && assignment.variant === row.variant).contextId }));
    const referenced = new Set(rows.map(row => row.contextId));
    const functionalAcceptance: ProtocolFunctionalAcceptanceV2 = { ...claim, schemaVersion: 'universe-protocol-functional-acceptance-v2', declaredOperations: protocol.readOperationDescriptors.length, declaredOperationVariants: rows.length, evidenceCells: rows.length, rows, contexts: structuredClone(contexts.filter(context => referenced.has(context.id))), acceptanceContextsSha256: binding.acceptanceContextsSha256 };
    return { ...protocol, functionalAcceptance };
  });
  return response;
}
