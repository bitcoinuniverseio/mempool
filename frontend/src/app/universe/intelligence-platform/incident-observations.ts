import { sha256 } from '@noble/hashes/sha2.js';

export interface IncidentHeader { height: number; hash: string; parent: string; timestamp: number }
export interface IncidentSourceProfile {
  source_id: string; independence_id: string; implementation: 'bitcoin-core'; source_revision: string | null;
  binary_sha256: string; configuration_sha256: string; genesis_hash: string; block_one_hash: string; signet_challenge: string | null;
}
export interface IncidentProfile {
  schema: 'universe-incident-profile-v1'; network: string; stale_after_seconds: number; sources: IncidentSourceProfile[];
}
export interface IncidentRecord {
  incident_id: string; incident_type: 'reorg' | 'stale_tip' | 'node_tip_divergence'; title: string; summary: string; technical_postmortem: string;
  block_height: number; block_hash: string; detected_at_utc: string; resolved_at_utc: string | null; duration_seconds: number | null;
  reorg_depth: number | null; displaced_tx_count: null; double_spend_attempts_count: null; status: 'resolved' | 'investigating' | 'mitigated';
  source_ids: string[]; evidence: { before: IncidentHeader[]; after: IncidentHeader[]; common_ancestor: IncidentHeader | null };
  timeline: { observed_at_utc: string; stage: 'detected' | 'matching-tip-observed'; source_ids: string[] }[];
}
export interface IncidentResponse {
  schema: 'universe-incident-observations-v1'; network: string; profile: IncidentProfile; profile_sha256: string; observed_at_utc: string;
  incidents: IncidentRecord[]; count: number;
  sources: { source_id: string; status: 'observed' | 'unavailable'; checkpoint: IncidentHeader | null; observed_at_utc: string | null }[];
  coverage: { started_at_utc: string; last_observed_at_utc: string | null; retained_header_limit: 128; retained_incident_limit: 256;
    observation_count: number; gaps: { at_utc: string; reason: 'restart' | 'source-unavailable' | 'ancestor-outside-window' }[];
    complete_monitoring: false; global_consensus_verified: false; invalid_block_validation: 'unavailable'; consensus_validation: 'unavailable';
    displaced_transactions: 'unmeasured'; double_spend_attempts: 'unmeasured' };
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const utc = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const text = (v: unknown) => typeof v === 'string' && v.length <= 4096;
const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
const unique = (v: unknown[]): boolean => new Set(v).size === v.length;
const header = (v: any): v is IncidentHeader => !!v && integer(v.height) && hash(v.hash) && hash(v.parent) && integer(v.timestamp);
function headers(v: any): v is IncidentHeader[] {
  return Array.isArray(v) && v.length <= 128 && v.every((h, i) => header(h) && (!i || h.height === v[i - 1].height + 1 && h.parent === v[i - 1].hash));
}
function sameHeader(a: IncidentHeader, b: IncidentHeader): boolean {
  return a.height === b.height && a.hash === b.hash && a.parent === b.parent && a.timestamp === b.timestamp;
}
function ids(v: any, allowed: string[]): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.length <= 4 && unique(v) && v.every(x => allowed.includes(x));
}

/** Match the owning producer's normalized field order, not arbitrary response key order. */
export function incidentProfileDigest(profile: IncidentProfile): string {
  const normalized = { schema: profile.schema, network: profile.network, stale_after_seconds: profile.stale_after_seconds,
    sources: profile.sources.map(s => ({ source_id: s.source_id, independence_id: s.independence_id, implementation: s.implementation,
      source_revision: s.source_revision, binary_sha256: s.binary_sha256, configuration_sha256: s.configuration_sha256,
      genesis_hash: s.genesis_hash, block_one_hash: s.block_one_hash, signet_challenge: s.signet_challenge })) };
  return Array.from(sha256(new TextEncoder().encode(JSON.stringify(normalized))), b => b.toString(16).padStart(2, '0')).join('');
}

