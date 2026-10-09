import { readObjectRows } from '../protocol-activity-view';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { BehaviorSubject, Observable, Subject, of, NEVER, EMPTY, throwError } from 'rxjs';
import { convertToParamMap, ParamMap } from '@angular/router';
import { readFileSync } from 'node:fs';
import { InscriptionComponent } from './inscription.component';
import { decodeNamesAsset, namesAssetState$, NamesExplorerAssetView } from '../names-explorer-asset';
import { ProtocolDetailComponent } from '../protocol-detail/protocol-detail.component';
type Fixture=Omit<NamesExplorerAssetView,'inscriptionViews'> & {inscriptionViews:Array<{protocolId:string;assetId:string;quantityAtomic:string}>};
const native:Fixture=JSON.parse(readFileSync(new URL('./names-explorer-asset.paired-fixture.json',import.meta.url),'utf8'));
const id=native.assetId;
const envelope=(network='mainnet'): {schemaVersion:string;chain:string;network:string;authorityId:string;status:string;value:Fixture}=>({schemaVersion:'universe-names-explorer-asset-v1',chain:'bitcoin',network,authorityId:'index-names',status:'served',value:structuredClone(native)});
function setup(protocol?:string): {component:InscriptionComponent;api:{network:string;selectedNetwork$:()=>Observable<string>;getInscription$:ReturnType<typeof vi.fn>;getNamesObject$:ReturnType<typeof vi.fn>};params:BehaviorSubject<ParamMap>;query:BehaviorSubject<ParamMap>;network:BehaviorSubject<string>;requests:Array<{network:string;stream:Subject<unknown>;closed:boolean}>} {
 const params=new BehaviorSubject(convertToParamMap({reference:id})),query=new BehaviorSubject(convertToParamMap(protocol?{protocol}:{})),network=new BehaviorSubject('mainnet');
 const requests:Array<{network:string,stream:Subject<unknown>,closed:boolean}>=[];
 const api={network:'mainnet',selectedNetwork$:():Observable<string>=>network,getInscription$:vi.fn(()=>of({status:'unconfigured',value:null})),getNamesObject$:vi.fn(():Observable<unknown>=>new Observable(observer=>{const stream=new Subject<unknown>();const row={network:api.network,stream,closed:false};requests.push(row);const sub=stream.subscribe(observer);return()=>{row.closed=true;sub.unsubscribe();};}))};
 const component=new InscriptionComponent({paramMap:params,queryParamMap:query} as never,api as never,{recordVisit:vi.fn()} as never,{setTitle:vi.fn()} as never);component.ngOnInit();return {component,api,params,query,network,requests};
}
afterEach(()=>vi.useRealTimers());
describe('explicit Names details in existing inscription experience',()=>{
 it('ordinary inscriptions and numeric references never add a Names request',()=>{const h=setup();const states:Array<{kind:string}>=[];const sub=h.component.namesState$.subscribe(s=>states.push(s));expect(h.api.getNamesObject$).not.toHaveBeenCalled();expect(states.at(-1).kind).toBe('absent');h.params.next(convertToParamMap({reference:'-1'}));h.query.next(convertToParamMap({protocol:'names'}));expect(h.api.getNamesObject$).not.toHaveBeenCalled();expect(states.at(-1).kind).toBe('unavailable');sub.unsubscribe();h.component.ngOnDestroy();});
 it('query and rapid A-B-A scope switches cancel old requests and ignore late responses',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(native.observedAt));const h=setup('names'),states:Array<{kind:string}>=[];const sub=h.component.namesState$.subscribe(s=>states.push(s));
 h.requests[0].stream.next(envelope());expect(states.at(-1).kind).toBe('ready');
 h.api.network='signet';h.network.next('signet');expect(h.requests[0].closed).toBe(true);expect(states.at(-1).kind).toBe('loading');
 h.api.network='mainnet';h.network.next('mainnet');expect(h.requests[1].closed).toBe(true);h.requests[0].stream.next(envelope());expect(states.at(-1).kind).toBe('loading');
 h.requests[2].stream.next(envelope());expect(states.at(-1).kind).toBe('ready');h.query.next(convertToParamMap({}));expect(h.requests[2].closed).toBe(true);expect(states.at(-1).kind).toBe('absent');h.requests[2].stream.next(envelope());expect(states.at(-1).kind).toBe('absent');
 sub.unsubscribe();h.component.ngOnDestroy();
 });
 it('namespace proof is independent of generic Ord state and expires without polling',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(native.observedAt));const h=setup('names'),states:Array<{kind:string}>=[];const sub=h.component.namesState$.subscribe(s=>states.push(s));h.requests[0].stream.next(envelope());expect(states.at(-1).kind).toBe('ready');expect(h.api.getInscription$).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(30001);expect(states.at(-1).kind).toBe('unavailable');expect(h.api.getNamesObject$).toHaveBeenCalledTimes(1);sub.unsubscribe();h.component.ngOnDestroy();
 });
 it('foreign scope, stale, unconfigured and invented namespace privilege never borrow generic ownership',()=>{
 const now=Date.parse(native.observedAt);for(const response of [{...envelope(),network:'signet'},{...envelope(),status:'unconfigured',value:null},{...envelope(),value:{...native,namespaceRegistrationPrivileges:true}},{...envelope(),value:{...native,ownership:{...native.ownership,confirmationsAtomic:'2'}}}]){expect(decodeNamesAsset(response,id,'mainnet',now).kind).toBe('unavailable');}expect(decodeNamesAsset(envelope(),id,'mainnet',now+30001).kind).toBe('unavailable');
 });
 it('only known Names claim kinds and exact inscription IDs receive explicit-context links',()=>{
 const helper=ProtocolDetailComponent.prototype.namesObjectReference;const row=readObjectRows([{assetId:id,kind:'namespace',name:null,namespace:'sats'}])[0];expect(row.kind).toBeNull();expect(helper.call({} as never,row,'names')).toBe(id);expect(helper.call({} as never,row,'bitmap')).toBeNull();expect(helper.call({} as never,readObjectRows([{assetId:'sats',kind:'namespace'}])[0],'names')).toBeNull();expect(helper.call({} as never,readObjectRows([{assetId:id,status:'namespace'}])[0],'names')).toBeNull();
 });
});

