import { describe, expect, it } from 'vitest';
import { ChainCapabilityEnvelope, ProtocolHealthView, UniverseExplorerHealthV2 } from '../universe.types';
import { chainProfile, protocolRowState, readProtocolCoverage } from './multichain-view';
import { describeChainReason } from './chain-reasons';

const NOW = Date.parse('2026-09-16T09:00:00Z');
const FRESH = new Date(NOW - 10_000).toISOString();
const OLD = new Date(NOW - 10 * 60_000).toISOString();
const DOGE = chainProfile('dogecoin');
const HASH = 'a'.repeat(64);

function protocol(overrides: Partial<ProtocolHealthView> = {}): ProtocolHealthView {
  return {
    protocolId: 'drc20', availability: 'ready', coverage: 'complete', qualification: 'qualified',
    checkpoint: null, lagBlocksAtomic: '0', observedAt: FRESH, degradedReasons: [], ...overrides,
  } as ProtocolHealthView;
}

function envelope(protocols: ProtocolHealthView[], health: Partial<UniverseExplorerHealthV2> | 'invalid' = {}): ChainCapabilityEnvelope {
  const base: UniverseExplorerHealthV2 = {
    schemaVersion: 'universe-explorer-health-v2', chain: 'dogecoin', network: 'mainnet', observedAt: FRESH,
    node: { reachability: 'reachable', synced: true, state: 'synced', heightAtomic: '100', blockHash: HASH, initialBlockDownload: false, blocksBehindNetworkAtomic: '0', observedAt: FRESH, degradedReasons: [] },
    confirmed: { availability: 'ready', coverage: 'complete', heightAtomic: '100', blockHash: HASH, lagBlocksAtomic: '0', observedAt: FRESH, reads: { block: true, transaction: true, outpoint: true }, degradedReasons: [] },
    address: { availability: 'ready', coverage: 'complete', observedAt: FRESH, degradedReasons: [] },
    mempool: { supported: true, state: 'ready', completeness: 'complete', snapshotId: 's', sequenceAtomic: '1', observedAt: FRESH, ageSeconds: 10, degradedReasons: [] },
    protocols,
    summary: { baseChainSynced: true, servicesReady: true, allOfferedReady: false, degradedReasons: [] },
  } as UniverseExplorerHealthV2;
  return {
    schemaVersion: 'universe-chain-capability-v1', chain: 'dogecoin', network: 'mainnet', ready: true,
    asset: { symbol: 'DOGE', name: 'Dogecoin', precision: 8, atomicUnit: 'koinu' },
    tip: null, lagBlocksAtomic: '0', updatedAt: FRESH, degradedReasons: [],
    sync: { state: 'ready', initialBlockDownload: false, updatedAt: FRESH, progressDecimal: null },
    mempool: { supported: true, state: 'ready', completeness: 'complete', observedAt: FRESH },
    // The legacy rows say ready for everything; they must never be believed on their own.
    protocols: protocols.map(p => ({ protocolId: p.protocolId, state: 'ready', coverage: 'complete', updatedAt: FRESH, lagBlocksAtomic: '0', degradedReasons: [] })),
    reads: {}, coverage: { confirmedHistory: 'complete', addressHistory: 'complete', protocolHistory: 'complete' },
    release: { sha: 'test' },
    health: health === 'invalid' ? { ...base, node: { ...base.node, synced: true, initialBlockDownload: true } } : { ...base, ...health },
  } as unknown as ChainCapabilityEnvelope;
}

const rowFor = (id: string, capability: ChainCapabilityEnvelope) =>
  readProtocolCoverage(capability, DOGE, NOW).find(r => r.protocolId === id)!;

