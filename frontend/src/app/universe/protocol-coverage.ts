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

/** Metadata is authorized by the backend's sealed artifact qualifier. The UI
 * checks scope, independent bindings and the exact declaration again; it does
 * not turn source readiness, historical labels or global counters into proof.
 */
function acceptedDate(protocol: ExplorerProtocolDefinition, registry: ProtocolsResponse | undefined, network: string | undefined, now: number): string | null {
  const value: unknown = protocol.functionalAcceptance;
  const expected: unknown = registry?.functionalAcceptanceBinding;
  if (!object(value) || !object(expected) || expected.schemaVersion !== 'universe-functional-acceptance-binding-v1' || expected.state !== 'qualified' || expected.chain !== protocol.chain || expected.deploymentNetwork !== network || expected.acceptanceNetwork !== value.acceptanceNetwork || value.schemaVersion !== 'universe-protocol-functional-acceptance-v1' || value.protocol !== protocol.id || value.chain !== protocol.chain || value.deploymentNetwork !== network || !['signet', 'testnet', 'testnet4', 'regtest'].includes(String(value.acceptanceNetwork))) {return null;}
  if (!registry || !Array.isArray(registry.protocols) || registry.protocols.some(row => !object(row)) || registry.protocols.filter(row => object(row) && row.id === protocol.id && row.chain === protocol.chain).length !== 1 || expected.registryVersion !== registry.registryVersion || expected.sourceSha !== registry.sourceSha || typeof expected.sourceSha !== 'string' || !COMMIT.test(expected.sourceSha) || typeof expected.artifactCommit !== 'string' || !COMMIT.test(expected.artifactCommit) || !text(expected.dependencyRevision) || !hash(expected.configurationDigest) || !hash(expected.evidenceEnvelopeSha256) || !hash(expected.applicationOperationIdsSha256) || !count(expected.applicationOperationDenominator) || Number(expected.applicationOperationDenominator) < 1) {return null;}
  if (['validatorSha256', 'projectionSha256', 'sealedManifestSha256', 'applicationRosterSha256', 'applicationAcceptanceSha256', 'applicationEvidenceClosureSha256', 'requiredCoverageIdsSha256', 'requiredCoverageSnapshotSha256'].some(key => !hash(expected[key])) || !count(expected.requiredCoverageCount) || Number(expected.requiredCoverageCount) < 1) {return null;}
  const specs = expected.specificationRevisions;
  if (!Array.isArray(specs) || !specs.length || specs.some(spec => !text(spec)) || new Set(specs).size !== specs.length) {return null;}
  for (const key of ['sourceSha', 'artifactCommit', 'registryVersion', 'dependencyRevision', 'configurationDigest', 'specificationRevisions', 'evidenceEnvelopeSha256']) {if (!same(value[key], expected[key])) {return null;}}
  const application = value.applicationQualification;
  if (!object(application) || application.operationDenominator !== expected.applicationOperationDenominator || application.operationIdsSha256 !== expected.applicationOperationIdsSha256 || ['operationIdsSha256', 'rosterSha256', 'acceptanceSha256', 'evidenceClosureSha256'].some(key => !hash(application[key]))) {return null;}
  if (application.rosterSha256 !== expected.applicationRosterSha256 || application.acceptanceSha256 !== expected.applicationAcceptanceSha256 || application.evidenceClosureSha256 !== expected.applicationEvidenceClosureSha256 || application.requiredCoverageCount !== expected.requiredCoverageCount || application.requiredCoverageIdsSha256 !== expected.requiredCoverageIdsSha256 || application.requiredCoverageSnapshotSha256 !== expected.requiredCoverageSnapshotSha256) {return null;}
  if (value.acceptanceNetwork !== value.deploymentNetwork) {
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
    const descriptor = keys.get(key);
    if (!descriptor || seen.has(key) || row.result !== 'PASS' || !text(row.role) || !time(row.ranAt, now) || !specs.includes(row.specificationRevision) || !files(row.evidence)) {return null;}
    const staticRegistry = row.evidencePolicyVersion === 2 && descriptor.id === 'registry' && descriptor.method === 'GET' && descriptor.route === '/api/v1/universe/protocols' && descriptor.authorityPath === null && descriptor.evidencePolicy?.version === 2 && descriptor.evidencePolicy.checkpoint === 'not-required';
    const checkpoint = row.checkpoint;
    if (!(staticRegistry && checkpoint === null)) {
      if (!object(checkpoint) || !hash(checkpoint.blockHash) || !(Number.isSafeInteger(checkpoint.height) && Number(checkpoint.height) >= 0 || typeof checkpoint.heightAtomic === 'string' && /^(?:0|[1-9][0-9]*)$/.test(checkpoint.heightAtomic))) {return null;}
    }
    seen.add(key); dates.push(row.ranAt);
  }
  if (!keys.size || seen.size !== keys.size || ['declared', 'applicable', 'passed', 'failed', 'blocked', 'notTested', 'notApplicable'].some(key => !count(value[key])) || value.declared !== keys.size || value.applicable !== keys.size || value.passed !== keys.size || value.failed !== 0 || value.blocked !== 0 || value.notTested !== 0 || value.notApplicable !== 0) {return null;}
  // Name the oldest operation observation, not a receipt/registry response time.
  return new Date(Math.min(...dates.map(date => Date.parse(date)))).toISOString().slice(0, 10);
}

export function protocolCoverageView(protocol: ExplorerProtocolDefinition, registry?: ProtocolsResponse, network?: string, now = Date.now()): { functionalLabel: string; functionalKnown: boolean; historicalLabel: string | null } {
  const declaration = typeof protocol.coverage === 'string' ? protocol.coverage : typeof protocol.coverage?.state === 'string' ? protocol.coverage.state : null;
  const historical = declaration?.trim();
  const label = historical ? historical.replace(/[_-]/g, ' ').replace(/\b\w/g, character => character.toUpperCase()) : null;
  const date = acceptedDate(protocol, registry, network, now);
  const acceptanceNetwork = protocol.functionalAcceptance?.acceptanceNetwork;
  const testedOn = acceptanceNetwork === 'signet' ? 'Signet' : acceptanceNetwork === 'testnet4' ? 'Testnet4' : acceptanceNetwork === 'regtest' ? 'Regtest' : 'Testnet';
  return {
    functionalLabel: date ? $localize`:@@universe.protocols.functional-verified:Functionality verified on ${testedOn}:network: (${date}:date:)` : $localize`:@@universe.protocols.functional-unverified:Functional coverage: Unverified`,
    functionalKnown: date !== null,
    historicalLabel: label ? $localize`:@@universe.protocols.historical-declaration:Historical registry declaration: ${label}:declaration:` : null,
  };
}