describe('bounded Names-only context lifecycle and paired view shape',()=>{
 it('a silent Names first response becomes unavailable after20s with no polling',()=>{vi.useFakeTimers();const values:Array<{kind:string}>=[];const sub=namesAssetState$(NEVER,id,'mainnet').subscribe(v=>values.push(v));expect(values.at(-1).kind).toBe('loading');vi.advanceTimersByTime(20001);expect(values.at(-1).kind).toBe('unavailable');sub.unsubscribe();});
 it('duplicate/conflicting explicit Names queries make zero authority requests',()=>{for(const protocol of [['names','names'],['names','ordinals'],['ordinals','names']]){const h=setup();h.query.next(convertToParamMap({protocol}));const states:Array<{kind:string}>=[];const sub=h.component.namesState$.subscribe(v=>states.push(v));expect(states.at(-1).kind).toBe('unavailable');expect(h.api.getNamesObject$).not.toHaveBeenCalled();sub.unsubscribe();h.component.ngOnDestroy();}});
 it('an outer network/config failure is an unavailable state rather than AsyncPipe error',()=>{const h=setup('names');h.component.ngOnDestroy();h.api.selectedNetwork$=():Observable<string>=>throwError(()=>new Error('context invalid'));h.component.ngOnInit();const values:Array<{kind:string}>=[];const sub=h.component.namesState$.subscribe(v=>values.push(v));expect(values.at(-1).kind).toBe('unavailable');expect(h.api.getNamesObject$).not.toHaveBeenCalled();sub.unsubscribe();h.component.ngOnDestroy();});
 it('accepts exact known other-protocol/Ordex views and rejects unknown/wrong/zero evidence',()=>{const now=Date.parse(native.observedAt),good=envelope();good.value.inscriptionViews.push({protocolId:'brc20',assetId:id,quantityAtomic:'123'},{protocolId:'ordex',assetId:`ordex:${id}@${native.ownership.outpoint}`,quantityAtomic:'1'});expect(decodeNamesAsset(good,id,'mainnet',now).kind).toBe('ready');for(const extra of [{protocolId:'invented',assetId:id,quantityAtomic:'1'},{protocolId:'brc20',assetId:'e'.repeat(64)+'i0',quantityAtomic:'2'},{protocolId:'ordex',assetId:`ordex:${id}@${'e'.repeat(64)}:0`,quantityAtomic:'1'},{protocolId:'brc20',assetId:id,quantityAtomic:'0'}]){const bad=envelope();bad.value.inscriptionViews.push(extra);expect(decodeNamesAsset(bad,id,'mainnet',now).kind).toBe('unavailable');}});
});

it('empty Names completion and indexed miss remain explicit without full SNS absence',()=>{const values:Array<{kind:string}>=[];namesAssetState$(EMPTY,id,'mainnet').subscribe(v=>values.push(v));expect(values.at(-1)?.kind).toBe('unavailable');const miss=decodeNamesAsset({...envelope(),status:'not-found',value:null},id,'mainnet');expect(miss).toEqual({kind:'unavailable',reason:'No indexed first Names claim matches this inscription. Complete SNS membership is not established.'});});
