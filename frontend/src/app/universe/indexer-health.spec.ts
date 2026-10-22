import { describe, expect, it } from 'vitest';
import { indexerViewState, scopedIndexerEntries } from './indexer-health';
const now = Date.parse('2026-10-22T03:00:00Z');
const entry = { protocolId: 'tap', chain: 'bitcoin', network: 'signet', role: 'authority', desiredState: 'enabled', availability: 'available', freshness: 'fresh', observedAt: new Date(now).toISOString(), indexedHeight: 0, tipHeight: 0, lagBlocks: 0 };
describe('indexer-health v1 view', () => {
  it('keeps known zero distinct from missing data', () => {
    expect(indexerViewState(entry, now)).toBe('ready');
    expect(indexerViewState({}, now)).toBe('unavailable');
  });
  it('does not promote expired, ahead-of-tip or unavailable records', () => {
    expect(indexerViewState(entry, now + 60_001)).toBe('unavailable');
    expect(indexerViewState({ ...entry, indexedHeight: 1 }, now)).toBe('unavailable');
    expect(indexerViewState({ ...entry, availability: 'unavailable', lastSuccessfulAt: entry.observedAt }, now)).toBe('unavailable');
  });
  it('distinguishes lifecycle from outages and fresh transport from stale progress', () => {
    for (const desiredState of ['disabled', 'planned', 'retired']) expect(indexerViewState({ ...entry, desiredState }, now)).toBe(desiredState);
    expect(indexerViewState({ ...entry, lagBlocks: 3 }, now)).toBe('stale');
    expect(indexerViewState({ ...entry, lagBlocks: 2 }, now)).toBe('ready');
  });
  it('rejects malformed envelopes and excludes candidates and foreign scopes', () => {
    expect(() => scopedIndexerEntries({}, 'signet')).toThrow();
    const entries = [entry, { ...entry, role: 'candidate' }, { ...entry, network: 'mainnet' }, { ...entry, chain: 'zcash' }];
    expect(scopedIndexerEntries({ schemaVersion: 1, entries }, 'signet')).toEqual([entry]);
  });
});