/** Returned registration is self-consistent provenance, not an independently pinned operator profile. */
export function validIncidentResponse(v: any, network: string): v is IncidentResponse {
  const p = v?.profile;
  if (v?.schema !== 'universe-incident-observations-v1' || !['mainnet', 'testnet', 'testnet4', 'signet'].includes(network)
    || v.network !== network || p?.schema !== 'universe-incident-profile-v1' || p.network !== network
    || !integer(p.stale_after_seconds) || p.stale_after_seconds < 30 || p.stale_after_seconds > 86400
    || !Array.isArray(p.sources) || p.sources.length < 1 || p.sources.length > 4 || !unique(p.sources.map(s => s?.source_id))) return false;
  if (p.sources.some((s: any) => !s || !id(s.source_id) || !id(s.independence_id) || s.implementation !== 'bitcoin-core'
    || s.source_revision !== null && (typeof s.source_revision !== 'string' || !/^[0-9a-f]{40}$/.test(s.source_revision))
    || ![s.binary_sha256, s.configuration_sha256, s.genesis_hash, s.block_one_hash].every(hash)
    || (network === 'signet' ? typeof s.signet_challenge !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/.test(s.signet_challenge) : s.signet_challenge !== null)
    || s.genesis_hash !== p.sources[0].genesis_hash || s.block_one_hash !== p.sources[0].block_one_hash || s.signet_challenge !== p.sources[0].signet_challenge)) return false;
  if (!hash(v.profile_sha256) || incidentProfileDigest(p) !== v.profile_sha256 || !utc(v.observed_at_utc)) return false;
  const now = Date.parse(v.observed_at_utc), allowed = p.sources.map(s => s.source_id), c = v.coverage;
  const at = (value: unknown) => utc(value) && Date.parse(value) <= now;
  if (!Array.isArray(v.sources) || v.sources.length !== allowed.length || !unique(v.sources.map(s => s?.source_id))
    || v.sources.some((s: any) => !s || !allowed.includes(s.source_id) || !['observed', 'unavailable'].includes(s.status)
      || (s.status === 'observed' ? !header(s.checkpoint) || !at(s.observed_at_utc) : s.checkpoint !== null || s.observed_at_utc !== null))) return false;
  if (!c || !at(c.started_at_utc) || c.last_observed_at_utc !== null && (!at(c.last_observed_at_utc) || Date.parse(c.last_observed_at_utc) < Date.parse(c.started_at_utc))
    || c.retained_header_limit !== 128 || c.retained_incident_limit !== 256 || !integer(c.observation_count)
    || (c.observation_count === 0 ? c.last_observed_at_utc !== null : c.last_observed_at_utc === null)
    || c.complete_monitoring !== false || c.global_consensus_verified !== false || c.invalid_block_validation !== 'unavailable'
    || c.consensus_validation !== 'unavailable' || c.displaced_transactions !== 'unmeasured' || c.double_spend_attempts !== 'unmeasured'
    || !Array.isArray(c.gaps) || c.gaps.length > 256 || c.gaps.some(g => !at(g?.at_utc) || Date.parse(g.at_utc) < Date.parse(c.started_at_utc)
      || !['restart', 'source-unavailable', 'ancestor-outside-window'].includes(g.reason))) return false;
  if (v.sources.some((source: any) => source.status === 'observed' && (c.last_observed_at_utc === null || Date.parse(source.observed_at_utc) > Date.parse(c.last_observed_at_utc)))) return false;
  const registeredHeader = (h: IncidentHeader) => (h.height !== 0 || h.hash === p.sources[0].genesis_hash) && (h.height !== 1 || h.hash === p.sources[0].block_one_hash && h.parent === p.sources[0].genesis_hash);
  if (v.sources.some((source: any) => source.checkpoint && !registeredHeader(source.checkpoint))) return false;
  if (!Array.isArray(v.incidents) || v.incidents.length > 256 || v.count !== v.incidents.length || !unique(v.incidents.map(i => i?.incident_id))) return false;
  return v.incidents.every((i: any) => {
    if (!i || !hash(i.incident_id) || !['reorg', 'stale_tip', 'node_tip_divergence'].includes(i.incident_type)
      || !['resolved', 'investigating', 'mitigated'].includes(i.status) || ![i.title, i.summary, i.technical_postmortem].every(text)
      || !integer(i.block_height) || !hash(i.block_hash) || !at(i.detected_at_utc) || !ids(i.source_ids, allowed)
      || i.displaced_tx_count !== null || i.double_spend_attempts_count !== null || i.reorg_depth !== null && !integer(i.reorg_depth)
      || (i.status === 'resolved' ? !at(i.resolved_at_utc) || Date.parse(i.resolved_at_utc) < Date.parse(i.detected_at_utc) || !integer(i.duration_seconds)
        || i.duration_seconds !== Math.floor((Date.parse(i.resolved_at_utc) - Date.parse(i.detected_at_utc)) / 1000) : i.resolved_at_utc !== null || i.duration_seconds !== null)
      || !i.evidence || !headers(i.evidence.before) || !headers(i.evidence.after)
      || !Array.isArray(i.timeline) || !i.timeline.length || i.timeline.length > 128) return false;
    if (!i.evidence.after.length || !i.evidence.before.length || ![...i.evidence.before, ...i.evidence.after].every(registeredHeader)) return false;
    const tip = i.evidence.after[i.evidence.after.length - 1];
    if (tip.height !== i.block_height || tip.hash !== i.block_hash) return false;
    if (i.incident_type === 'node_tip_divergence') {
      if (i.reorg_depth !== null || i.evidence.common_ancestor !== null) return false;
      const groups = i.source_ids.map(sourceId => p.sources.find(source => source.source_id === sourceId).independence_id);
      const sharedHeight = Math.min(i.evidence.before[i.evidence.before.length - 1].height, tip.height);
      const left = i.evidence.before.find(h => h.height === sharedHeight), right = i.evidence.after.find(h => h.height === sharedHeight);
      if (i.source_ids.length !== 2 || new Set(groups).size !== 2 || !left || !right || left.hash === right.hash) return false;
    }
    const ancestor = i.evidence.common_ancestor;
    if (ancestor !== null && (!header(ancestor) || !i.evidence.before.some(h => sameHeader(h, ancestor)) || !i.evidence.after.some(h => sameHeader(h, ancestor)))) return false;
    const beforeTip = i.evidence.before[i.evidence.before.length - 1];
    if (i.incident_type === 'stale_tip' && (i.source_ids.length !== 1 || i.reorg_depth !== null || !sameHeader(beforeTip, tip) || !ancestor || !sameHeader(ancestor, tip))) return false;
    if (i.incident_type === 'reorg' && (i.source_ids.length !== 1 || beforeTip.hash === tip.hash || i.evidence.after.some(h => h.hash === beforeTip.hash))) return false;
    if (i.incident_type === 'reorg' && (!ancestor || !i.evidence.before.length || !i.evidence.after.length
      || i.reorg_depth !== i.evidence.before[i.evidence.before.length - 1].height - ancestor.height || i.reorg_depth < 1)) return false;
    return i.timeline.every((event: any, index: number) => at(event?.observed_at_utc) && ['detected', 'matching-tip-observed'].includes(event.stage)
      && ids(event.source_ids, i.source_ids) && (!index ? event.stage === 'detected' && event.observed_at_utc === i.detected_at_utc
        : Date.parse(event.observed_at_utc) >= Date.parse(i.timeline[index - 1].observed_at_utc)));
  });
}
