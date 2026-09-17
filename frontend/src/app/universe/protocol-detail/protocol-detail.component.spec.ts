// New WP01/WP07 consumer regressions. Fixture responses are not real authority acceptance.
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { ProtocolDetailComponent } from './protocol-detail.component';
import {
  ExplorerProtocolActivityPage,
  ExplorerProtocolDefinition,
  ExplorerProtocolObjectsPage,
  ProtocolsResponse,
  SourceEntry,
  SourcesResponse,
} from '../universe.types';
import type { PulseState } from '../universe-pulse.service';

function activity(protocolId: string): ExplorerProtocolActivityPage {
  return {
    schemaVersion: 'universe-protocol-activity-v1', protocolId, state: 'served',
    authorityId: 'fixture', feedPath: '/fixture', source: null,
    assets: [], events: [{ eventId: protocolId }], invalidations: [], holderSnapshots: [],
    nextCursor: null, hasMore: false, checkpoint: null, degradedReason: null, observedAt: '',
  };
}

function objects(protocolId: string): ExplorerProtocolObjectsPage {
  return {
    schemaVersion: 'universe-protocol-objects-v1', protocolId, state: 'served',
    authorityId: 'fixture', objectsPath: '/fixture', items: [{ id: protocolId }],
    nextCursor: null, checkpoint: null, degradedReason: null, observedAt: '',
  };
}

describe('Protocol detail pending reads', () => {
  it('cancels old pages on protocol change and disposes reads on destruction', () => {
    const activityRequests: Subject<ExplorerProtocolActivityPage>[] = [];
    const objectRequests: Subject<ExplorerProtocolObjectsPage>[] = [];
    const api = {
      getProtocolActivity$: (): Subject<ExplorerProtocolActivityPage> => {
        const request = new Subject<ExplorerProtocolActivityPage>(); activityRequests.push(request); return request;
      },
      getProtocolObjects$: (): Subject<ExplorerProtocolObjectsPage> => {
        const request = new Subject<ExplorerProtocolObjectsPage>(); objectRequests.push(request); return request;
      },
    };
    const component = new ProtocolDetailComponent({} as never, api as never,
      { stop: vi.fn() } as never, {} as never, {} as never);
    component.loadActivity('alkanes'); component.loadObjects('bitmap');
    component.loadActivity('brc20'); component.loadObjects('names');
    expect(activityRequests[0].observed).toBe(false);
    expect(objectRequests[0].observed).toBe(false);
    activityRequests[0].next(activity('alkanes')); objectRequests[0].next(objects('bitmap'));
    expect(component.activity$.value.kind).toBe('loading');
    expect(component.objects$.value.kind).toBe('loading');
    activityRequests[1].next(activity('brc20')); objectRequests[1].next(objects('names'));
    expect(component.activity$.value.page?.protocolId).toBe('brc20');
    expect(component.objects$.value.page?.protocolId).toBe('names');
    expect(activityRequests[1].observed).toBe(false);
    expect(objectRequests[1].observed).toBe(false);
    component.loadActivity('stamps'); component.loadObjects('patina');
    component.ngOnDestroy();
    expect(activityRequests[2].observed).toBe(false);
    expect(objectRequests[2].observed).toBe(false);
  });
});

