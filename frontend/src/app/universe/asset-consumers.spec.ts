import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { BehaviorSubject, Observable, Subject, defer, throwError } from 'rxjs';
import { RuneComponent } from './rune/rune.component';
import { SatComponent } from './sat/sat.component';
import { UniverseApiService } from './universe-api.service';
import type { AssetLookupResult, ExplorerNetwork } from './universe.types';

const ready = (reference: string): AssetLookupResult<never> => ({
  schemaVersion: 'universe-explorer-asset-v1', status: 'ok', authorityId: 'ord', checkpoint: null,
  value: { rune: reference, spacedRune: reference, numberAtomic: reference },
} as AssetLookupResult<never>);

interface ConsumerFixture {
  component: RuneComponent | SatComponent;
  params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  network: BehaviorSubject<ExplorerNetwork>;
  request: ReturnType<typeof vi.fn<() => Observable<AssetLookupResult<never>>>>;
  responses: Subject<AssetLookupResult<never>>[];
  detached: number[];
  states: string[];
  local: { recordVisit: ReturnType<typeof vi.fn> };
  breakScope(value: boolean): void;
  close(): void;
}

function setup(kind: 'rune' | 'sat'): ConsumerFixture {
  const params = new BehaviorSubject(convertToParamMap({ reference: '1' }));
  const network = new BehaviorSubject<ExplorerNetwork>('mainnet');
  let broken = false;
  const responses: Subject<AssetLookupResult<never>>[] = [];
  const detached: number[] = [];
  const request = vi.fn(() => new Observable<AssetLookupResult<never>>(subscriber => {
    const index = responses.length;
    const response = new Subject<AssetLookupResult<never>>();
    responses.push(response);
    const subscription = response.subscribe(subscriber);
    return (): void => { detached.push(index); subscription.unsubscribe(); };
  }));
  const api = { selectedNetwork$: (): Observable<ExplorerNetwork> => defer(() => broken ? throwError(() => Error('configuration')) : network),
    getRune$: request, getSat$: request, assetLookupDeadlineMs: 35_000 };
  const local = { recordVisit: vi.fn() };
  const args = [{ paramMap: params }, api, local, { setTitle: vi.fn() }] as const;
  const component = kind === 'rune'
    ? new RuneComponent(args[0] as never, args[1] as never, args[2] as never, args[3] as never)
    : new SatComponent(args[0] as never, args[1] as never, args[2] as never, args[3] as never);
  component.ngOnInit();
  const states: string[] = [];
  const subscription = component.state$.subscribe(state => states.push(state.kind));
  return { component, params, network, request, responses, detached, states, local,
    breakScope: (value: boolean): void => { broken = value; },
    close: (): void => { subscription.unsubscribe(); component.ngOnDestroy(); } };
}

describe.each(['rune', 'sat'] as const)('%s asset attempt lifecycle', kind => {
  afterEach(() => vi.useRealTimers());

  it('makes exactly one scoped HTTP read per selection with the real nested API selector', () => {
    const changed = new Subject<string>();
    const state = { isBrowser: true, network: 'mainnet', env: {}, networkChanged$: changed };
    const responses: Subject<unknown>[] = [];
    const urls: string[] = [];
    const get = vi.fn((url: string): Subject<unknown> => { urls.push(url); const response = new Subject<unknown>(); responses.push(response); return response; });
    const api = new UniverseApiService({ get } as never, state as never, {} as never);
    const route = { paramMap: new BehaviorSubject(convertToParamMap({ reference: '1' })) };
    const component = kind === 'rune'
      ? new RuneComponent(route as never, api, { recordVisit: vi.fn() } as never, { setTitle: vi.fn() } as never)
      : new SatComponent(route as never, api, { recordVisit: vi.fn() } as never, { setTitle: vi.fn() } as never);
    component.ngOnInit();
    const seen: string[] = [];
    const subscription = component.state$.subscribe(value => seen.push(value.kind));
    expect(get).toHaveBeenCalledTimes(1);
    responses[0].next(ready('1'));
    state.network = 'signet'; changed.next('signet');
    expect(get).toHaveBeenCalledTimes(2);
    expect(urls[1]).toContain('network=signet');
    expect(responses[0].observed).toBe(false);
    expect(seen.at(-1)).toBe('loading');
    component.retry();
    expect(get).toHaveBeenCalledTimes(3);
    subscription.unsubscribe(); component.ngOnDestroy();
    expect(responses[2].observed).toBe(false);
  });

  it('shares consumers, resets context immediately and rejects late old results', () => {
    const f = setup(kind);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.responses[0].next(ready('1'));
    f.network.next('signet');
    expect(f.states).toEqual(['loading', 'ready', 'loading']);
    expect(f.detached).toContain(0);
    f.responses[0].next(ready('old'));
    expect(f.states.at(-1)).toBe('loading');
    expect(f.local.recordVisit).toHaveBeenCalledTimes(1);
    f.responses[1].next(ready('new'));
    f.params.next(convertToParamMap({ reference: '2' }));
    expect(f.states.at(-1)).toBe('loading');
    expect(f.request).toHaveBeenCalledTimes(3);
    f.close();
    expect(f.detached).toContain(2);
  });

  it('bounds NEVER and allows one shared manual retry without automatic retries', async () => {
    vi.useFakeTimers();
    const f = setup(kind);
    await vi.advanceTimersByTimeAsync(35_000);
    expect(f.states).toEqual(['loading', 'unavailable']);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.component.retry();
    expect(f.states.at(-1)).toBe('loading');
    expect(f.request).toHaveBeenCalledTimes(2);
    f.responses[1].next(ready('1'));
    expect(f.states.at(-1)).toBe('ready');
    f.close();
  });

  it('makes outer configuration failure unavailable without reading and allows manual recovery', () => {
    const f = setup(kind);
    f.breakScope(true);
    f.component.retry();
    expect(f.states.slice(-2)).toEqual(['loading', 'unavailable']);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.breakScope(false);
    f.component.retry();
    expect(f.states.at(-1)).toBe('loading');
    expect(f.request).toHaveBeenCalledTimes(2);
    f.responses[1].next(ready('1'));
    expect(f.states.at(-1)).toBe('ready');
    f.close();
  });
});
