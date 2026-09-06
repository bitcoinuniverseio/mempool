import { describe, expect, it } from 'vitest';
import { ChainCapabilityEnvelope } from '../universe.types';
import { chainProfile, readHistoryCoverage, readStatusRail } from './multichain-view';
import { healthDiagnostics, healthServiceSummary, readHealth } from './chain-health';
import { chainHealthNotice } from '../chain-sync-notice/chain-sync-notice.component';

const NOW = Date.parse('2026-09-06T12:00:00Z');
const OBSERVED = new Date(NOW - 10_000).toISOString();
function healthCapability(): ChainCapabilityEnvelope {
  return {
    schemaVersion: 'universe-chain-capability-v1', chain: 'zcash', network: 'mainnet', ready: false,
    asset: { symbol: 'ZEC', name: 'Zcash', precision: 8, atomicUnit: 'zatoshi' },
    tip: null, lagBlocksAtomic: '500', updatedAt: OBSERVED, degradedReasons: ['protocol-history-unavailable'],
    sync: { state: 'ready', initialBlockDownload: false, updatedAt: OBSERVED, progressDecimal: null },
    mempool: { supported: true, state: 'unavailable', completeness: 'unavailable', observedAt: null },
    protocols: [], reads: {}, coverage: { confirmedHistory: 'unavailable', addressHistory: 'unavailable', protocolHistory: 'unavailable' },
    release: { sha: 'test' },
    health: {
      schemaVersion: 'universe-explorer-health-v2', chain: 'zcash', network: 'mainnet', observedAt: OBSERVED,
      node: { reachability: 'reachable', synced: true, state: 'synced', heightAtomic: '9007199254740993', blockHash: 'a'.repeat(64), initialBlockDownload: false, blocksBehindNetworkAtomic: null, observedAt: OBSERVED, degradedReasons: [] },
      confirmed: { availability: 'ready', coverage: 'complete', heightAtomic: '123', blockHash: 'b'.repeat(64), lagBlocksAtomic: null, observedAt: OBSERVED, reads: { block: true, transaction: true, outpoint: true }, degradedReasons: [] },
      address: { availability: 'ready', coverage: 'complete', observedAt: OBSERVED, degradedReasons: [] },
      mempool: { supported: true, state: 'unavailable', completeness: 'unavailable', snapshotId: null, sequenceAtomic: null, observedAt: null, ageSeconds: null, degradedReasons: ['mempool-collector-unavailable'] },
      protocols: [{ protocolId: 'zrc20', availability: 'unavailable', coverage: 'complete', qualification: 'unknown', checkpoint: null, lagBlocksAtomic: null, observedAt: OBSERVED, degradedReasons: ['protocol-qualification-unknown'] }],
      summary: { baseChainSynced: true, servicesReady: false, allOfferedReady: false, degradedReasons: ['protocol-history-unavailable'] },
    },
  } as unknown as ChainCapabilityEnvelope;
}

