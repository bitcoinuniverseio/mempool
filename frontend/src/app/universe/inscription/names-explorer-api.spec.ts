import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { UniverseApiService } from '../universe-api.service';
const id='d'.repeat(64)+'i0';
describe('Names pure detail API context',()=>{
 it('uses existing same-origin overlay with exact explicit selected scope and cancels replacement',()=>{
 const networks=new BehaviorSubject('signet'),state={isBrowser:true,network:'signet',networkChanged$:networks,env:{ROOT_NETWORK:'mainnet'}},calls:Array<{url:string,closed:boolean,emit:(v:unknown)=>void}>=[];
 const get=vi.fn((url:string):Observable<unknown>=>new Observable(observer=>{const row={url,closed:false,emit:(v:unknown):void=>observer.next(v)};calls.push(row);return()=>{row.closed=true;};}));
 const api=new UniverseApiService({get} as never,state as never,{headers:()=>({}),key:null} as never),values:Array<{kind:string}>=[];const sub=api.getNamesObject$(id).subscribe(v=>values.push({kind:v.status}));
 expect(calls[0].url).toBe('/api/v1/universe/protocols/names/objects/'+id+'?chain=bitcoin&network=signet');
 state.network='mainnet';networks.next('mainnet');expect(calls[0].closed).toBe(true);calls[0].emit({chain:'bitcoin',network:'signet'});expect(values).toHaveLength(0);
 expect(calls[1].url).toContain('network=mainnet');sub.unsubscribe();expect(calls[1].closed).toBe(true);
 });
 it('rejects non-id references before requesting any source and ordinary reads remain independent',()=>{const get=vi.fn(()=>of({}));const api=new UniverseApiService({get} as never,{isBrowser:true,network:'signet',env:{}} as never,{headers:()=>({}),key:null} as never);api.getNamesObject$('sats').subscribe({error:()=>undefined});expect(get).not.toHaveBeenCalled();api.getInscription$(id).subscribe();expect(get).toHaveBeenCalledTimes(1);expect(get.mock.calls[0][0]).toContain('/universe/inscriptions/');});
});
import { afterEach } from 'vitest';
import { convertToParamMap } from '@angular/router';
import { InscriptionComponent } from './inscription.component';
afterEach(()=>vi.useRealTimers());
function integration(protocol?:string):{component:InscriptionComponent;api:UniverseApiService;state:{isBrowser:boolean;network:string;networkChanged$:BehaviorSubject<string>;env:object};networks:BehaviorSubject<string>;calls:Array<{url:string;closed:boolean;emit:(v:unknown)=>void}>} {
 const networks=new BehaviorSubject('mainnet'),state={isBrowser:true,network:'mainnet',networkChanged$:networks,env:{}},calls:Array<{url:string,closed:boolean,emit:(v:unknown)=>void}>=[];
 const get=vi.fn((url:string):Observable<unknown>=>new Observable(observer=>{const row={url,closed:false,emit:(v:unknown):void=>observer.next(v)};calls.push(row);return()=>{row.closed=true;};}));
 const api=new UniverseApiService({get} as never,state as never,{headers:()=>({}),key:null} as never);
 const component=new InscriptionComponent({paramMap:new BehaviorSubject(convertToParamMap({reference:id})),queryParamMap:new BehaviorSubject(convertToParamMap(protocol?{protocol}:{}))} as never,api,{recordVisit:vi.fn()} as never,{setTitle:vi.fn()} as never);component.ngOnInit();return{component,api,state,networks,calls};
}
describe('real API inscription one-attempt lifecycle',()=>{
 it('one read per selection, coalesced subscribers, pending reset and late-old rejection',()=>{const h=integration(),values:Array<{kind:string}>=[];const sub=h.component.state$.subscribe(v=>values.push(v));expect(h.calls).toHaveLength(1);h.calls[0].emit({status:'ok',chain:'bitcoin',network:'mainnet',value:{id,numberAtomic:'1'}});expect(values.at(-1).kind).toBe('ready');h.state.network='signet';h.networks.next('signet');expect(h.calls).toHaveLength(2);expect(h.calls[0].closed).toBe(true);expect(values.at(-1).kind).toBe('loading');h.calls[0].emit({status:'ok',value:{id}});expect(values.at(-1).kind).toBe('loading');h.state.network='mainnet';h.networks.next('mainnet');expect(h.calls).toHaveLength(3);expect(h.calls[1].closed).toBe(true);sub.unsubscribe();h.component.ngOnDestroy();expect(h.calls[2].closed).toBe(true);});
 it('silent first response times out once then explicit retry makes one replacement read',()=>{vi.useFakeTimers();const h=integration(),values:Array<{kind:string}>=[];const sub=h.component.state$.subscribe(v=>values.push(v));vi.advanceTimersByTime(35001);expect(values.at(-1).kind).toBe('unavailable');expect(h.calls[0].closed).toBe(true);expect(h.calls).toHaveLength(1);h.component.retry();expect(h.calls).toHaveLength(2);expect(values.at(-1).kind).toBe('loading');sub.unsubscribe();h.component.ngOnDestroy();});
 it('explicit Names makes exactly one cancelled read per scope transition',()=>{const h=integration('names');const sub=h.component.namesState$.subscribe();expect(h.calls.filter(c=>c.url.includes('/protocols/names/'))).toHaveLength(1);h.state.network='signet';h.networks.next('signet');const reads=h.calls.filter(c=>c.url.includes('/protocols/names/'));expect(reads).toHaveLength(2);expect(reads[0].closed).toBe(true);sub.unsubscribe();h.component.ngOnDestroy();});
 it('captured mismatch sends zero HTTP and budget policy is exact',()=>{const h=integration(),before=h.calls.length;h.api.getInscription$(id,'signet').subscribe({error:()=>undefined});h.api.getNamesObject$(id,'signet').subscribe({error:()=>undefined});expect(h.calls).toHaveLength(before);expect(h.api.assetLookupDeadlineMs).toBe(35000);h.state.isBrowser=false;expect(h.api.assetLookupDeadlineMs).toBe(365000);h.component.ngOnDestroy();});
 it('invalid scope is unavailable and explicit retry resubscribes after correction',()=>{const h=integration(),values:Array<{kind:string}>=[];const sub=h.component.state$.subscribe(v=>values.push(v));h.state.network='bad';h.networks.next('bad');expect(values.at(-1).kind).toBe('unavailable');const before=h.calls.length;h.state.network='signet';h.component.retry();expect(h.calls).toHaveLength(before+1);expect(values.at(-1).kind).toBe('loading');sub.unsubscribe();h.component.ngOnDestroy();});
});
