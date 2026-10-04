import { createHash } from 'crypto';
import { invalid } from './stratum-v2.evidence';
import { Sv2Profile, Sv2Snapshot } from './stratum-v2.native-types';

const HASH = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
export function requireValue(condition: unknown): asserts condition { if (!condition) throw invalid(); }
function obj(value: any, keys: string[]): void {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  requireValue(Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}
function text(value: any, max = 128): void { requireValue(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= max && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)); }
function hash(value: any): void { requireValue(typeof value === 'string' && HASH.test(value)); }
function revision(value: any): void { requireValue(value === null || typeof value === 'string' && REVISION.test(value)); }
export function atomic(value: any, maximum = '18446744073709551615'): void {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= BigInt(maximum));
}
function nullableAtomic(value: any): void { if (value !== null) atomic(value); }
function timestamp(value: any, upper: number): void {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.[0-9]{1,9})?(?:Z|\+00:00)$/.test(value));
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && parsed <= upper && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19));
}
function challenge(value: any, network: string): void { requireValue(network === 'signet' ? typeof value === 'string' && /^(?:[0-9a-f]{2}){1,10000}$/.test(value) : value === null); }
export function stable(value: any): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((result, key) => { result[key] = item[key]; return result; }, {} as any) : item);
}
export function validateSv2Profile(value: any): Sv2Profile {
  obj(value, ['schema', 'network', 'genesisHash', 'blockOneHash', 'signetChallenge', 'core', 'roleSources']);
  requireValue(value.schema === 'universe-sv2-source-profile-v1' && ['signet', 'regtest'].includes(value.network));
  hash(value.genesisHash); hash(value.blockOneHash); challenge(value.signetChallenge, value.network);
  obj(value.core, ['software', 'versionAtomic', 'sourceRevision', 'binarySha256', 'configurationSha256']);
  text(value.core.software); atomic(value.core.versionAtomic); revision(value.core.sourceRevision); hash(value.core.binarySha256); hash(value.core.configurationSha256);
  requireValue(Array.isArray(value.roleSources) && value.roleSources.length > 0 && value.roleSources.length <= 8);
  const roles = new Set<string>();
  for (const role of value.roleSources) {
    obj(role, ['roleId', 'software', 'version', 'sourceRevision', 'binarySha256', 'configurationSha256', 'derivative']);
    text(role.roleId, 64); requireValue(!roles.has(role.roleId)); roles.add(role.roleId);
    text(role.software); text(role.version); revision(role.sourceRevision); hash(role.binarySha256); hash(role.configurationSha256);
    if (role.derivative !== null) {
      obj(role.derivative, ['baseRevision', 'patchSha256', 'patchedSourceSha256', 'cargoLockSha256']);
      requireValue(typeof role.derivative.baseRevision === 'string' && REVISION.test(role.derivative.baseRevision));
      hash(role.derivative.patchSha256); hash(role.derivative.patchedSourceSha256); hash(role.derivative.cargoLockSha256);
    }
  }
  return value;
}
export function validateSv2Snapshot(value: any, expected: Sv2Profile, profileSha256: string, now: number): Sv2Snapshot {
  obj(value, ['schema', 'profile', 'profileSha256', 'sourceEpoch', 'sourceGenerationAtomic', 'observedAt', 'core', 'roles', 'links', 'retention']);
  requireValue(value.schema === 'universe-sv2-native-snapshot-v1');
  validateSv2Profile(value.profile); requireValue(stable(value.profile) === stable(expected) && value.profileSha256 === profileSha256);
  requireValue(typeof value.sourceEpoch === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.sourceEpoch));
  atomic(value.sourceGenerationAtomic); timestamp(value.observedAt, now + 2000); requireValue(now - Date.parse(value.observedAt) <= 30000);
  const upper = Date.parse(value.observedAt) + 2000;
  obj(value.core, ['genesisHash', 'signetChallenge', 'checkpoint', 'initialBlockDownload', 'verifiedAt']);
  requireValue(value.core.genesisHash === expected.genesisHash && value.core.signetChallenge === expected.signetChallenge && value.core.initialBlockDownload === false);
  timestamp(value.core.verifiedAt, upper); requireValue(now - Date.parse(value.core.verifiedAt) <= 30000);
  obj(value.core.checkpoint, ['heightAtomic', 'blockHash', 'headerHex']); atomic(value.core.checkpoint.heightAtomic); hash(value.core.checkpoint.blockHash);
  requireValue(typeof value.core.checkpoint.headerHex === 'string' && /^[0-9a-f]{160}$/.test(value.core.checkpoint.headerHex));
  const header = Buffer.from(value.core.checkpoint.headerHex, 'hex');
  requireValue(createHash('sha256').update(createHash('sha256').update(header).digest()).digest().reverse().toString('hex') === value.core.checkpoint.blockHash);
  requireValue(Array.isArray(value.roles) && value.roles.length <= 8 && value.roles.length === expected.roleSources.length);
  const roles = new Set<string>(), sourceRoles = new Set(expected.roleSources.map(role => role.roleId));
  for (const role of value.roles) {
    obj(role, ['roleId', 'health', 'uptimeSecondsAtomic', 'connectedDownstreamsAtomic', 'globalCounters', 'transports']);
    requireValue(sourceRoles.has(role.roleId) && !roles.has(role.roleId)); roles.add(role.roleId);
    obj(role.health, ['status', 'httpStatus', 'observedAt']); requireValue(['observed', 'unavailable'].includes(role.health.status));
    requireValue(role.health.httpStatus === null || Number.isInteger(role.health.httpStatus) && role.health.httpStatus >= 100 && role.health.httpStatus <= 599);
    if (role.health.observedAt !== null) timestamp(role.health.observedAt, upper);
    nullableAtomic(role.uptimeSecondsAtomic); nullableAtomic(role.connectedDownstreamsAtomic);
    if (role.globalCounters !== null) {
      requireValue(Array.isArray(role.globalCounters) && role.globalCounters.length <= 32); const names = new Set();
      for (const counter of role.globalCounters) { obj(counter, ['name', 'valueAtomic']); text(counter.name, 64); requireValue(!names.has(counter.name)); names.add(counter.name); atomic(counter.valueAtomic); }
    }
    requireValue(Array.isArray(role.transports) && role.transports.length <= 16);
    for (const transport of role.transports) {
      obj(transport, ['direction', 'peerRoleId', 'protocol', 'security', 'evidence', 'observedAt']);
      requireValue(['upstream', 'downstream'].includes(transport.direction) && ['SV1', 'SV2', 'unknown'].includes(transport.protocol) && ['plaintext', 'noise', 'unknown'].includes(transport.security) && ['configured', 'observed-negotiated', 'observed-traffic', 'unknown'].includes(transport.evidence));
      requireValue(transport.peerRoleId === null || sourceRoles.has(transport.peerRoleId));
      if (transport.observedAt !== null) timestamp(transport.observedAt, upper);
    }
  }
  requireValue(Array.isArray(value.links) && value.links.length <= 512); let sequence = BigInt(-1); const events = new Set();
  for (const link of value.links) {
    obj(link, ['eventId', 'sequenceAtomic', 'observedAt', 'logId', 'logOffsetAtomic', 'rawLineSha256', 'requestIdAtomic', 'templateIdAtomic', 'channelIdAtomic', 'jobIdAtomic', 'coinbaseValueRemainingSats', 'transactionCountAtomic', 'prevHashLE', 'declarationSuccess', 'acceptance']);
    for (const field of ['eventId', 'logId', 'rawLineSha256', 'prevHashLE']) hash(link[field]);
    for (const field of ['sequenceAtomic', 'logOffsetAtomic', 'requestIdAtomic', 'templateIdAtomic', 'channelIdAtomic', 'jobIdAtomic', 'coinbaseValueRemainingSats', 'transactionCountAtomic']) atomic(link[field]);
    for (const field of ['requestIdAtomic', 'channelIdAtomic', 'jobIdAtomic']) atomic(link[field], '4294967295');
    timestamp(link.observedAt, upper);
    requireValue(BigInt(link.sequenceAtomic) > sequence && !events.has(link.eventId)); sequence = BigInt(link.sequenceAtomic); events.add(link.eventId);
    requireValue(createHash('sha256').update(`${value.sourceEpoch}\n${link.logId}\n${link.logOffsetAtomic}\n${link.rawLineSha256}`).digest('hex') === link.eventId && link.acceptance === 'accepted');
    obj(link.declarationSuccess, ['observedAt', 'logOffsetAtomic', 'rawLineSha256']); timestamp(link.declarationSuccess.observedAt, Date.parse(link.observedAt)); atomic(link.declarationSuccess.logOffsetAtomic); hash(link.declarationSuccess.rawLineSha256);
    requireValue(BigInt(link.declarationSuccess.logOffsetAtomic) < BigInt(link.logOffsetAtomic));
  }
  obj(value.retention, ['scope', 'maximumLinks', 'retainedLinksAtomic', 'droppedLinksAtomic', 'firstSequenceAtomic', 'lastSequenceAtomic', 'completeHistory', 'gapReason']);
  const retention = value.retention;
  requireValue(retention.scope === 'bounded-retained-native-links' && retention.maximumLinks === 512 && retention.retainedLinksAtomic === String(value.links.length) && retention.completeHistory === false);
  nullableAtomic(retention.droppedLinksAtomic); nullableAtomic(retention.firstSequenceAtomic); nullableAtomic(retention.lastSequenceAtomic);
  requireValue(retention.firstSequenceAtomic === (value.links[0]?.sequenceAtomic ?? null) && retention.lastSequenceAtomic === (value.links[value.links.length - 1]?.sequenceAtomic ?? null));
  if (retention.gapReason !== null) text(retention.gapReason, 256);
  requireValue(retention.droppedLinksAtomic !== null || retention.gapReason !== null);
  return value;
}
