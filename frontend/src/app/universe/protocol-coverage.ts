import { ExplorerProtocolDefinition, ProtocolsResponse } from './universe.types';

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512 && Array.from(value).every(character => character.charCodeAt(0) >= 32);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): boolean => typeof value === 'string' && HASH.test(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const files = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(file => object(file) && text(file.path) && !file.path.startsWith('/') && !file.path.includes('\\') && !file.path.includes(':') && file.path.split('/').every(part => part !== '..' && part !== '.' && part !== '') && hash(file.sha256));
const count = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;
const time = (value: unknown, now: number): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {return false;}
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > now + 5000) {return false;}
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(value);
  if (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59)) {return false;}
  const minutes = offset ? (offset[1] === '+' ? 1 : -1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  return new Date(parsed + minutes * 60000).toISOString().slice(0, 19) === value.slice(0, 19);
};

const testNetworks: Record<string, readonly string[]> = {
  bitcoin: ['signet', 'testnet', 'testnet4'], dogecoin: ['testnet'], zcash: ['testnet'], fractal: ['testnet'], liquid: ['testnet'], local: ['offline'],
};
const variantsFor = (operation: { requiredVariants?: string[]; variants?: string[] }): string[] => {
  const variants = operation.requiredVariants ?? operation.variants;
  return !Array.isArray(variants) || !variants.length ? ['default'] : [...new Set(variants.filter(variant => typeof variant === 'string' && variant))];
};

/** Trust boundary: the server qualifies and seals the raw binding maps.
 * This client checks request scope, structure and claim/map agreement. It does
 * not recompute acceptanceContextsSha256, authenticate the server or read proof
 * bytes. Mutating a claim alone cannot substitute the server's mapped profile;
 * cryptographic map integrity remains the sealed loader's responsibility.
 */
