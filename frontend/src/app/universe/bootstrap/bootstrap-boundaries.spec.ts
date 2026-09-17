import { describe,it,expect,vi } from 'vitest';
import { BehaviorSubject,Subject } from 'rxjs';
import { BootstrapVerifyComponent } from './bootstrap-verify.component';
import { BootstrapPlannerComponent } from './bootstrap-planner.component';
import { BootstrapSnapshotDetailComponent } from './bootstrap-snapshot-detail.component';
import { convertToParamMap } from '@angular/router';
describe('bootstrap source and request boundaries',()=>{
 it.each(['verify','plan'])('clears pending %s on edit, network and destroy',kind=>{
   const networks=new BehaviorSubject('signet');const pending=new Subject<any>();
   const api={network:'signet',networkChanged$:networks,verifySnapshotChecksum$:()=>pending,generateBootstrapPlan$:()=>pending};
   const c:any=kind==='verify'?new BootstrapVerifyComponent(api as any,{markForCheck:vi.fn()} as any):new BootstrapPlannerComponent(api as any,{markForCheck:vi.fn()} as any);
   if(kind==='verify')c.snapshotHeight=10;
   c.ngOnInit();const run=()=>kind==='verify'?c.verifyChecksum():c.calculatePlan();run();c.clear();expect(pending.observed).toBe(false);
   run();networks.next('regtest');expect(pending.observed).toBe(false);run();c.ngOnDestroy();expect(pending.observed).toBe(false);
 });
 it('does not promote truthy validity to safe-to-load or convert503 into mismatch',()=>{
   const pending=new Subject<any>();const c=new BootstrapVerifyComponent({network:'signet',verifySnapshotChecksum$:()=>pending} as any,{markForCheck:vi.fn()} as any);
   c.snapshotHeight=10;c.verifyChecksum();pending.next({valid:'true',status:'pinned_core_verified'});expect(c.report).toBeNull();expect(c.failure?.message).toContain('Supplied hashes');
   pending.error({status:503,error:{error:'Trusted snapshot source unavailable'}});expect(c.report).toBeNull();expect(c.failure?.message).toContain('unavailable');expect(c.failure?.kind).toBe('unavailable');
 });
 it('clears detail on route/network and rejects wrong reference or absent network',()=>{
   const networks=new BehaviorSubject('signet');const params=new BehaviorSubject(convertToParamMap({heightOrHash:'10'}));const route={paramMap:params,snapshot:{paramMap:params.value}};
   const requests:Subject<any>[]=[];const api={network:'signet',networkChanged$:networks,getSnapshotByHeightOrHash$:()=>{const s=new Subject();requests.push(s);return s;}};
   const c=new BootstrapSnapshotDetailComponent(route as any,api as any,{markForCheck:vi.fn()} as any);c.ngOnInit();requests[0].next({height:10});expect(c.snapshot).toBeNull();expect(c.error).toContain('bound');
   route.snapshot.paramMap=convertToParamMap({heightOrHash:'11'});params.next(route.snapshot.paramMap);expect(requests[0].observed).toBe(false);expect(c.error).toBeNull();
   requests[1].next({height:12,network:'signet'});expect(c.snapshot).toBeNull();networks.next('regtest');expect(c.loading).toBe(true);c.ngOnDestroy();expect(requests[2].observed).toBe(false);
 });
});
