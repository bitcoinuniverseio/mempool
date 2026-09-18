import { ChainCapabilityEnvelope, HealthObservation, UniverseExplorerHealthV2 } from '../universe.types';
import { ChainReasonReading, describeChainReasons } from './chain-reasons';

// Current availability needs an observation from the bounded health poll.
export const HEALTH_MAX_AGE_MS = 120_000;
const AVAILABILITY: readonly unknown[] = ['ready', 'degraded', 'unavailable', 'unknown'];
const COVERAGE: readonly unknown[] = ['complete', 'partial', 'unavailable', 'unknown'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reasons = (value: unknown): boolean => Array.isArray(value) && value.every(code => typeof code === 'string');
const decimal = (value: unknown): boolean => value === null || (typeof value === 'string' && /^\d+$/.test(value));
const instant = (value: unknown): boolean => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const hash = (value: unknown): boolean => value === null || (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value));
const triState = (value: unknown): boolean => value === null || typeof value === 'boolean';

/** Reject unknown versions and malformed/context-mismatched health before any green reading. */
export function readHealth(capability: ChainCapabilityEnvelope | null | undefined): UniverseExplorerHealthV2 | null {
  const health: unknown = capability?.health;
  if (!record(health) || health.schemaVersion !== 'universe-explorer-health-v2'
    || health.chain !== capability?.chain || health.network !== capability?.network
    || !record(health.node) || !record(health.confirmed) || !record(health.address)
    || !record(health.mempool) || !record(health.summary) || !Array.isArray(health.protocols)) {return null;}
  const components = [health.node, health.confirmed, health.address, health.mempool, ...health.protocols];
  if (!components.every(row => record(row) && reasons(row.degradedReasons) && instant(row.observedAt)
    && (row.chain === undefined || row.chain === health.chain)
    && (row.network === undefined || row.network === health.network)
    && (row.authorityId === undefined || row.authorityId === null || typeof row.authorityId === 'string')
    && (row.stale === undefined || typeof row.stale === 'boolean')
    && (row.lastFailureKind === undefined || row.lastFailureKind === null || typeof row.lastFailureKind === 'string')
    && (row.checkpoint === undefined || row.checkpoint === null || (record(row.checkpoint) && typeof row.checkpoint.heightAtomic === 'string' && decimal(row.checkpoint.heightAtomic)
      && hash(row.checkpoint.blockHash) && typeof row.checkpoint.observedAt === 'string' && instant(row.checkpoint.observedAt)
      && (row.checkpoint.chain === undefined || row.checkpoint.chain === health.chain)
      && (row.checkpoint.network === undefined || row.checkpoint.network === health.network))))) {return null;}
  if (typeof health.node.reachability !== 'string' || !['reachable', 'unreachable', 'unknown'].includes(health.node.reachability)
    || typeof health.node.state !== 'string' || !['synced', 'syncing', 'behind', 'unavailable', 'unknown'].includes(health.node.state)
    || !triState(health.node.synced) || !triState(health.node.initialBlockDownload)
    || (health.node.synced === true && health.node.initialBlockDownload === true)
    || !hash(health.node.blockHash) || !hash(health.confirmed.blockHash)
    || !decimal(health.node.heightAtomic) || !decimal(health.node.blocksBehindNetworkAtomic)
    || !decimal(health.confirmed.heightAtomic) || !decimal(health.confirmed.lagBlocksAtomic)
    || !reasons(health.summary.degradedReasons) || typeof health.summary.allOfferedReady !== 'boolean'
    || typeof health.summary.servicesReady !== 'boolean' || !triState(health.summary.baseChainSynced)
    || ![health.confirmed, health.address, ...health.protocols].every(row => AVAILABILITY.includes(row.availability) && COVERAGE.includes(row.coverage))
    || !AVAILABILITY.includes(health.mempool.state) || !COVERAGE.includes(health.mempool.completeness)
    || typeof health.mempool.supported !== 'boolean'
    || !health.protocols.every(row => typeof row.protocolId === 'string' && ['qualified', 'unqualified', 'unknown'].includes(row.qualification))) {return null;}
  // The duplicate checkpoint fields must describe the same observation.
  // Compare only supplied facts; a missing hash remains unknown.
  const checkpointsAgree = [health.node, health.confirmed].every(row => {
    const checkpoint = row.checkpoint;
    if (!record(checkpoint)) {return true;}
    return (typeof row.heightAtomic !== 'string' || typeof checkpoint.heightAtomic !== 'string'
      || BigInt(row.heightAtomic) === BigInt(checkpoint.heightAtomic))
      && (typeof row.blockHash !== 'string' || typeof checkpoint.blockHash !== 'string'
        || row.blockHash.toLowerCase() === checkpoint.blockHash.toLowerCase());
  });
  if (!checkpointsAgree) {return null;}
  return health as unknown as UniverseExplorerHealthV2;
}