function v2Assignments(protocol: ExplorerProtocolDefinition, registry: ProtocolsResponse, binding: Record<string, unknown>, claim: Record<string, unknown>, network: string): Map<string, string> | null {
  if ('acceptanceNetwork' in binding || 'acceptanceNetwork' in claim || 'configurationProof' in claim || !hash(binding.acceptanceContextsSha256) || claim.acceptanceContextsSha256 !== binding.acceptanceContextsSha256 || !files([binding.contextBindingProof]) || !Array.isArray(binding.contexts) || !binding.contexts.length || !Array.isArray(binding.operationContexts) || !Array.isArray(binding.applicationContexts) || !Array.isArray(claim.contexts)) {return null;}
  const contexts = new Map<string, Record<string, unknown>>();
  for (const context of binding.contexts) {
    const localOffline = object(context) && context.chain === 'local' && context.acceptanceNetwork === 'offline' && context.deploymentNetwork === 'offline';
    if (!object(context) || !text(context.id) || contexts.has(context.id) || !text(context.chain) || !testNetworks[context.chain]?.includes(String(context.acceptanceNetwork)) || (context.chain === 'local' ? !localOffline : context.deploymentNetwork !== binding.deploymentNetwork) || !hash(context.acceptanceProfileDigest) || !hash(context.deploymentConfigurationDigest) || !files([context.profileProof]) || !object(context.profileProof) || context.profileProof.sha256 !== context.acceptanceProfileDigest) {return null;}
    const proof = context.configurationProof;
    if (!object(proof) || proof.chain !== context.chain || proof.network !== context.deploymentNetwork || proof.configurationDigest !== context.deploymentConfigurationDigest || proof.acceptanceProfileDigest !== context.acceptanceProfileDigest || proof.sourceRevision !== binding.sourceSha || !Array.isArray(proof.assertions) || !proof.assertions.length || !files(proof.evidence) || context.acceptanceNetwork !== 'signet' && !text(context.justification)) {return null;}
    contexts.set(context.id, context);
  }
  const required = new Map<string, ExplorerProtocolDefinition>();
  for (const definition of registry.protocols) {
    if (!Array.isArray(definition.readOperationDescriptors)) {return null;}
    for (const descriptor of definition.readOperationDescriptors) {
      if (!object(descriptor) || !text(descriptor.id)) {return null;}
      for (const variant of variantsFor(descriptor)) {
        const key = JSON.stringify([definition.id, descriptor.id, variant]);
        if (required.has(key)) {return null;}
        required.set(key, definition);
      }
    }
  }
  const assignments = new Map<string, string>();
  const selected = new Map<string, string>();
  const used = new Set<string>();
  for (const assignment of binding.operationContexts) {
    if (!object(assignment) || !text(assignment.protocol) || !text(assignment.operation) || !text(assignment.variant) || !text(assignment.contextId)) {return null;}
    const key = JSON.stringify([assignment.protocol, assignment.operation, assignment.variant]);
    const definition = required.get(key);
    const context = contexts.get(assignment.contextId);
    if (!definition || !context || context.chain !== definition.chain || assignments.has(key)) {return null;}
    assignments.set(key, assignment.contextId); used.add(assignment.contextId);
    if (definition.id === protocol.id) {
      if (context.deploymentNetwork !== network) {return null;}
      selected.set(JSON.stringify([assignment.operation, assignment.variant]), assignment.contextId);
    }
  }
  if (assignments.size !== required.size || binding.applicationContexts.length !== binding.applicationOperationDenominator) {return null;}
  const applicationIds = new Set<string>();
  for (const assignment of binding.applicationContexts) {
    if (!object(assignment) || !text(assignment.operationId) || applicationIds.has(assignment.operationId) || !Array.isArray(assignment.contextIds) || !assignment.contextIds.length || new Set(assignment.contextIds).size !== assignment.contextIds.length || assignment.contextIds.some(id => !text(id) || !contexts.has(id))) {return null;}
    applicationIds.add(assignment.operationId); assignment.contextIds.forEach(id => used.add(id));
  }
  if (used.size !== contexts.size) {return null;}
  const references = new Set(selected.values());
  const claimed = new Set<string>();
  for (const context of claim.contexts) {
    if (!object(context) || !text(context.id) || !references.has(context.id) || claimed.has(context.id) || !same(context, contexts.get(context.id))) {return null;}
    claimed.add(context.id);
  }
  return claimed.size === references.size && references.size > 0 ? selected : null;
}

/** Metadata is authorized by the backend's sealed artifact qualifier. The UI
 * checks scope, independent bindings and the exact declaration again; it does
 * not turn source readiness, historical labels or global counters into proof.
 */
