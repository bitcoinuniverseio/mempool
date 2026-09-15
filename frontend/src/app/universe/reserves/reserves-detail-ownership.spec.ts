import { expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { ReservesProviderDetailComponent } from './reserves-provider-detail.component';
import { ReservesSnapshotDetailComponent } from './reserves-snapshot-detail.component';
const params = (id: string | null) => ({ get: () => id });
const cdr = { markForCheck: vi.fn() } as any;
it('provider reads cancel together, clear route changes and reject snapshots belonging to another provider', () => {
  const route = new BehaviorSubject(params('a')); const network = new Subject<string>(); const requests: any[] = [];
  const get = (kind: string) => (id: string) => { const subject = new Subject<any>(); requests.push({ kind, id, subject }); return subject; };
  const api = { getProviderById: get('provider'), getSnapshots: get('snapshots') };
  const component = new ReservesProviderDetailComponent({paramMap:route} as any,api as any,cdr,{network:'signet',networkChanged$:network} as any);
  component.ngOnInit();
  requests[0].subject.next({provider_id:'a'}); requests[0].subject.complete(); requests[1].subject.next([]); requests[1].subject.complete();
  expect(component.provider?.provider_id).toBe('a');
  route.next(params('b')); expect(component.provider).toBeNull(); expect(component.snapshots).toEqual([]);
  requests[2].subject.next({provider_id:'b'}); requests[2].subject.complete(); requests[3].subject.next([{provider_id:'a'}]); requests[3].subject.complete();
  expect(component.provider).toBeNull(); expect(component.error).toContain('identity');
  network.next('mainnet'); expect(component.error).toBe(''); component.ngOnDestroy(); expect(requests[4].subject.observed).toBe(false); expect(requests[5].subject.observed).toBe(false);
});
it('snapshot route replacement cancels pending HTTP and refuses missing or wrong IDs', () => {
  const route = new BehaviorSubject(params('a')); const requests: Subject<any>[] = [];
  const api = {getSnapshotById: vi.fn(() => {const request=new Subject<any>();requests.push(request);return request;})};
  const component = new ReservesSnapshotDetailComponent({paramMap:route} as any,api as any,cdr,{network:'signet',networkChanged$:new Subject()} as any);
  component.ngOnInit(); route.next(params('b')); expect(requests[0].observed).toBe(false);
  requests[1].next({snapshot_id:'a'}); requests[1].complete(); expect(component.snapshot).toBeNull();
  route.next(params(null)); expect(api.getSnapshotById).toHaveBeenCalledTimes(2); expect(component.error).toContain('required');
  component.ngOnDestroy();
});
