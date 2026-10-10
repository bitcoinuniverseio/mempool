import { DefaultUrlSerializer, defaultUrlMatcher, Route, Routes, convertToParamMap } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ClockComponent } from '@components/clock/clock.component';
import { StateService } from './state.service';
import { FeeEstimateState } from './fee-estimate';

let appRoutes: Routes;
beforeAll(async () => {
  vi.stubGlobal('window', { __env: { BASE_MODULE: 'mempool' }, innerWidth: 360, innerHeight: 800 });
  appRoutes = (await import('@app/app-routing.module')).routes;
});
afterAll(() => vi.unstubAllGlobals());

function matchClock(url: string): { route: Route; mode?: string; index?: string; redirected?: string } {
  const tree = new DefaultUrlSerializer().parse(url);
  const group = tree.root.children.primary;
  const network = ['testnet', 'testnet4', 'signet', 'regtest'].includes(group.segments[0]?.path) ? group.segments[0].path : '';
  const candidates = network ? appRoutes.find(route => route.path === network).children : appRoutes.filter(route => route.path?.startsWith('clock'));
  const segments = network ? group.segments.slice(1) : group.segments;
  for (const route of candidates) {
    if (!route.path?.startsWith('clock')) { continue; }
    const match = defaultUrlMatcher(segments, group, route);
    if (!match) { continue; }
    if (route.redirectTo && segments.length === match.consumed.length) {
      const destination = String(route.redirectTo).replace(':mode', match.posParams?.mode?.path || '');
      return { route, redirected: `/${network ? network + '/' : ''}${destination}` };
    }
    if (route.component && segments.length === match.consumed.length) {
      return { route, mode: match.posParams.mode.path, index: match.posParams.index.path };
    }
  }
  throw new Error(`Clock did not match ${url}`);
}

describe('actual Bitcoin network Clock route configuration', () => {
  it.each(['testnet', 'testnet4', 'signet', 'regtest'])('recognizes direct links and refreshes under %s before any master-page or wildcard fallback', network => {
    const children = appRoutes.find(route => route.path === network).children;
    expect(children.findIndex(route => route.path === 'clock/:mode/:index')).toBeLessThan(children.findIndex(route => route.path === '' && route.pathMatch !== 'full'));
    expect(children.findIndex(route => route.path === 'clock/:mode/:index')).toBeLessThan(children.findIndex(route => route.path === '**'));
    for (const mode of ['mempool', 'mined']) {
      const url = `/${network}/clock/${mode}/0?stats=false#clock`;
      expect(matchClock(url)).toMatchObject({ route: { component: ClockComponent }, mode, index: '0' });
      expect(matchClock(new DefaultUrlSerializer().serialize(new DefaultUrlSerializer().parse(url)))).toMatchObject({ mode, index: '0' });
    }
  });
  it.each(['testnet', 'testnet4', 'signet', 'regtest'])('keeps defaults relative to the %s parent', network => {
    const first = matchClock(`/${network}/clock`).redirected;
    expect(first).toBe(`/${network}/clock/mempool/0`);
    expect(matchClock(first)).toMatchObject({ route: { component: ClockComponent }, mode: 'mempool', index: '0' });
    const mined = matchClock(`/${network}/clock/mined`).redirected;
    expect(mined).toBe(`/${network}/clock/mined/0`);
    expect(matchClock(mined)).toMatchObject({ mode: 'mined', index: '0' });
  });
  it('retains the existing root Clock routes and redirects', () => {
    expect(appRoutes.filter(route => route.path?.startsWith('clock')).map(route => ({ path: route.path, redirectTo: route.redirectTo }))).toEqual([
      { path: 'clock', redirectTo: 'clock/mempool/0' }, { path: 'clock/:mode', redirectTo: 'clock/:mode/0' }, { path: 'clock/:mode/:index', redirectTo: undefined },
    ]);
    expect(matchClock('/clock/mempool/0')).toMatchObject({ route: { component: ClockComponent }, mode: 'mempool', index: '0' });
  });
  it('uses the real URL network selection and existing Clock shared fee state on a Signet deep link', () => {
    vi.useFakeTimers();
    const fees = new FeeEstimateState();
    const changed = new Subject<string>();
    changed.subscribe(network => fees.reset(network));
    const state = Object.assign(Object.create(StateService.prototype), { network: '', networkChanged$: changed,
      feeEstimate$: fees.snapshot$, blocks$: new Subject(), mempoolInfo$: new Subject(), env: { BASE_MODULE: 'mempool', ROOT_NETWORK: '', BLOCK_WEIGHT_UNITS: 4000000 } }) as StateService;
    state.setNetworkBasedonUrl('/signet/clock/mempool/0');
    const match = matchClock('/signet/clock/mempool/0');
    const component = new ClockComponent(state, { want: vi.fn() } as never,
      { queryParams: of({}), paramMap: of(convertToParamMap({ mode: match.mode, index: match.index })) } as never,
      { navigate: vi.fn() } as never, { transform: (value: string) => '/signet' + value } as never, { markForCheck: vi.fn() } as never);
    try {
      component.ngOnInit();
      expect(component.stateService.network).toBe('signet');
      expect(component.feeEstimate$).toBe(fees.snapshot$);
      expect(component.mode).toBe('mempool');
      expect(fees.snapshot$.value.network).toBe('signet');
      fees.accept({ schemaVersion: 'universe-fee-estimate-v1', chain: 'bitcoin', network: 'mainnet', status: 'ready', observedAt: new Date().toISOString(),
        tip: { height: 1, hash: 'a'.repeat(64) }, values: { fastestFee: 99, halfHourFee: 99, hourFee: 99, economyFee: 99, minimumFee: 99 }, reason: null });
      expect(fees.snapshot$.value.values).toBeNull();
    } finally { component.pageSubscription.unsubscribe(); component.blocksSubscription.unsubscribe(); fees.destroy(); vi.useRealTimers(); }
  });
});