describe.each(['activity', 'objects'] as const)('Protocol detail %s failure recovery', (kind) => {
  it.each(['transport', 'unavailable'] as const)('keeps the previous page and retries its cursor after %s failure', (failureKind) => {
    const protocolId = kind === 'activity' ? 'mezcal' : 'names';
    const first = kind === 'activity' ? { ...activity(protocolId), nextCursor: 'next', hasMore: true }
      : { ...objects(protocolId), nextCursor: 'next' };
    const reason = 'The authority did not answer with a usable page (deadline).';
    const failed = failureKind === 'transport' ? throwError(() => ({ status: 404 }))
      : of({ ...first, state: 'unavailable', degradedReason: reason, nextCursor: null,
        ...(kind === 'activity' ? { source: null, assets: [], events: [], invalidations: [], holderSnapshots: [], hasMore: false } : { items: [] }) });
    const second = kind === 'activity' ? activity(protocolId) : objects(protocolId);
    const read = vi.fn().mockReturnValueOnce(of(first)).mockReturnValueOnce(failed).mockReturnValueOnce(of(second));
    const api = kind === 'activity' ? { getProtocolActivity$: read } : { getProtocolObjects$: read };
    const component = new ProtocolDetailComponent({} as never, api as never,
      { stop: vi.fn() } as never, {} as never, {} as never);
    const load = (): void => kind === 'activity' ? component.loadActivity(protocolId) : component.loadObjects(protocolId);
    const more = (): void => kind === 'activity' ? component.loadMoreActivity(protocolId) : component.loadMoreObjects(protocolId);
    const state = kind === 'activity' ? component.activity$ : component.objects$;
    load();
    const prior = state.value;
    more();
    expect(state.value.page).toBe(prior.page);
    expect(state.value.rows).toBe(prior.rows);
    expect(state.value.loadingMore).toBe(false);
    expect(state.value.loadMoreError).toBeTruthy();
    if (failureKind === 'unavailable') {expect(state.value.loadMoreError).toBe(reason);}
    more();
    expect(read.mock.calls.map((call) => call[1])).toEqual([undefined, 'next', 'next']);
    expect(state.value.loadMoreError).toBeUndefined();
    expect(state.value.rows).toHaveLength(2);
    component.ngOnDestroy();
  });

  it('exposes first-page failure and supports an explicit retry', () => {
    const protocolId = kind === 'activity' ? 'mezcal' : 'names';
    const body = kind === 'activity' ? activity(protocolId) : objects(protocolId);
    const read = vi.fn().mockReturnValueOnce(throwError(() => new Error('contract-mismatch'))).mockReturnValueOnce(of(body));
    const api = kind === 'activity' ? { getProtocolActivity$: read } : { getProtocolObjects$: read };
    const component = new ProtocolDetailComponent({} as never, api as never,
      { stop: vi.fn() } as never, {} as never, {} as never);
    const load = (): void => kind === 'activity' ? component.loadActivity(protocolId) : component.loadObjects(protocolId);
    const state = kind === 'activity' ? component.activity$ : component.objects$;
    load();
    expect(state.value).toEqual({ kind: 'error' });
    expect(read).toHaveBeenCalledTimes(1);
    load();
    expect(state.value.kind).toBe('loaded');
    expect(state.value.page?.protocolId).toBe(protocolId);
    component.ngOnDestroy();
  });
});

function definition(overrides: Partial<ExplorerProtocolDefinition> = {}): ExplorerProtocolDefinition {
  return {
    schemaVersion: 'universe-explorer-protocol-v1',
    id: 'ordinals',
    aliases: [],
    displayName: 'Ordinals',
    shortName: 'Ordinals',
    family: 'ORDINALS',
    chain: 'bitcoin',
    networks: ['mainnet'],
    icon: 'protocol-ordinals',
    visualToken: 'protocol-ordinals',
    implementedReadOperations: ['registry', 'activity'],
    authorizedReadOperations: [],
    releaseStatus: 'VERIFIED READ ONLY',
    indexerAuthority: 'index-ordinals',
    coverage: 'unknown',
    ...overrides,
  };
}

function registryOf(...protocols: ExplorerProtocolDefinition[]): ProtocolsResponse {
  return { registryVersion: '1.0.0', primaryStrip: [], protocols };
}

function sourceEntry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    authorityId: 'index-ordinals',
    protocols: ['ordinals'],
    ready: true,
    status: 'ready',
    checkpoint: { heightAtomic: '964103', blockHash: 'a'.repeat(64), observedAt: 'now' },
    checkedAt: 'now',
    ...overrides,
  };
}

const idlePulse: PulseState = {
  checked: 0, withAssets: 0, protocolCounts: new Map(), recent: [],
  observation: 'unknown', lastSampleAt: null, startedAt: 0, ceilingReached: false,
};

