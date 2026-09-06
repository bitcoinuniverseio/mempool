// New WP01/WP07 consumer regressions. Fixture responses are not real authority acceptance.
import { describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { ProtocolDetailComponent } from './protocol-detail.component';
import { ExplorerProtocolActivityPage, ExplorerProtocolObjectsPage } from '../universe.types';

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
