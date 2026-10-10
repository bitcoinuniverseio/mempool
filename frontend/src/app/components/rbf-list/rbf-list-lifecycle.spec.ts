import { describe, expect, it, vi } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, BehaviorSubject, of, throwError } from 'rxjs';
import { RbfTree } from '@interfaces/node-api.interface';
import { RbfHistoryState } from '@app/services/rbf-history-state';
import { ApiService } from '@app/services/api.service';
import { StateService } from '@app/services/state.service';
import { WebsocketService } from '@app/services/websocket.service';
import { SeoService } from '@app/services/seo.service';
import { OpenGraphService } from '@app/services/opengraph.service';
import { RbfList } from './rbf-list.component';
interface Fixture {
  c: RbfList;
  api: { getRbfList$: ReturnType<typeof vi.fn<(fullRbf: boolean) => Observable<RbfTree[]>>> };
  ws: { startTrackRbf: ReturnType<typeof vi.fn>; stopTrackRbf: ReturnType<typeof vi.fn> };
  fragment: BehaviorSubject<string>;
  live: Subject<RbfTree[]>;
}
function setup(): Fixture {
  const fragment = new BehaviorSubject(''), live = new Subject<RbfTree[]>();
  const api = { getRbfList$: vi.fn<(fullRbf: boolean) => Observable<RbfTree[]>>() };
  const ws = { startTrackRbf: vi.fn(), stopTrackRbf: vi.fn() }, history = new RbfHistoryState();
  const c = new RbfList({ fragment } as ActivatedRoute, {} as Router, api as unknown as ApiService,
    { network: 'signet', rbfLatest$: live, networkChanged$: new Subject<string>(), rbfHistoryState: history, rbfHistoryAvailability$: history.availability$ } as unknown as StateService,
    ws as unknown as WebsocketService, { setTitle: vi.fn(), setDescription: vi.fn() } as unknown as SeoService, {} as OpenGraphService);
  return { c, api, ws, fragment, live };
}
describe('replacement list honest failure and recovery', () => {
  it('keeps unavailable distinct from successful empty and retries after error', () => {
    const { c, api } = setup(); api.getRbfList$.mockReturnValueOnce(throwError(() => ({ status: 503 }))).mockReturnValueOnce(of([]));
    c.ngOnInit(); const rows: RbfTree[][] = []; const sub = c.rbfTrees$.subscribe(r => rows.push(r)); expect(c.loadError).toContain('unavailable'); expect(c.isLoading).toBe(false);
    c.retryLoad(); expect(c.loadError).toBeNull(); expect(rows).toEqual([[], [], [], []]); expect(api.getRbfList$).toHaveBeenCalledTimes(2); c.ngOnDestroy(); sub.unsubscribe();
  });
  it('cancels old HTTP on mode change and stops fragment/socket after destroy', () => {
    const { c, api, fragment, ws } = setup(); const old = new Subject<RbfTree[]>(), next = new Subject<RbfTree[]>(); api.getRbfList$.mockReturnValueOnce(old).mockReturnValueOnce(next); c.ngOnInit(); const sub = c.rbfTrees$.subscribe();
    fragment.next('fullrbf'); expect(old.observed).toBe(false); expect(api.getRbfList$).toHaveBeenLastCalledWith(true); c.ngOnDestroy(); fragment.next(''); expect(ws.startTrackRbf).toHaveBeenCalledTimes(2); expect(ws.stopTrackRbf).toHaveBeenCalledOnce(); sub.unsubscribe(); expect(next.observed).toBe(false); c.retryLoad(); expect(api.getRbfList$).toHaveBeenCalledTimes(2);
  });
  it('coalesces visit/template subscribers and duplicate mode emissions while manual retry remains one new attempt', () => {
    const { c, api, fragment } = setup(); api.getRbfList$.mockReturnValue(of([])); c.ngOnInit(); const visit = c.rbfTrees$.subscribe(), view = c.rbfTrees$.subscribe(); fragment.next(''); expect(api.getRbfList$).toHaveBeenCalledTimes(1); c.retryLoad(); expect(api.getRbfList$).toHaveBeenCalledTimes(2); c.ngOnDestroy(); visit.unsubscribe(); view.unsubscribe();
  });
});