/** The observation is recent enough to describe the present; says nothing about whether its latest refresh failed. */
export function observationFresh(row: HealthObservation & { observedAt: string | null }, now = Date.now()): boolean {
  const age = row.observedAt ? now - Date.parse(row.observedAt) : NaN;
  return Number.isFinite(age) && age >= 0 && age <= HEALTH_MAX_AGE_MS && row.stale !== true;
}

/** Fresh and not failed: the only basis for a green reading. */
export function observationCurrent(row: HealthObservation & { observedAt: string | null }, now = Date.now()): boolean {
  return observationFresh(row, now) && !row.lastFailureKind;
}

export function nodeHealthLabel(capability: ChainCapabilityEnvelope | null | undefined, now = Date.now()): string {
  const node = readHealth(capability)?.node;
  // Legacy ready and sync.state are aggregate adapter claims, not direct node evidence.
  if (!node || !observationCurrent(node, now)) {return 'Status unknown';}
  if (node.reachability === 'unreachable' || node.state === 'unavailable') {return 'Node unavailable';}
  if (node.reachability !== 'reachable') {return 'Status unknown';}
  if (node.synced === true && node.state === 'synced') {return 'Synced';}
  if (node.synced === false && ['syncing', 'behind'].includes(node.state)) {return 'Syncing';}
  return 'Status unknown';
}

export function healthServiceSummary(capability: ChainCapabilityEnvelope | null | undefined, now = Date.now()): string {
  const health = readHealth(capability);
  if (!health) {return 'Service status unknown';}
  const problems: string[] = [];
  const available = (row: typeof health.address): boolean => observationCurrent(row, now) && row.availability === 'ready';
  if (!available(health.confirmed)) {problems.push(health.confirmed.availability === 'unavailable' ? 'History unavailable' : 'History needs attention');}
  if (!available(health.address)) {problems.push('Address history needs attention');}
  if (health.mempool.supported && (!observationCurrent(health.mempool, now) || health.mempool.state !== 'ready')) {problems.push('Mempool needs attention');}
  const count = health.protocols.filter(row => !available(row) || row.qualification !== 'qualified').length;
  if (count) {problems.push(`${count} protocol service${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} attention`);}
  if (!problems.length && health.summary.servicesReady !== true) {problems.push('Services need attention');}
  return problems.join(' · ') || 'Services ready';
}

export interface HealthDiagnostic {
  id: string;
  name: string;
  /** The service that answered for this row, or null when it names none. */
  authority: string | null;
  state: string;
  observation: string;
  /** The exact instant behind `observation`, for a tooltip. */
  observedAt: string | null;
  checkpoint: string | null;
  blockHash: string | null;
  blockHashShort: string | null;
  reasons: readonly ChainReasonReading[];
  effect: string;
}

/**
 * The words a reader sees for a service state. The wire values are a machine
 * contract, so "degraded; partial coverage" is what arrives; it is not what a
 * person should have to read.
 */
const AVAILABILITY_WORDS: Readonly<Record<string, string>> = {
  ready: 'Working',
  degraded: 'Problems',
  unavailable: 'Not available',
  unknown: 'Unknown',
};

const COVERAGE_WORDS: Readonly<Record<string, string>> = {
  complete: 'full history',
  partial: 'part of the history',
  unavailable: 'no history',
  unknown: 'history unknown',
};

const MEMPOOL_COVERAGE_WORDS: Readonly<Record<string, string>> = {
  complete: 'all pending transactions',
  partial: 'some pending transactions',
  unavailable: 'no pending transactions',
  unknown: 'pending coverage unknown',
};

/**
 * Display names for the protocols a health report can carry. The tab registry
 * in multichain-view owns the same names, but it imports this module, so the
 * short list is repeated here rather than creating a cycle.
 */
