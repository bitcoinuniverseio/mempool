// @vitest-environment jsdom
import 'zone.js';
import { Component, inject, ɵresolveComponentResources } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import {
  ActivatedRoute,
  NavigationStart,
  Router,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Subject, Subscription } from 'rxjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { InscriptionComponent } from './inscription.component';
import { UniverseApiService } from '../universe-api.service';
import { NamesAssetViewState } from '../names-explorer-asset';
const raw = JSON.parse(
  readFileSync(
    'src/app/universe/inscription/names-explorer-asset.paired-fixture.json',
    'utf8'
  )
);
const id = raw.assetId,
  id2 = 'e'.repeat(64) + 'i0',
  id3 = 'f'.repeat(64) + 'i0';
let api: UniverseApiService;
@Component({ standalone: true, template: '' })
class RoutedInscription extends InscriptionComponent {
  private namesSubscription?: Subscription;
  constructor() {
    super(
      inject(ActivatedRoute),
      api,
      { recordVisit: vi.fn() } as never,
      { setTitle: vi.fn() } as never,
      inject(Router)
    );
  }
  override ngOnInit(): void {
    super.ngOnInit();
    this.namesSubscription = this.namesState$.subscribe();
  }
  override ngOnDestroy(): void {
    this.namesSubscription?.unsubscribe();
    super.ngOnDestroy();
  }
}
beforeAll(async () => {
  TestBed.initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting()
  );
  await ɵresolveComponentResources(() => Promise.resolve(''));
});
let networkSubscription: Subscription;
afterEach(() => {
  networkSubscription?.unsubscribe();
  TestBed.resetTestingModule();
  vi.useRealTimers();
});
async function setup(): Promise<{
  harness: RouterTestingHarness;
  router: Router;
  gate: Subject<boolean>;
  calls: Array<{ url: string; response: Subject<unknown> }>;
  component: RoutedInscription;
}> {
  const gate = new Subject<boolean>();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          path: ':network/inscription/:reference',
          component: RoutedInscription,
          canActivate: [
            (route): boolean | Subject<boolean> =>
              route.params.reference === id2 ? gate : true,
          ],
        },
      ]),
      provideLocationMocks(),
    ],
  });
  const router = TestBed.inject(Router),
    changed = new Subject<string>(),
    state = {
      isBrowser: true,
      network: 'mainnet',
      env: {},
      networkChanged$: changed,
    },
    calls: Array<{ url: string; response: Subject<unknown> }> = [];
  api = new UniverseApiService(
    {
      get: (url: string): Subject<unknown> => {
        const response = new Subject<unknown>();
        calls.push({ url, response });
        return response;
      },
    } as never,
    state as never,
    {} as never
  );
  networkSubscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      state.network = event.url.startsWith('/signet/') ? 'signet' : 'mainnet';
      changed.next(state.network);
    }
  });
  const harness = await RouterTestingHarness.create(
    '/mainnet/inscription/' + id + '?protocol=names'
  );
  return {
    harness,
    router,
    gate,
    calls,
    component: harness.routeDebugElement.componentInstance as RoutedInscription,
  };
}
function served(): unknown {
  const value = structuredClone(raw),
    stamp = new Date().toISOString();
  value.observedAt = stamp;
  value.checkpoint.observedAt = stamp;
  value.ownership.observedAt = stamp;
  value.ownership.checkpoint.observedAt = stamp;
  return {
    schemaVersion: 'universe-names-explorer-asset-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    authorityId: 'index-names',
    status: 'served',
    value,
  };
}
const isNames = (url: string): boolean =>
  url.includes('/protocols/names/objects/');
describe('real Router Names and ordinary inscription boundary', () => {
  it('initial active navigation and delayed changed ref/scope issue no intermediate wrong reference', async () => {
    const f = await setup();
    expect(f.calls).toHaveLength(2);
    const states: NamesAssetViewState[] = [];
    const sub = f.component.namesState$.subscribe((s) => states.push(s));
    const nav = f.router.navigateByUrl(
      '/signet/inscription/' + id2 + '?protocol=names'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every((c) => !c.response.observed)).toBe(true);
    expect(states.at(-1)?.kind).toBe('loading');
    f.gate.next(true);
    await nav;
    expect(f.calls).toHaveLength(4);
    for (const c of f.calls.slice(2)) {
      expect(c.url).toContain(id2);
      expect(c.url).toContain('network=signet');
    }
    f.calls.find((c) => isNames(c.url)).response.next(served());
    expect(states.at(-1)?.kind).toBe('loading');
    sub.unsubscribe();
  });
  it('canceled and overlapping navigation never reads canceled reference and retry does not override cancellation', async () => {
    const f = await setup();
    const states: NamesAssetViewState[] = [];
    const sub = f.component.namesState$.subscribe((s) => states.push(s));
    const nav = f.router.navigateByUrl(
      '/signet/inscription/' + id2 + '?protocol=names'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.gate.next(false);
    expect(await nav).toBe(false);
    expect(states.at(-1)?.kind).toBe('unavailable');
    f.component.retry();
    f.component.retryNames();
    expect(f.calls).toHaveLength(2);
    const old = f.router.navigateByUrl(
      '/signet/inscription/' + id2 + '?protocol=names'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.router.navigateByUrl(
      '/mainnet/inscription/' + id3 + '?protocol=names'
    );
    expect(await old).toBe(false);
    expect(f.calls).toHaveLength(4);
    expect(f.calls.slice(2).every((c) => c.url.includes(id3))).toBe(true);
    f.gate.next(true);
    expect(f.calls).toHaveLength(4);
    sub.unsubscribe();
  });
  it('completed query-only navigation restores original Names expiry and ordinary state without HTTP; manual retry reads once', async () => {
    const f = await setup(),
      states: NamesAssetViewState[] = [];
    const sub = f.component.namesState$.subscribe((s) => states.push(s));
    vi.useFakeTimers();
    for (const c of f.calls) {
      c.response.next(
        isNames(c.url)
          ? served()
          : {
              status: 'ok',
              chain: 'bitcoin',
              network: 'mainnet',
              value: { id, numberAtomic: '1' },
            }
      );
      c.response.complete();
    }
    expect(states.at(-1)?.kind).toBe('ready');
    vi.advanceTimersByTime(15000);
    await f.router.navigateByUrl(
      '/mainnet/inscription/' + id + '?protocol=names&unrelated=1'
    );
    expect(f.calls).toHaveLength(2);
    expect(states.at(-1)?.kind).toBe('ready');
    vi.advanceTimersByTime(15001);
    expect(states.at(-1)?.kind).toBe('unavailable');
    f.component.retry();
    f.component.retryNames();
    expect(f.calls).toHaveLength(4);
    sub.unsubscribe();
  });
  it('query duplicates reject without source reads and leaving explicit context removes Names state', async () => {
    const f = await setup(),
      states: NamesAssetViewState[] = [];
    const sub = f.component.namesState$.subscribe((s) => states.push(s));
    await f.router.navigateByUrl(
      '/mainnet/inscription/' + id + '?protocol=names&protocol=names'
    );
    expect(states.at(-1)?.kind).toBe('unavailable');
    expect(f.calls.filter((c) => isNames(c.url))).toHaveLength(1);
    await f.router.navigateByUrl('/mainnet/inscription/' + id);
    expect(states.at(-1)?.kind).toBe('absent');
    expect(f.calls.filter((c) => isNames(c.url))).toHaveLength(1);
    sub.unsubscribe();
  });
});