describe('independent chain health presentation', () => {
  it('shows a synced node alongside affected protocol and mempool services', () => {
    const rail = readStatusRail(healthCapability(), chainProfile('zcash'), NOW);
    expect(rail.find(row => row.id === 'state')?.value).toBe('Synced');
    expect(rail.find(row => row.id === 'services')?.value).toContain('1 protocol service');
    expect(rail.find(row => row.id === 'tip')?.exact).toBe('9007199254740993');
    expect(rail.find(row => row.id === 'lag')?.exact).toBeNull();
    expect(chainHealthNotice(healthCapability(), 'zcash', false, NOW).show).toBe(false);
  });
  it.each(['unknown', 'unqualified'])('keeps confirmed scan coverage independent of missing mempool and %s qualification', qualification => {
    const capability = healthCapability();
    capability.health!.protocols[0].qualification = qualification as 'unknown' | 'unqualified';
    const rows = readHistoryCoverage(capability, NOW);
    expect(rows.find(row => row.id === 'confirmedHistory')?.stateLabel).toBe('Complete');
    expect(rows.find(row => row.id === 'protocolHistory')?.tone).not.toBe('proven');
  });
  it.each([{ schemaVersion: 'future-v3' }, { node: {} }, { network: 'signet' }])('rejects malformed or cross-context health: %j', patch => {
    const row = healthCapability();
    row.health = { ...row.health, ...patch } as ChainCapabilityEnvelope['health'];
    expect(readStatusRail(row, chainProfile('zcash'), NOW).find(item => item.id === 'state')?.value).toBe('Status unknown');
  });
  it.each([{ stale: true }, { lastFailureKind: 'transport' }, { observedAt: new Date(NOW - 600_000).toISOString() }])('keeps failed or aged node evidence last-known: %j', patch => {
    const row = healthCapability();
    Object.assign(row.health!.node, patch);
    expect(readStatusRail(row, chainProfile('zcash'), NOW).find(item => item.id === 'state')?.value).toBe('Status unknown');
    expect(healthDiagnostics(row, NOW)[0].observation).toContain('Last known');
    expect(healthDiagnostics(row, NOW)[0].checkpoint).toContain('9007199254740993');
  });
  it('does not use a summary sync flag in place of node evidence', () => {
    const row = healthCapability();
    row.health!.node.synced = null;
    row.health!.node.state = 'unknown';
    expect(readStatusRail(row, chainProfile('zcash'), NOW)[0].value).toBe('Status unknown');
  });
  it('rejects cross-network checkpoints within a correctly scoped envelope', () => {
    const row = healthCapability();
    row.health!.confirmed.checkpoint = { heightAtomic: '123', blockHash: null, observedAt: OBSERVED, network: 'testnet' };
    expect(readHealth(row)).toBeNull();
  });

  it.each([
    { target: 'node', patch: { blockHash: 'broken' } },
    { target: 'node', patch: { initialBlockDownload: 'false' } },
    { target: 'node', patch: { stale: 'false' } },
    { target: 'node', patch: { lastFailureKind: 0 } },
    { target: 'confirmed', patch: { checkpoint: { heightAtomic: null, blockHash: null, observedAt: OBSERVED } } },
    { target: 'confirmed', patch: { checkpoint: { heightAtomic: '1', blockHash: 'broken', observedAt: OBSERVED } } },
    { target: 'confirmed', patch: { checkpoint: { heightAtomic: '1', blockHash: null, observedAt: null } } },
    { target: 'summary', patch: { servicesReady: 'true' } },
    { target: 'summary', patch: { baseChainSynced: 'true' } },
  ])('rejects malformed v2 facts before displaying green: %j', ({ target, patch }) => {
    const capability = healthCapability();
    Object.assign(capability.health![target as 'node' | 'confirmed' | 'summary'], patch);
    expect(readStatusRail(capability, chainProfile('zcash'), NOW)[0].value).toBe('Status unknown');
  });

  it('rejects future observations as current sync evidence', () => {
    const capability = healthCapability();
    capability.health!.node.observedAt = new Date(NOW + 1000).toISOString();
    expect(readStatusRail(capability, chainProfile('zcash'), NOW)[0].value).toBe('Status unknown');
  });

  it('keeps healthy services ready when only the node is catching up', () => {
    const capability = healthCapability();
    capability.health!.node.synced = false;
    capability.health!.node.state = 'syncing';
    capability.health!.mempool.supported = false;
    capability.health!.protocols = [];
    capability.health!.summary.servicesReady = true;
    expect(capability.health!.summary.allOfferedReady).toBe(false);
    expect(healthServiceSummary(capability, NOW)).toBe('Services ready');
  });

  it('rejects contradictory initial download and synchronized claims', () => {
    const capability = healthCapability();
    capability.health!.node.initialBlockDownload = true;
    expect(readStatusRail(capability, chainProfile('zcash'), NOW)[0].value).toBe('Status unknown');
  });

  it.each([
    { target: 'node', field: 'heightAtomic' },
    { target: 'node', field: 'blockHash' },
    { target: 'confirmed', field: 'heightAtomic' },
    { target: 'confirmed', field: 'blockHash' },
  ] as const)('rejects contradictory $target checkpoint $field', ({ target, field }) => {
    const capability = healthCapability();
    const row = capability.health![target];
    row.checkpoint = { heightAtomic: row.heightAtomic!, blockHash: row.blockHash, observedAt: OBSERVED };
    row.checkpoint[field] = field === 'heightAtomic' ? (BigInt(row.heightAtomic!) + 1n).toString() : 'c'.repeat(64);
    expect(readStatusRail(capability, chainProfile('zcash'), NOW)[0].value).toBe('Status unknown');
  });

  it('accepts equivalent checkpoint encodings and does not invent missing hashes', () => {
    const capability = healthCapability();
    const node = capability.health!.node;
    node.checkpoint = { heightAtomic: '0' + node.heightAtomic, blockHash: node.blockHash!.toUpperCase(), observedAt: OBSERVED };
    capability.health!.confirmed.checkpoint = { heightAtomic: '123', blockHash: null, observedAt: OBSERVED };
    expect(readHealth(capability)).toBe(capability.health);
  });
});
