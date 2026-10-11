import { canonicalObservedFee, migrateObservedFeeNoise } from './history-fee-migration';
import { validateHistorySnapshot } from './history-validation';

const limits = { events: 50_000, checkpoints: 288 };
const fixture = (fee = 419.99999999999994) => ({
  schema: 'observed-history-v1', network: 'mainnet', startedAt: new Date(1000).toISOString(),
  eventSequence: 1, evictedSequence: 0, evictedThrough: 0, observedThrough: 1000, gaps: [], checkpoints: [],
  events: [{ sequence: 1, event_id: 'original', txid: 'a'.repeat(64), timestamp_utc: new Date(1000).toISOString(),
    event_type: 'confirmed', vsize: 181, weight: 721, fee_sats: fee, fee_rate: Math.round(fee / 181 * 100) / 100 }],
});

describe('explicit legacy observed fee repair', () => {
  it('repairs only conversion noise while preserving the original and all observed fields', () => {
    const original = fixture(); const bytes = JSON.stringify(original);
    expect(() => validateHistorySnapshot(original, 'mainnet', limits)).toThrow();
    const result = migrateObservedFeeNoise(original, 'mainnet', limits);
    expect(result.changed).toBe(1);
    expect(result.snapshot.events[0]).toEqual({ ...original.events[0], fee_sats: 420 });
    expect(JSON.stringify(original)).toBe(bytes);
    expect(validateHistorySnapshot(result.snapshot, 'mainnet', limits)).toBe(result.snapshot);
    expect(migrateObservedFeeNoise(result.snapshot, 'mainnet', limits).changed).toBe(0);
  });
  it.each([419.5, -1, NaN, Infinity, 1e15 + 0.25, Number.MAX_SAFE_INTEGER + 1])('rejects an ambiguous or invalid fee %s', fee => {
    expect(() => canonicalObservedFee(fee)).toThrow();
    expect(() => migrateObservedFeeNoise(fixture(fee), 'mainnet', limits)).toThrow();
  });
  it.each([409.99999999999994, 438.00000000000006, 1993.9999999999998])('accepts captured conversion noise %s', fee => {
    expect(canonicalObservedFee(fee)).toBe(Math.round(fee));
  });
  it('retains network, timestamp, metric and observed rate guards', () => {
    expect(() => migrateObservedFeeNoise(fixture(), 'signet', limits)).toThrow();
    for (const change of [{ timestamp_utc: 'invalid' }, { weight: 1.5 }, { vsize: 1.5 }, { fee_rate: 99 }]) {
      const value = fixture(); Object.assign(value.events[0], change);
      expect(() => migrateObservedFeeNoise(value, 'mainnet', limits)).toThrow();
    }
  });
});