const PROTOCOL_NAMES: Readonly<Record<string, string>> = {
  doginals: 'Doginals',
  drc20: 'DRC-20',
  tap_doge: 'TAP on Doge',
  dunes: 'Dunes',
  zerdinals: 'Zerdinals',
  zrunes: 'ZRunes',
  zrc20: 'ZRC-20',
};

function serviceState(availability: string, coverage: string, coverageWords = COVERAGE_WORDS): string {
  const state = AVAILABILITY_WORDS[availability] ?? 'Unknown';
  const cover = coverageWords[coverage];
  return cover ? `${state}, ${cover}` : state;
}

/** A refresh failure kind is an internal label; say what it means instead. */
const FAILURE_WORDS: Readonly<Record<string, string>> = {
  transport: 'the last refresh could not reach the service',
  timeout: 'the last refresh timed out',
  'invalid-response': 'the last refresh returned something unreadable',
  unavailable: 'the service reported itself unavailable',
  'not-found': 'the service had no record for that request',
};

function failureSentence(kind: string): string {
  return FAILURE_WORDS[kind] ?? `the last refresh failed (${kind})`;
}

/** Seconds are precise but unreadable past a minute or two. */
function formatAge(seconds: number): string {
  if (seconds < 60) { return `${seconds}s`; }
  if (seconds < 3600) { return `${Math.floor(seconds / 60)} min`; }
  if (seconds < 86400) { return `${Math.floor(seconds / 3600)} h`; }
  return `${Math.floor(seconds / 86400)} d`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Enough of a block hash to recognise, with the whole value kept for copying. */
function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}
export function healthDiagnostics(capability: ChainCapabilityEnvelope | null | undefined, now = Date.now()): readonly HealthDiagnostic[] {
  const health = readHealth(capability);
  if (!health) {return [];}
  const entries = [
    { id: 'node', name: 'Node', row: health.node, state: `${health.node.reachability === 'reachable' ? 'Reachable' : health.node.reachability === 'unreachable' ? 'Not reachable' : 'Unknown'}, ${nodeHealthLabel(capability, now).toLowerCase()}`, effect: 'The base chain itself.' },
    { id: 'confirmed', name: 'Confirmed history', row: health.confirmed, state: serviceState(health.confirmed.availability, health.confirmed.coverage), effect: 'Past blocks, transactions and outputs.' },
    { id: 'address', name: 'Address history', row: health.address, state: serviceState(health.address.availability, health.address.coverage), effect: 'Confirmed balances and activity for an address.' },
    { id: 'mempool', name: 'Pending transactions', row: health.mempool, state: health.mempool.supported ? serviceState(health.mempool.state, health.mempool.completeness, MEMPOOL_COVERAGE_WORDS) : 'Not offered', effect: 'Transactions waiting to be confirmed.' },
    ...health.protocols.map(row => ({
      id: row.protocolId,
      name: PROTOCOL_NAMES[row.protocolId] ?? row.protocolId.replace(/_/g, ' '),
      row,
      state: serviceState(row.availability, row.coverage),
      effect: 'Assets and history for this protocol.',
    })),
  ];
  return entries.map(({ id, name, row, state, effect }) => {
    const age = row.observedAt ? Math.max(0, Math.floor((now - Date.parse(row.observedAt)) / 1000)) : null;
    const checkpoint = 'checkpoint' in row ? row.checkpoint : null;
    const height = checkpoint?.heightAtomic ?? ('heightAtomic' in row ? row.heightAtomic : null);
    const hash = checkpoint?.blockHash ?? ('blockHash' in row ? row.blockHash : null);
    return {
      id,
      name,
      // The service that answered, kept beside the name rather than glued into it.
      authority: row.authorityId ?? null,
      state,
      effect,
      // "Checked 12s ago" is the fact; the exact instant belongs in a tooltip,
      // not printed twice in the same sentence.
      observation: age === null ? 'Not checked yet' : `${observationCurrent(row, now) ? 'Checked' : 'Last checked'} ${formatAge(age)} ago`,
      observedAt: row.observedAt ?? null,
      checkpoint: height === null ? null : `Block ${height}`,
      blockHash: hash ?? null,
      blockHashShort: hash ? shortHash(hash) : null,
      reasons: [
        ...describeChainReasons(row.degradedReasons),
        ...(row.lastFailureKind ? [{ code: `latest-refresh:${row.lastFailureKind}`, text: capitalise(failureSentence(row.lastFailureKind)) + '.', kind: 'fault' as const }] : []),
      ],
    };
  });
}