describe('protocol row state', () => {
  it('reads Ready only from a current, ready, qualified observation', () => {
    expect(protocolRowState(protocol(), NOW)).toEqual({ state: 'ready', reasonIds: [] });
    const row = rowFor('drc20', envelope([protocol()]));
    expect(row.tone).toBe('proven');
    expect(row.stateLabel).toBe('Ready');
    expect(row.reasons).toEqual([]);
  });

  it('keeps an explicit fresh outage explicit, with its failure kind', () => {
    const row = rowFor('drc20', envelope([protocol({ availability: 'unavailable', qualification: 'unknown', lastFailureKind: 'transport', degradedReasons: ['protocol-authority-unavailable'] })]));
    expect(row.stateLabel).toBe('Unavailable');
    expect(row.tone).toBe('unavailable');
    expect(row.reasons.map(r => r.code)).toEqual(['latest-refresh-failed:transport', 'protocol-authority-unavailable']);
    expect(row.reasons[0].text).toContain('transport');
  });

  it('reads a reachable but unqualified protocol as Unqualified, never Ready or Not stated', () => {
    const row = rowFor('drc20', envelope([protocol({ qualification: 'unqualified', degradedReasons: ['protocol-history-partial'] })]));
    expect(row.stateLabel).toBe('Unqualified');
    expect(row.tone).toBe('partial');
    expect(row.reasons.map(r => r.code)).toEqual(['protocol-unqualified', 'protocol-history-partial']);
  });

  it('reads a previously ready row whose observation aged out as Stale', () => {
    const row = rowFor('drc20', envelope([protocol({ observedAt: OLD })]));
    expect(row.stateLabel).toBe('Stale');
    expect(row.tone).toBe('partial');
    expect(row.reasons.map(r => r.code)).toEqual(['authority-observation-stale']);
    expect(protocolRowState(protocol({ stale: true }), NOW).state).toBe('stale');
  });

  it('reads a ready row whose latest refresh failed as Degraded, not Ready', () => {
    const row = rowFor('drc20', envelope([protocol({ lastFailureKind: 'timeout' })]));
    expect(row.stateLabel).toBe('Degraded');
    expect(row.reasons.map(r => r.code)).toEqual(['latest-refresh-failed:timeout']);
  });

  it('reads pending qualification as Degraded with the pending reason', () => {
    const row = rowFor('drc20', envelope([protocol({ qualification: 'unknown' })]));
    expect(row.stateLabel).toBe('Degraded');
    expect(row.reasons.map(r => r.code)).toEqual(['protocol-qualification-pending']);
  });

  it('never borrows a legacy ready flag when the health document is malformed', () => {
    const rows = readProtocolCoverage(envelope([protocol()], 'invalid'), DOGE, NOW);
    expect(rows.every(r => r.stateLabel === 'Not stated' && r.tone === 'neutral')).toBe(true);
    expect(rows[0].reasons.map(r => r.code)).toEqual(['health-contract-invalid']);
    expect(rows[0].reasons[0].text).toContain('validation');
  });

  it('keeps the four Dogecoin tabs and gives each its own verdict in a mixed result', () => {
    const rows = readProtocolCoverage(envelope([
      protocol({ protocolId: 'doginals' }),
      protocol({ protocolId: 'drc20', availability: 'degraded', qualification: 'unknown', degradedReasons: ['protocol-authority-stale'] }),
      protocol({ protocolId: 'tap_doge', coverage: 'partial', degradedReasons: ['pending-protocol-coverage-unavailable'] }),
      protocol({ protocolId: 'dunes', availability: 'unavailable', qualification: 'unknown', degradedReasons: ['authority-capability-disabled'] }),
    ]), DOGE, NOW);
    expect(rows.map(r => [r.routeId, r.stateLabel])).toEqual([
      ['doginals', 'Ready'], ['drc20', 'Degraded'], ['doge-tap', 'Ready'], ['dunes', 'Unavailable'],
    ]);
    expect(rows[2].reasons.map(r => r.kind)).toEqual(['limit']);
  });

  it('attributes an aggregate reason to its protocol and reads a bucket failure class', () => {
    expect(describeChainReason('dunes:authority-capability-disabled').text).toMatch(/^Dunes: The running index/);
    expect(describeChainReason('dunes:authority-capability-disabled').kind).toBe('fault');
    expect(describeChainReason('bucket-view-timeout').text).toBe('The pending buckets could not be read: timeout.');
    expect(describeChainReason('latest-refresh-failed:invalid-response').text).toBe('The latest refresh failed: invalid response.');
    expect(describeChainReason('weird:').kind).toBe('unstated');
  });
});
