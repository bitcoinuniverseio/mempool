import { ChainCapabilityEnvelope, HealthObservation, UniverseExplorerHealthV2 } from '../universe.types';
import { describeChainReasons } from './chain-reasons';

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
/*
 * IMPLEMENTATION-HANDOFF [WP05] BEGIN
 * Verify actual consumer outcomes and preserve all offered explorer features
 * Coverage: UI-HEALTH, UI-PROTOCOLS, UI-REGRESSION; defects: V01; functional status: NOT TESTED.
 * Observed: Source preserves truthful health and network context. Screenshots and API responses establish problems, not complete browser journeys. Fixture-driven tests cannot prove working backend dependencies.
 * Sources: S-MEMPOOL,S-BACKEND (research-register.json in the server handoff).
 * Prerequisites: WP01, WP02, WP03, WP04.
 * 1. Preserve readHealth validation, observationCurrent expiry, network matching and Why diagnostics. Wire any additive per-path evidence through universe.types and shared contracts before altering the health view; keep partial coverage visible alongside availability.
 * 2. Exercise Dogecoin overview, protocol directory/list/detail, block, transaction, outpoint and address/holdings/history routes against the real candidate API. Resolve fixture IDs from testnet authorities; include empty/error/pending/success states, direct URL, refresh, back, reconnect and network switch with an in-flight request.
 * 3. Use one existing localhost app port and one browser tab. Capture desktop/mobile and supported light/dark themes, keyboard focus and Why-link detail. Validate links for doginals, drc20, doge-tap and dunes and exact integer formatting.
 * 4. Retest every inventory row sharing changed contracts, including Bitcoin/Zcash paths and existing mining/statistics/search/portfolio/websocket surfaces. Keep all unexecuted rows NOT TESTED. Do not hide features to reduce denominator.
 * Verification: mempool/frontend npm test -- src/app/universe/multichain-explorer/chain-health.spec.ts src/app/universe/multichain-explorer/protocol-row-state.spec.ts src/app/universe/multichain-explorer/protocol-index.spec.ts src/app/universe/chain-health.service.spec.ts; node scripts/universe/protocol-contract.mjs (inspect CLI before use). Live synthetic-check.mjs is read-only but broad; run on candidate only with known test IDs.
 * Acceptance: Real API/UI results persist across refresh/reconnect; no cross-network data, false-ready state, rounding, hidden feature or existing-capability regression. All coverage rows require independent evidence.
 * Rollback: Retain previous frontend immutable artifact and compatible API contracts; switch back if route/health regressions occur without altering authority truth.
 * IMPLEMENTATION-HANDOFF [WP05] END
 */
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
  state: string;
  observation: string;
  checkpoint: string | null;
  reasons: readonly string[];
  effect: string;
}

export function healthDiagnostics(capability: ChainCapabilityEnvelope | null | undefined, now = Date.now()): readonly HealthDiagnostic[] {
  const health = readHealth(capability);
  if (!health) {return [];}
  const entries = [
    { id: 'node', name: 'Node', row: health.node, state: `${health.node.reachability}; ${nodeHealthLabel(capability, now)}`, effect: 'Base chain synchronization.' },
    { id: 'confirmed', name: 'Confirmed history', row: health.confirmed, state: `${health.confirmed.availability}; ${health.confirmed.coverage} coverage`, effect: 'Historical blocks, transactions and outpoints.' },
    { id: 'address', name: 'Address history', row: health.address, state: `${health.address.availability}; ${health.address.coverage} coverage`, effect: 'Confirmed address balances and activity.' },
    { id: 'mempool', name: 'Mempool', row: health.mempool, state: health.mempool.supported ? `${health.mempool.state}; ${health.mempool.completeness} coverage` : 'Not offered', effect: 'Pending transactions and arrivals.' },
    ...health.protocols.map(row => ({ id: row.protocolId, name: row.protocolId.replace(/_/g, ' '), row, state: `${row.availability}; ${row.coverage} coverage; ${row.qualification}`, effect: 'This protocol’s assets and history.' })),
  ];
  return entries.map(({ id, name, row, state, effect }) => {
    const age = row.observedAt ? Math.max(0, Math.floor((now - Date.parse(row.observedAt)) / 1000)) : null;
    const checkpoint = 'checkpoint' in row ? row.checkpoint : null;
    const height = checkpoint?.heightAtomic ?? ('heightAtomic' in row ? row.heightAtomic : null);
    const hash = checkpoint?.blockHash ?? ('blockHash' in row ? row.blockHash : null);
    return {
      id, name: row.authorityId ? `${name} · ${row.authorityId}` : name, state, effect,
      observation: age === null ? 'No observation' : `${observationCurrent(row, now) ? 'Observed' : 'Last known; stale'} ${age}s ago · ${row.observedAt}`,
      checkpoint: height === null ? null : `Block ${height}${hash ? ` · ${hash}` : ''}`,
      reasons: [...describeChainReasons(row.degradedReasons).map(reason => reason.text), ...(row.lastFailureKind ? [`Latest refresh: ${row.lastFailureKind}`] : [])],
    };
  });
}
