// New WP01/WP07 consumer regressions. Fixture responses are not real authority acceptance.
import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
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