function acceptedDate(protocol: ExplorerProtocolDefinition, registry: ProtocolsResponse | undefined, network: string | undefined, now: number): string | null {
  const value: unknown = protocol.functionalAcceptance;
  const expected: unknown = registry?.functionalAcceptanceBinding;
  if (!object(value) || !object(expected) || expected.state !== 'qualified' || !text(network) || expected.chain !== protocol.chain || expected.deploymentNetwork !== network || value.protocol !== protocol.id || value.chain !== protocol.chain || value.deploymentNetwork !== network) {return null;}
  const v2 = value.schemaVersion === 'universe-protocol-functional-acceptance-v2' && expected.schemaVersion === 'universe-functional-acceptance-binding-v2';
  if (!v2 && (value.schemaVersion !== 'universe-protocol-functional-acceptance-v1' || expected.schemaVersion !== 'universe-functional-acceptance-binding-v1' || expected.acceptanceNetwork !== value.acceptanceNetwork || !['signet', 'testnet', 'testnet4', 'regtest'].includes(String(value.acceptanceNetwork)))) {return null;}
  if (!registry || !Array.isArray(registry.protocols) || registry.protocols.some(row => !object(row)) || registry.protocols.filter(row => object(row) && row.id === protocol.id && row.chain === protocol.chain).length !== 1 || expected.registryVersion !== registry.registryVersion || expected.sourceSha !== registry.sourceSha || typeof expected.sourceSha !== 'string' || !COMMIT.test(expected.sourceSha) || typeof expected.artifactCommit !== 'string' || !COMMIT.test(expected.artifactCommit) || !text(expected.dependencyRevision) || !hash(expected.configurationDigest) || !hash(expected.evidenceEnvelopeSha256) || !hash(expected.applicationOperationIdsSha256) || !count(expected.applicationOperationDenominator) || Number(expected.applicationOperationDenominator) < 1) {return null;}
  if (['validatorSha256', 'projectionSha256', 'sealedManifestSha256', 'applicationRosterSha256', 'applicationAcceptanceSha256', 'applicationEvidenceClosureSha256', 'requiredCoverageIdsSha256', 'requiredCoverageSnapshotSha256'].some(key => !hash(expected[key])) || !count(expected.requiredCoverageCount) || Number(expected.requiredCoverageCount) < 1) {return null;}
  const assignments = v2 ? v2Assignments(protocol, registry, expected, value, network) : null;
  if (v2 && !assignments) {return null;}
  const specs = expected.specificationRevisions;
  if (!Array.isArray(specs) || !specs.length || specs.some(spec => !text(spec)) || new Set(specs).size !== specs.length) {return null;}
  for (const key of ['sourceSha', 'artifactCommit', 'registryVersion', 'dependencyRevision', 'configurationDigest', 'specificationRevisions', 'evidenceEnvelopeSha256']) {if (!same(value[key], expected[key])) {return null;}}
  const application = value.applicationQualification;
  if (!object(application) || application.operationDenominator !== expected.applicationOperationDenominator || application.operationIdsSha256 !== expected.applicationOperationIdsSha256 || ['operationIdsSha256', 'rosterSha256', 'acceptanceSha256', 'evidenceClosureSha256'].some(key => !hash(application[key]))) {return null;}
  if (application.rosterSha256 !== expected.applicationRosterSha256 || application.acceptanceSha256 !== expected.applicationAcceptanceSha256 || application.evidenceClosureSha256 !== expected.applicationEvidenceClosureSha256 || application.requiredCoverageCount !== expected.requiredCoverageCount || application.requiredCoverageIdsSha256 !== expected.requiredCoverageIdsSha256 || application.requiredCoverageSnapshotSha256 !== expected.requiredCoverageSnapshotSha256) {return null;}
  if (!v2 && value.acceptanceNetwork !== value.deploymentNetwork) {
    const proof = value.configurationProof;
    if (!object(proof) || proof.network !== network || proof.configurationDigest !== expected.configurationDigest || !text(proof.sourceRevision) || !Array.isArray(proof.assertions) || !proof.assertions.length || !files(proof.evidence)) {return null;}
  }
  const descriptors = protocol.readOperationDescriptors;
  if (!Array.isArray(descriptors) || !descriptors.length || descriptors.some(row => !object(row) || !text(row.id) || row.acceptance === 'NOT APPLICABLE') || new Set(descriptors.map(row => row.id)).size !== descriptors.length || !Array.isArray(value.rows)) {return null;}
  const keys = new Map<string, typeof descriptors[number]>();
  for (const descriptor of descriptors) {
    const variants = descriptor.requiredVariants ?? descriptor.variants;
    // Same default and deduplication rules as protocol-contract requiredVariants.
    const required = !Array.isArray(variants) || !variants.length ? ['default'] : [...new Set(variants.filter(variant => typeof variant === 'string' && variant))];
    for (const variant of required) {keys.set(JSON.stringify([descriptor.id, variant]), descriptor);}
  }
  const seen = new Set<string>();
  const dates: string[] = [];
  for (const row of value.rows) {
    if (!object(row) || !text(row.operation) || !text(row.variant)) {return null;}
    const key = JSON.stringify([row.operation, row.variant]);
    if (v2 && row.contextId !== assignments.get(key)) {return null;}
    const descriptor = keys.get(key);
    if (!descriptor || seen.has(key) || row.result !== 'PASS' || !text(row.role) || !time(row.ranAt, now) || !specs.includes(row.specificationRevision) || !files(row.evidence)) {return null;}
    const staticRegistry = row.evidencePolicyVersion === 2 && descriptor.id === 'registry' && descriptor.method === 'GET' && descriptor.route === '/api/v1/universe/protocols' && descriptor.authorityPath === null && descriptor.evidencePolicy?.version === 2 && descriptor.evidencePolicy.checkpoint === 'not-required';
    const checkpoint = row.checkpoint;
    if (!(staticRegistry && checkpoint === null)) {
      if (!object(checkpoint) || !hash(checkpoint.blockHash) || !(Number.isSafeInteger(checkpoint.height) && Number(checkpoint.height) >= 0 || typeof checkpoint.heightAtomic === 'string' && /^(?:0|[1-9][0-9]*)$/.test(checkpoint.heightAtomic))) {return null;}
    }
    seen.add(key); dates.push(row.ranAt);
  }
  if (v2 && (value.declaredOperations !== descriptors.length || value.declaredOperationVariants !== keys.size || value.evidenceCells !== value.rows.length)) {return null;}
  if (!keys.size || seen.size !== keys.size || ['declared', 'applicable', 'passed', 'failed', 'blocked', 'notTested', 'notApplicable'].some(key => !count(value[key])) || value.declared !== keys.size || value.applicable !== keys.size || value.passed !== keys.size || value.failed !== 0 || value.blocked !== 0 || value.notTested !== 0 || value.notApplicable !== 0) {return null;}
  // Name the oldest operation observation, not a receipt/registry response time.
  return new Date(Math.min(...dates.map(date => Date.parse(date)))).toISOString().slice(0, 10);
}

