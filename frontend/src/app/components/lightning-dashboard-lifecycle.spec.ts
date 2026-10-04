import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { LightningDashboardComponent } from '../lightning/lightning-dashboard/lightning-dashboard.component';

function setup(isBrowser = true) {
  vi.stubGlobal('window', { innerWidth: 1000 });
  const network = new BehaviorSubject('signet'), stats = new Subject<any>(), ranking = new Subject<any>();
  const api = { getLatestStatistics$: vi.fn(() => stats), getNodesRanking$: vi.fn(() => ranking) };
  const c = new LightningDashboardComponent(api as any, { setTitle: vi.fn(), setDescription: vi.fn() } as any, {} as any,
    { env: {}, isBrowser, networkChanged$: network } as any, { markForCheck: vi.fn() } as any);
  c.ngOnInit(); return { c, api, stats, ranking, network };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('native Lightning dashboard ownership', () => {
  it('cancels the old pending statistics and rankings on a network change and projects no stale value', () => {
    const f = setup(), values: any[] = [], next = new Subject<any>();
    const a = f.c.statistics$.subscribe(value => values.push(value)), b = f.c.nodesRanking$.subscribe();
    f.api.getLatestStatistics$.mockReturnValueOnce(next); f.api.getNodesRanking$.mockReturnValueOnce(new Subject<any>());
    f.network.next('testnet4'); expect(f.stats.observed).toBe(false); expect(f.ranking.observed).toBe(false);
    f.stats.next({ latest: { node_count: 999 } }); expect(values.at(-1)).toBeNull(); a.unsubscribe(); b.unsubscribe();
  });
  it.each([true, false])('tears down pending source observers on destroy (browser=%s)', isBrowser => {
    const f = setup(isBrowser), a = f.c.statistics$.subscribe(), b = f.c.nodesRanking$.subscribe();
    (f.c as any).ngOnDestroy?.(); expect(f.stats.observed).toBe(false); expect(f.ranking.observed).toBe(false);
    a.unsubscribe(); b.unsubscribe();
  });
  it('shows provider failure without terminating scope and recovers after an explicit retry', () => {
    const f = setup(), failed = vi.fn(), values: any[] = [];
    const a = f.c.statistics$.subscribe({ next: value => values.push(value), error: failed });
    f.stats.error({ status: 503 }); expect(failed).not.toHaveBeenCalled(); expect((f.c as any).statisticsError).toContain('unavailable');
    f.ranking.complete();
    const valid = { latest: { node_count: 1, channel_count: 1, total_capacity: 100000 }, previous: null };
    f.api.getLatestStatistics$.mockReturnValueOnce(of(valid) as any); (f.c as any).retry();
    expect(values.at(-1)).toEqual(valid); expect((f.c as any).statisticsError).toBeNull(); a.unsubscribe(); (f.c as any).ngOnDestroy();
  });
  it('bounds an unavailable page, keeps the owned retry subscription alive without child subscribers and blocks work after destroy', () => {
    vi.useFakeTimers(); const f = setup();
    vi.advanceTimersByTime(15001); expect(f.stats.observed).toBe(false); expect(f.ranking.observed).toBe(false);
    expect(f.c.statisticsError).toContain('unavailable'); expect(f.c.rankingError).toContain('unavailable');
    const stats = { latest: { node_count: 1, channel_count: 1, total_capacity: 100000 }, previous: null };
    f.api.getLatestStatistics$.mockReturnValueOnce(of(stats) as any); f.api.getNodesRanking$.mockReturnValueOnce(of({ topByCapacity: [], topByChannels: [] }) as any);
    f.c.retry(); expect(f.c.statisticsError).toBeNull(); expect(f.c.rankingError).toBeNull();
    expect(f.api.getLatestStatistics$).toHaveBeenCalledTimes(2); f.c.ngOnDestroy(); f.c.retry(); f.network.next('testnet');
    expect(f.api.getLatestStatistics$).toHaveBeenCalledTimes(2);
  });
});
