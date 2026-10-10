import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, EMPTY, NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { RBF_READ_TIMEOUT_MS, RbfHistoryState, rbfRead$, scopedRbfRead$, readRbfAvailability, RbfReadState, validRbfHistory, validRbfList, validRbfSummary } from './rbf-history-state';
const available = { schemaVersion: 'universe-rbf-history-availability-v1', status: 'available', reason: null };
const unavailable = { ...available, status: 'unavailable', reason: 'snapshot-oversize' };
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('RBF restore eligibility and bounded consumer reads', () => {
  it.each([null, [], {}, { ...available, schemaVersion: 'wrong' }, { ...available, reason: 'snapshot-invalid' }, { ...unavailable, reason: 'unknown' }])('rejects malformed marker %j', value => expect(readRbfAvailability(value)).toBeNull());
  it('accepts only typed available/unavailable pairs', () => { expect(readRbfAvailability(available)?.status).toBe('available'); expect(readRbfAvailability(unavailable)?.status).toBe('unavailable'); expect(readRbfAvailability({ ...unavailable, reason: 'rbf_restore_pending' })?.reason).toBe('rbf_restore_pending'); });
  it('preserves quarantine until explicit available and new data; scope reset clears retained data', () => {
    const h = new RbfHistoryState(); h.acceptSummary([]); h.acceptMarker(unavailable); h.acceptSummary([]); expect(h.summary$.value.status).toBe('unavailable');
    expect(h.acceptMarker(undefined)).toBe(false); h.acceptMarker(available); expect(h.summary$.value.status).toBe('unavailable');
    h.acceptSummary([]); expect(h.summary$.value).toEqual({ status: 'ready', value: [] }); h.reset(); expect(h.summary$.value.status).toBe('loading'); h.destroy();
  });
  it('bounds only summary loading without idle expiry/polling', () => {
    vi.useFakeTimers(); const h = new RbfHistoryState(); h.beginSummary(); vi.advanceTimersByTime(RBF_READ_TIMEOUT_MS); expect(h.summary$.value.status).toBe('unavailable');
    h.beginSummary(); h.acceptMarker(available); h.acceptSummary([]); vi.advanceTimersByTime(10 * RBF_READ_TIMEOUT_MS); expect(h.summary$.value.status).toBe('ready'); h.offline(); expect(h.summary$.value.status).toBe('unavailable'); h.destroy();
  });
  it.each([(): Observable<never> => NEVER, (): Observable<never> => EMPTY, (): Observable<never> => throwError(() => ({ status: 503 })), (): never => { throw new Error('factory'); }])('ends unavailable/empty/never attempts without fabricated data', factory => {
    vi.useFakeTimers(); const states: RbfReadState<unknown>[] = []; rbfRead$(factory).subscribe(s => states.push(s)); vi.advanceTimersByTime(RBF_READ_TIMEOUT_MS); expect(states).toEqual([{ status: 'loading' }, { status: 'unavailable' }]);
  });
  it('preserves a successful empty response within reviewed gateway margin', () => {
    vi.useFakeTimers(); const remote = new Subject<string[]>(); const states: RbfReadState<string[]>[] = []; rbfRead$(() => remote).subscribe(s => states.push(s)); vi.advanceTimersByTime(30_001); remote.next([]); vi.advanceTimersByTime(100_000); expect(states).toEqual([{ status: 'loading' }, { status: 'ready', value: [] }]);
  });
  it('requires real renderable shapes and keeps explicit null/empty history distinct from unavailable', () => {
    const tree = { tx: { txid: 'a'.repeat(64), fee: 1, vsize: 100 }, time: 1, fullRbf: true, replaces: [] };
    expect(validRbfHistory({ replacements: null, replaces: null })).toBe(true); expect(validRbfList([])).toBe(true); expect(validRbfList([tree])).toBe(true);
    expect(validRbfHistory({ replacements: {}, replaces: [] })).toBe(false); expect(validRbfList([{ ...tree, replaces: [{}] }])).toBe(false); expect(validRbfSummary([{}])).toBe(false);
    const malformed: RbfReadState<unknown>[] = []; rbfRead$(() => of({}), validRbfHistory).subscribe(state => malformed.push(state)); expect(malformed.at(-1)?.status).toBe('unavailable');
  });
  it('cancels old scope/quarantine and keeps explicit retry usable after failure', () => {
    const requests = new Subject<string>(), changes = new Subject<string>(); const availability = new BehaviorSubject('available'); let network = 'signet'; const old = new Subject<string>(), fresh = new Subject<string>();
    const factory = vi.fn<(txid: string) => Observable<string>>().mockReturnValueOnce(old).mockReturnValueOnce(throwError(() => ({ status: 503 }))).mockReturnValueOnce(fresh).mockReturnValueOnce(of('retry'));
    const states: RbfReadState<string>[] = []; const sub = scopedRbfRead$(requests, changes, availability, () => network, () => true, factory).subscribe(s => states.push(s)); requests.next('old'); network = ''; changes.next(''); expect(old.observed).toBe(false); old.next('stale'); expect(states.at(-1)?.status).toBe('loading');
    requests.next('new'); expect(states.at(-1)?.status).toBe('unavailable'); requests.next('new'); availability.next('unavailable'); expect(fresh.observed).toBe(false); fresh.next('stale'); requests.next('new'); expect(states.at(-1)).toEqual({ status: 'ready', value: 'retry' }); expect(factory).toHaveBeenCalledTimes(4); sub.unsubscribe();
  });
});