export function protocolCoverageView(protocol: ExplorerProtocolDefinition, registry?: ProtocolsResponse, network?: string, now = Date.now()): { functionalLabel: string; functionalKnown: boolean; historicalLabel: string | null } {
  const declaration = typeof protocol.coverage === 'string' ? protocol.coverage : typeof protocol.coverage?.state === 'string' ? protocol.coverage.state : null;
  const historical = declaration?.trim();
  const label = historical ? historical.replace(/[_-]/g, ' ').replace(/\b\w/g, character => character.toUpperCase()) : null;
  const date = acceptedDate(protocol, registry, network, now);
  const claim = protocol.functionalAcceptance;
  const acceptanceNetwork = claim?.schemaVersion === 'universe-protocol-functional-acceptance-v1' ? claim.acceptanceNetwork : null;
  const testedOn = acceptanceNetwork === 'signet' ? 'Signet' : acceptanceNetwork === 'testnet4' ? 'Testnet4' : acceptanceNetwork === 'regtest' ? 'Regtest' : 'Testnet';
  const names: Record<string, string> = { bitcoin: 'Bitcoin', dogecoin: 'Dogecoin', zcash: 'Zcash', fractal: 'Fractal Bitcoin', liquid: 'Liquid' };
  const tested = new Map<string, number>();
  if (date && claim?.schemaVersion === 'universe-protocol-functional-acceptance-v2' && Array.isArray(claim.contexts)) {
    for (const context of claim.contexts) {
      const title = `${names[context.chain] ?? context.chain} ${context.acceptanceNetwork === 'signet' ? 'Signet' : context.acceptanceNetwork === 'testnet4' ? 'Testnet4' : 'Testnet'}`;
      tested.set(title, (tested.get(title) ?? 0) + 1);
    }
  }
  const testedScopes = tested.size ? [...tested].sort(([a], [b]) => a.localeCompare(b)).map(([title, profiles]) => profiles > 1 ? `${title} (${profiles} test profiles)` : title).join(' and ') : testedOn;
  return {
    functionalLabel: date ? $localize`:@@universe.protocols.functional-verified:Functionality verified on ${testedScopes}:network: (${date}:date:)` : $localize`:@@universe.protocols.functional-unverified:Functional coverage: Unverified`,
    functionalKnown: date !== null,
    historicalLabel: label ? $localize`:@@universe.protocols.historical-declaration:Historical registry declaration: ${label}:declaration:` : null,
  };
}
