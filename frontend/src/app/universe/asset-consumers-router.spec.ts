// @vitest-environment jsdom
import 'zone.js';
import { Component, inject, ɵresolveComponentResources } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ActivatedRoute, NavigationStart, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, Subscription } from 'rxjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RuneComponent } from './rune/rune.component';
import { SatComponent } from './sat/sat.component';
import { UniverseApiService } from './universe-api.service';

let api: UniverseApiService;
@Component({ standalone: true, template: '' })
class RoutedRune extends RuneComponent {
  constructor() { super(inject(ActivatedRoute), api, { recordVisit: vi.fn() } as never, { setTitle: vi.fn() } as never, inject(Router)); }
}
@Component({ standalone: true, template: '' })
class RoutedSat extends SatComponent {
  constructor() { super(inject(ActivatedRoute), api, { recordVisit: vi.fn() } as never, { setTitle: vi.fn() } as never, inject(Router)); }
}

beforeAll(async () => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  await ɵresolveComponentResources(() => Promise.resolve(''));
});
describe.each(['rune', 'sat'] as const)('%s real Router read boundary', kind => {
  let networkSubscription: Subscription;
  afterEach(() => { networkSubscription?.unsubscribe(); TestBed.resetTestingModule(); });

  async function setup(): Promise<{
    harness: RouterTestingHarness; router: Router; gate: Subject<boolean>; urls: string[]; responses: Subject<unknown>[];
  }> {
    const gate = new Subject<boolean>();
    TestBed.configureTestingModule({ providers: [provideRouter([
      { path: ':network/' + kind + '/:reference', component: kind === 'rune' ? RoutedRune : RoutedSat,
        canActivate: [(route): boolean | Subject<boolean> => route.params.reference === '2' ? gate : true] },
    ]), provideLocationMocks()] });
    const router = TestBed.inject(Router);
    const changed = new Subject<string>();
    const state = { isBrowser: true, network: 'mainnet', env: {}, networkChanged$: changed };
    const urls: string[] = [], responses: Subject<unknown>[] = [];
    api = new UniverseApiService({ get: (url: string): Subject<unknown> => {
      urls.push(url); const response = new Subject<unknown>(); responses.push(response); return response;
    } } as never, state as never, {} as never);
    // StateService selects scope at NavigationStart, before child activation.
    networkSubscription = router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        state.network = event.url.startsWith('/signet/') ? 'signet' : 'mainnet';
        changed.next(state.network);
      }
    });
    const harness = await RouterTestingHarness.create('/mainnet/' + kind + '/1');
    return { harness, router, gate, urls, responses };
  }

  it('issues only the activated new reference/scope after a delayed guard and ignores the cancelled read', async () => {
    const f = await setup();
    expect(f.urls).toHaveLength(1);
    const component = f.harness.routeDebugElement.componentInstance as RuneComponent | SatComponent;
    const states: string[] = [];
    const sub = component.state$.subscribe(value => states.push(value.kind));
    const navigation = f.router.navigateByUrl('/signet/' + kind + '/2');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.urls).toHaveLength(1);
    expect(f.responses[0].observed).toBe(false);
    expect(states.at(-1)).toBe('loading');
    f.gate.next(true); await navigation;
    expect(f.urls).toHaveLength(2);
    expect(f.urls[1]).toContain('/' + (kind === 'rune' ? 'runes' : 'sats') + '/2?chain=bitcoin&network=signet');
    f.responses[0].next({ status: 'ok', value: { rune: 'old', numberAtomic: '1' } });
    expect(states.at(-1)).toBe('loading');
    sub.unsubscribe();
  });

  it('does not read a cancelled navigation and only activates the latest overlapping navigation', async () => {
    const f = await setup();
    const component = f.harness.routeDebugElement.componentInstance as RuneComponent | SatComponent;
    const states: string[] = [];
    const sub = component.state$.subscribe(value => states.push(value.kind));
    const navigation = f.router.navigateByUrl('/signet/' + kind + '/2');
    await new Promise(resolve => setTimeout(resolve, 0));
    f.gate.next(false); expect(await navigation).toBe(false);
    expect(f.urls).toHaveLength(1);
    expect(states.at(-1)).toBe('unavailable');
    component.retry();
    expect(f.urls).toHaveLength(1);
    expect(states.at(-1)).toBe('unavailable');
    const held = f.router.navigateByUrl('/signet/' + kind + '/2');
    await new Promise(resolve => setTimeout(resolve, 0));
    await f.router.navigateByUrl('/mainnet/' + kind + '/3');
    expect(await held).toBe(false);
    expect(f.urls).toHaveLength(2);
    expect(f.urls[1]).toContain('/3?chain=bitcoin&network=mainnet');
    f.gate.next(true);
    expect(f.urls).toHaveLength(2);
    sub.unsubscribe();
  });

  it('restores one completed identical context for query-only navigation but manual retry reads again', async () => {
    const f = await setup();
    const component = f.harness.routeDebugElement.componentInstance as RuneComponent | SatComponent;
    const states: string[] = [];
    const sub = component.state$.subscribe(value => states.push(value.kind));
    f.responses[0].next({ status: 'ok', value: { rune: '1', spacedRune: '1', numberAtomic: '1' } });
    f.responses[0].complete();
    expect(states.at(-1)).toBe('ready');
    await f.router.navigateByUrl('/mainnet/' + kind + '/1?unrelated=value');
    expect(f.urls).toHaveLength(1);
    expect(states.at(-1)).toBe('ready');
    component.retry();
    expect(f.urls).toHaveLength(2);
    expect(states.at(-1)).toBe('loading');
    sub.unsubscribe();
  });
});