/** A routed detail page over controllable registry and snapshot reads. */
function routed(options: {
  registry: () => Observable<ProtocolsResponse>;
  sources?: () => Observable<SourcesResponse>;
}): { component: ProtocolDetailComponent; params: BehaviorSubject<{ get(key: string): string | null }>; states: string[] } {
  const params = new BehaviorSubject<{ get(key: string): string | null }>({ get: () => 'ordinals' });
  const api = {
    getProtocols$: options.registry,
    getSources$: options.sources ?? ((): Observable<SourcesResponse> => of({ generatedAt: 'now', sources: [sourceEntry()] })),
    getProtocolActivity$: (protocolId: string) => of(activity(protocolId)),
    getProtocolObjects$: (protocolId: string) => of(objects(protocolId)),
  };
  const pulse = { start: vi.fn(), stop: vi.fn(), state$: of(idlePulse) };
  const local = { preferences$: of({ pinnedProtocols: [] }), recordVisit: vi.fn(), togglePinnedProtocol: vi.fn() };
  const seo = { setTitle: vi.fn() };
  const component = new ProtocolDetailComponent(
    { paramMap: params } as never, api as never, pulse as never, local as never, seo as never);
  component.ngOnInit();
  const states: string[] = [];
  component.vm$.subscribe((vm) => states.push(vm.kind));
  return { component, params, states };
}

describe('Protocol detail registry resolution', () => {
  /**
   * The registry failure happened outside the only error handler, so the
   * page never emitted its error state: the route stream errored, the
   * template stayed blank, and no navigation could revive it.
   */
  it('emits the error state when the registry fails, and keeps the route stream alive', () => {
    const read = vi.fn()
      .mockReturnValueOnce(throwError(() => new Error('controlled registry outage')))
      .mockReturnValueOnce(of(registryOf(definition())));
    const { component, states } = routed({ registry: read });
    expect(states).toEqual(['loading', 'error']);
    expect(component.activity$.value.kind).toBe('idle');
    expect(component.objects$.value.kind).toBe('idle');

    component.retryRegistry();
    expect(read).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['loading', 'error', 'loading', 'ready']);
    expect(component.activity$.value.kind).toBe('loaded');
    expect(component.objects$.value.kind).toBe('loaded');
  });

  it('keeps a missing id distinct from a registry outage', () => {
    const { params, states } = routed({ registry: () => of(registryOf(definition())) });
    expect(states).toEqual(['loading', 'ready']);
    params.next({ get: () => 'no-such-protocol' });
    expect(states).toEqual(['loading', 'ready', 'loading', 'missing']);
  });

  it('recovers on a route change after a registry failure', () => {
    const read = vi.fn()
      .mockReturnValueOnce(throwError(() => new Error('controlled registry outage')))
      .mockReturnValueOnce(of(registryOf(definition({ id: 'runes', family: 'RUNES' }))));
    const { params, states } = routed({ registry: read });
    expect(states).toEqual(['loading', 'error']);
    params.next({ get: () => 'runes' });
    expect(states).toEqual(['loading', 'error', 'loading', 'ready']);
  });

  it('ignores a late registry answer for a protocol the route has left', () => {
    const requests: Subject<ProtocolsResponse>[] = [];
    const activityRequests: string[] = [];
    const params = new BehaviorSubject<{ get(key: string): string | null }>({ get: () => 'ordinals' });
    const api = {
      getProtocols$: (): Observable<ProtocolsResponse> => {
        const request = new Subject<ProtocolsResponse>(); requests.push(request); return request;
      },
      getSources$: () => of({ generatedAt: 'now', sources: [sourceEntry()] }),
      getProtocolActivity$: (protocolId: string) => { activityRequests.push(protocolId); return of(activity(protocolId)); },
      getProtocolObjects$: (protocolId: string) => of(objects(protocolId)),
    };
    const component = new ProtocolDetailComponent(
      { paramMap: params } as never, api as never,
      { start: vi.fn(), stop: vi.fn(), state$: of(idlePulse) } as never,
      { preferences$: of({ pinnedProtocols: [] }), recordVisit: vi.fn() } as never,
      { setTitle: vi.fn() } as never);
    component.ngOnInit();
    const painted: string[] = [];
    component.vm$.subscribe((vm) => painted.push(vm.kind === 'ready' ? vm.protocol.id : vm.kind));

    params.next({ get: () => 'runes' });
    expect(requests[0].observed).toBe(false);
    requests[0].next(registryOf(definition(), definition({ id: 'runes' })));
    expect(painted).toEqual(['loading', 'loading']);

    requests[1].next(registryOf(definition(), definition({ id: 'runes' })));
    expect(painted).toEqual(['loading', 'loading', 'runes']);
    expect(activityRequests).toEqual(['runes']);
    component.ngOnDestroy();
  });

  it('leaves availability unknown when only the authority snapshot fails', () => {
    const { component } = routed({
      registry: () => of(registryOf(definition())),
      sources: () => throwError(() => new Error('sources down')),
    });
    let vm: { kind: string; availability?: string; live?: boolean } | undefined;
    component.vm$.subscribe((value) => { vm = value; });
    expect(vm?.kind).toBe('ready');
    expect(vm?.availability).toBe('unknown');
    expect(vm?.live).toBe(false);
    expect(component.limitation(vm as never)).toContain('could not be read');
  });
});

