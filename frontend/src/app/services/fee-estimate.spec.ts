import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodeFeeEstimate, FeeEstimateState, FEE_ESTIMATE_MAX_AGE_MS } from './fee-estimate';
import { FeeEstimateSnapshot } from '@interfaces/websocket.interface';

export function readyFee(network = 'mainnet'): FeeEstimateSnapshot {
  return { schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network, status: 'ready',
    observedAt: new Date().toISOString(), tip: { height: 900000, hash: 'a'.repeat(64) },
    values: { fastestFee: 2.5, halfHourFee: 2, hourFee: 1.5, economyFee: 1, minimumFee: 0.5 }, reason: null };
}

describe('fee producer evidence and bounded recovery', () => {
  let state: FeeEstimateState;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z')); state = new FeeEstimateState(); });
  afterEach(() => { state.destroy(); vi.useRealTimers(); });
  it('accepts precise fee units only with complete checkpoint and fresh source evidence', () => {
    expect(decodeFeeEstimate(readyFee(), '')?.values.fastestFee).toBe(2.5);
    for (const input of [undefined, { ...readyFee(), network: 'signet' }, { ...readyFee(), tip: null },
      { ...readyFee(), tip: { height: -1, hash: 'a'.repeat(64) } }, { ...readyFee(), schemaVersion: 'v0' },
      { ...readyFee(), observedAt: new Date(Date.now() - FEE_ESTIMATE_MAX_AGE_MS - 1).toISOString() },
      { ...readyFee(), observedAt: new Date(Date.now() + 6000).toISOString() },
      { ...readyFee(), observedAt: '2026-02-31T00:00:00Z' },
      { ...readyFee(), values: { ...readyFee().values, fastestFee: NaN } },
      { ...readyFee(), values: { ...readyFee().values, minimumFee: -1 } },
      { ...readyFee(), status: 'syncing' }]) expect(decodeFeeEstimate(input, '')).toBeNull();
  });
  it('invalidates fees when source synchronization is lost and recovers on a new observation', () => {
    const previous = readyFee(); state.accept(previous);
    state.accept({ ...readyFee(), status: 'syncing', values: null, reason: 'mempool_syncing' });
    expect(state.snapshot$.value.status).toBe('syncing');
    expect(state.snapshot$.value.values).toBeNull();
    state.accept(previous); expect(state.snapshot$.value.status).toBe('syncing');
    vi.advanceTimersByTime(1000); state.accept(readyFee());
    expect(state.snapshot$.value.status).toBe('ready');
  });
  it('retains disconnected last-good values explicitly stale with original producer time', () => {
    const snapshot = readyFee(); state.accept(snapshot); vi.advanceTimersByTime(1000); state.offline();
    expect(state.snapshot$.value).toEqual({ ...snapshot, status: 'stale', reason: 'disconnected' });
    state.accept(snapshot); expect(state.snapshot$.value.status).toBe('stale');
    state.accept(readyFee()); expect(state.snapshot$.value.status).toBe('ready');
  });
  it('retry cannot turn cached bootstrap into recovery and its wait terminates', () => {
    const snapshot = readyFee(); state.accept(snapshot); state.retry(); state.accept(snapshot);
    expect(state.snapshot$.value.status).toBe('syncing');
    vi.advanceTimersByTime(5000); expect(state.snapshot$.value.status).toBe('unavailable');
    vi.advanceTimersByTime(1000); state.accept(readyFee()); expect(state.snapshot$.value.status).toBe('ready');
  });
  it('silence expires a current estimate without renewing producer time', () => {
    const snapshot = readyFee(); state.accept(snapshot); vi.advanceTimersByTime(FEE_ESTIMATE_MAX_AGE_MS);
    expect(state.snapshot$.value.status).toBe('stale'); expect(state.snapshot$.value.observedAt).toBe(snapshot.observedAt);
  });
  it('clears network state synchronously and ignores a late old-scope observation', () => {
    state.accept(readyFee()); state.reset('signet'); expect(state.snapshot$.value.values).toBeNull();
    state.accept(readyFee('signet')); state.accept(readyFee());
    expect(state.snapshot$.value.network).toBe('signet'); expect(state.snapshot$.value.status).toBe('ready');
    state.reset(''); expect(state.snapshot$.value.values).toBeNull();
  });
  it('empty/missing proof and repeated syncing messages cannot leave perpetual placeholders', () => {
    state.accept(undefined); expect(state.snapshot$.value.status).toBe('unavailable');
    state.reset(''); const syncing = { ...readyFee(), status: 'syncing', values: null };
    for (let i = 0; i < 8; i++) { state.accept(syncing); vi.advanceTimersByTime(1000); }
    expect(state.snapshot$.value.status).toBe('unavailable');
  });
  it('copies accepted input and cancels its shared timer on teardown', () => {
    const snapshot = readyFee(); state.accept(snapshot); snapshot.values.fastestFee = 999;
    expect(state.snapshot$.value.values.fastestFee).toBe(2.5); state.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
});
