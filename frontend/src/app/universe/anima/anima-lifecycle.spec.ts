import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { AnimaItemComponent } from './anima-item.component';
import { AnimaItemHistoryComponent } from './anima-item-history.component';
import { AnimaTransitionComponent } from './anima-transition.component';
import { AnimaItemsComponent } from './anima-items.component';
import { AnimaTransitionsComponent } from './anima-transitions.component';
const seo={setTitle:vi.fn()} as any;
const network=()=>({network:'signet',networkChanged$:new Subject<string>()});
for(const [Component,method,param,id] of [
 [AnimaItemComponent,'getAnimaOrganism$','itemId','o1'],
 [AnimaItemHistoryComponent,'getAnimaOrganismHistory$','itemId','o1'],
 [AnimaTransitionComponent,'getAnimaEvent$','eventId','a1:1'],
] as const){
 describe(Component.name,()=>{
  it('clears displayed authority immediately on route/network change and cancels the previous read',()=>{
   const params=new BehaviorSubject(convertToParamMap({[param]:id})),state=network(),reads:Subject<any>[]=[];
   const api:any={[method]:vi.fn(()=>{const read=new Subject();reads.push(read);return read;})};
   const page=new Component({paramMap:params} as any,api,seo,state as any);let latest:any;const sub=page.vm$.subscribe(value=>latest=value);
   expect(latest.kind).toBe('loading');reads[0].next({organism:{id},event:{eventId:id}});expect(latest.kind).toBe('ready');
   params.next(convertToParamMap({[param]:param==='eventId'?'a2:2':'o2'}));expect(latest.kind).toBe('loading');expect(reads[0].observed).toBe(false);
   reads[1].next({organism:{id:'o2'},event:{eventId:'a2:2'}});expect(latest.kind).toBe('ready');state.networkChanged$.next('regtest');expect(latest.kind).toBe('loading');expect(reads[1].observed).toBe(false);
   reads[2].error({status:503});expect(latest.kind).toBe('error');state.networkChanged$.next('testnet');expect(latest.kind).toBe('loading');
   sub.unsubscribe();expect(reads[3].observed).toBe(false);expect(state.networkChanged$.observed).toBe(false);
  });
 });
}
for(const [Component,method,key] of [[AnimaItemsComponent,'getAnimaOrganisms$','organisms'],[AnimaTransitionsComponent,'getAnimaEvents$','events']] as const){
 describe(Component.name+' network-owned pagination',()=>{
  function fixture(){
   const state=network(),statuses:Subject<any>[]=[],reads:Subject<any>[]=[];const callbacks=new Set<()=>void>();
   const destroy:any={onDestroy:(callback:()=>void)=>{callbacks.add(callback);return()=>callbacks.delete(callback);}};
   const api:any={getAnimaStatus$:vi.fn(()=>{const read=new Subject();statuses.push(read);return read;}),[method]:vi.fn(()=>{const read=new Subject();reads.push(read);return read;})};
   const page=new Component(api,seo,destroy,state as any);let latest:any;page.vm$.subscribe(value=>latest=value);page.ngOnInit();
   const answer=(ids:string[],total=3)=>({[key]:ids.map(id=>({id,eventId:id})),total,state:'served'});
   return{state,statuses,reads,page,answer,api,latest:()=>latest,destroy:()=>{for(const cb of [...callbacks])cb();}};
  }
  it('cancels an unfinished first page when status degrades and starts page zero on a new network',()=>{
   const f=fixture();f.statuses[0].next({state:'served'});f.statuses[0].next({state:'unavailable'});expect(f.reads[0].observed).toBe(false);f.reads[0].next(f.answer(['old']));expect(f.latest().kind).toBe('degraded');f.page.more();expect(f.reads.length).toBe(1);
   f.state.networkChanged$.next('regtest');expect(f.latest().kind).toBe('loading');expect(f.statuses[0].observed).toBe(false);f.statuses[1].next({state:'served'});expect(f.api[method].mock.calls.map((c:any)=>c[0])).toEqual([0,0]);f.destroy();expect(f.reads[1].observed).toBe(false);
  });
  it('completes each page after one response and cancels pending continuation on network change',()=>{
   const f=fixture();f.statuses[0].next({state:'served'});f.reads[0].next(f.answer(['one']));expect(f.reads[0].observed).toBe(false);f.page.more();expect(f.api[method].mock.calls.map((c:any)=>c[0])).toEqual([0,1]);
   f.state.networkChanged$.next('regtest');expect(f.latest().kind).toBe('loading');expect(f.reads[1].observed).toBe(false);f.reads[1].next(f.answer(['old']));expect(f.latest().kind).toBe('loading');f.statuses[1].next({state:'served'});expect(f.api[method].mock.calls.map((c:any)=>c[0])).toEqual([0,1,0]);f.destroy();expect(f.state.networkChanged$.observed).toBe(false);
  });
  it('recovers on a new network after a failed status request',()=>{
   const f=fixture();f.statuses[0].error({status:0});expect(f.latest().kind).toBe('error');f.state.networkChanged$.next('regtest');expect(f.latest().kind).toBe('loading');f.statuses[1].next({state:'served'});f.reads[0].next(f.answer([],0));expect(f.latest().kind).toBe('ready');f.destroy();
  });
 });
}