describe('Protocol detail availability', () => {
  function readyVm(protocol: ExplorerProtocolDefinition, sources: SourceEntry[] | null): Parameters<ProtocolDetailComponent['limitation']>[0] {
    const { component } = routed({
      registry: () => of(registryOf(protocol)),
      sources: () => sources === null
        ? throwError(() => new Error('sources down'))
        : of({ generatedAt: 'now', sources }),
    });
    let vm: Parameters<ProtocolDetailComponent['limitation']>[0] | undefined;
    component.vm$.subscribe((value) => { vm = value; });
    return vm as Parameters<ProtocolDetailComponent['limitation']>[0];
  }

  /**
   * The header said "Readable in this explorer" from the release status
   * alone, and the limitation panel returned nothing for a live release
   * before looking at the authority, so a verified reader whose authority
   * was unreachable read as working.
   */
  it('reports a verified reader whose authority is unreachable as unavailable', () => {
    const vm = readyVm(definition(), [sourceEntry({ ready: false, status: 'unreachable', checkpoint: null })]);
    const component = routed({ registry: () => of(registryOf(definition())) }).component;
    expect(vm.availability).toBe('unreachable');
    expect(vm.live).toBe(false);
    expect(component.availabilityLabel(vm.availability)).toBe('Unavailable');
    expect(component.availabilityTone(vm.availability)).toBe('unavailable');
    expect(component.limitation(vm)).toContain('not answering');
    // The release status is still stated, as a qualifier.
    expect(component.statusLabel(vm.protocol)).toBe('Readable in this explorer');
  });

  it('calls a reader readable only when its authority is ready with a checkpoint', () => {
    const vm = readyVm(definition(), [sourceEntry()]);
    const component = routed({ registry: () => of(registryOf(definition())) }).component;
    expect(vm.availability).toBe('available');
    expect(vm.live).toBe(true);
    expect(component.limitation(vm)).toBeNull();
  });

  it.each([
    ['stale', sourceEntry({ status: 'stale', lagBlocks: '653560' }), 'catching-up', 'catching up'],
    ['no checkpoint', sourceEntry({ checkpoint: null }), 'degraded', 'without a checkpoint'],
  ] as const)('explains a %s authority instead of returning nothing', (_name, entry, availability, note) => {
    const vm = readyVm(definition(), [entry]);
    const component = routed({ registry: () => of(registryOf(definition())) }).component;
    expect(vm.availability).toBe(availability);
    expect(vm.live).toBe(false);
    expect(component.limitation(vm)).toContain(note);
  });

  it('explains a disabled and an unconfigured protocol from the same rule', () => {
    const component = routed({ registry: () => of(registryOf(definition())) }).component;
    const disabled = readyVm(definition({ releaseStatus: 'INTENTIONALLY DISABLED' }), [sourceEntry()]);
    expect(disabled.availability).toBe('disabled');
    expect(component.limitation(disabled)).toContain('turned off');
    const unconfigured = readyVm(definition(), []);
    expect(unconfigured.availability).toBe('unconfigured');
    expect(component.limitation(unconfigured)).toContain('No first-party authority');
  });
});
