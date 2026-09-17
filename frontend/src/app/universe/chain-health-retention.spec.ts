import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { ChainHealthService, ChainHealthState } from './chain-health.service';
import { ChainDashboardService, ChainDashboardState, isNetworkNotOffered } from './chain-dashboard/chain-dashboard.service';
import { ChainCapabilityEnvelope, ChainDashboardView } from './universe.types';

const capability = (chain: 'dogecoin' | 'zcash', sha: string): ChainCapabilityEnvelope =>
  ({ chain, network: 'mainnet', release: { sha } } as unknown as ChainCapabilityEnvelope);
const view = (observedAt: string): ChainDashboardView =>
  ({ chain: 'dogecoin', network: 'mainnet', subsystems: [], observedAt } as unknown as ChainDashboardView);

describe('health retention across failed refreshes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the last good capabilities, marked stale, when a poll fails, and recovers', () => {
    const answers = [
      () => of([capability('dogecoin', 'one')]),
      () => throwError(() => new Error('boom')),
      () => of([capability('dogecoin', 'two')]),
    ];
    let call = 0;
    const api = { getChains$: () => answers[call++]() };
    const state = { isBrowser: true, network: '', networkChanged$: new Subject<string>() };
    const service = new ChainHealthService(api as never, state as never);
    const seen: ChainHealthState[] = [];
    const subscription = service.state$.subscribe(s => seen.push(s));
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toMatchObject({ loading: false, error: null, stale: false });
    expect(seen.at(-1)?.capabilities[0].release.sha).toBe('one');
    const observedAt = seen.at(-1)?.observedAt;
    expect(observedAt).toBeTruthy();

    service.retry();
    expect(seen.at(-1)).toMatchObject({ loading: false, stale: true, observedAt });
    expect(seen.at(-1)?.error).toContain('refresh failed');
    // The retained document is the older one, never a blank list.
    expect(seen.at(-1)?.capabilities[0].release.sha).toBe('one');

    service.retry();
    expect(seen.at(-1)).toMatchObject({ error: null, stale: false });
    expect(seen.at(-1)?.capabilities[0].release.sha).toBe('two');
    subscription.unsubscribe();
  });

  it('starts blank, not stale, when the very first poll fails', () => {
    const api = { getChains$: () => throwError(() => new Error('boom')) };
    const state = { isBrowser: true, network: '', networkChanged$: new Subject<string>() };
    const service = new ChainHealthService(api as never, state as never);
    let last: ChainHealthState | undefined;
    const subscription = service.state$.subscribe(s => (last = s));
    vi.advanceTimersByTime(1);
    expect(last).toMatchObject({ capabilities: [], loading: false, stale: true });
    subscription.unsubscribe();
  });

  it('clears retained capabilities when the network changes', () => {
    const networkChanged$ = new Subject<string>();
    const api = { getChains$: () => of([capability('dogecoin', 'one')]) };
    const state = { isBrowser: true, network: '', networkChanged$ };
    const service = new ChainHealthService(api as never, state as never);
    const seen: ChainHealthState[] = [];
    const subscription = service.state$.subscribe(s => seen.push(s));
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)?.capabilities).toHaveLength(1);
    state.network = 'testnet';
    networkChanged$.next('testnet');
    // The partition switch emits the loading state first: no carry-over.
    expect(seen.some((s, index) => index > 0 && s.loading && s.capabilities.length === 0)).toBe(true);
    subscription.unsubscribe();
  });

  it('keeps the last good dashboard view through a failed poll', () => {
    const answers = [
      () => of(view('2026-09-16T09:00:00.000Z')),
      () => throwError(() => new Error('boom')),
      () => of(view('2026-09-16T09:01:00.000Z')),
    ];
    let call = 0;
    const api = { getChainDashboard$: () => answers[call++](), getChainMempool$: () => of({}) };
    const live = { stream$: () => new Subject<unknown>() };
    const health = { capability$: () => of(null) };
    const service = new ChainDashboardService(api as never, live as never, health as never);
    const seen: ChainDashboardState[] = [];
    const subscription = service.dashboard$('dogecoin').subscribe(s => seen.push(s));
    vi.advanceTimersByTime(200);
    expect(seen.at(-1)).toMatchObject({ error: null, stale: false });
    vi.advanceTimersByTime(15_200);
    expect(seen.at(-1)).toMatchObject({ error: 'dashboard-unavailable', stale: true });
    expect(seen.at(-1)?.view?.observedAt).toBe('2026-09-16T09:00:00.000Z');
    vi.advanceTimersByTime(15_200);
    expect(seen.at(-1)).toMatchObject({ error: null, stale: false });
    expect(seen.at(-1)?.view?.observedAt).toBe('2026-09-16T09:01:00.000Z');
    subscription.unsubscribe();
  });

  it('tells the typed not-offered refusal of the overlay apart from a source outage', () => {
    // The overlay answers 503 {"message":"dogecoin-network-unavailable"} when
    // the statistics are offered for mainnet only and the frontend is bound to
    // another network; that is not an outage and must not read as one.
    const refusal = { status: 503, error: { message: 'dogecoin-network-unavailable', statusCode: 503 } };
    expect(isNetworkNotOffered(refusal)).toBe(true);
    expect(isNetworkNotOffered({ status: 503, error: { message: 'dogecoin-mempool-unavailable' } })).toBe(false);
    expect(isNetworkNotOffered(new Error('boom'))).toBe(false);
    const api = { getChainDashboard$: () => throwError(() => refusal), getChainMempool$: () => of({}) };
    const live = { stream$: () => new Subject<unknown>() };
    const health = { capability$: () => of(null) };
    const service = new ChainDashboardService(api as never, live as never, health as never);
    const seen: ChainDashboardState[] = [];
    const subscription = service.dashboard$('dogecoin').subscribe(s => seen.push(s));
    vi.advanceTimersByTime(200);
    expect(seen.at(-1)).toMatchObject({ view: null, error: 'network-not-offered' });
    subscription.unsubscribe();
  });
});
