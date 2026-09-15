// @vitest-environment jsdom
import '@angular/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { RgbValidationService } from './rgb-validation.service';
import { RgbStudioComponent } from './rgb-studio.component';
const id='11'.repeat(32),hash='22'.repeat(32);
class TestWorker { static last:TestWorker; onmessage:any;onerror:any;postMessage=vi.fn();terminate=vi.fn();constructor(){TestWorker.last=this;}reply(data:any){this.onmessage({data});} }
afterEach(()=>vi.unstubAllGlobals());
describe('RGB private worker and public anchor transport',()=>{
 it('sends only IDs to the API and revalidates privately with returned witnesses',()=>{
  vi.stubGlobal('Worker',TestWorker);const post=vi.fn(()=>of({witnesses:{[id]:{raw_tx:'00',height:null,timestamp:null}},unresolved:[],source:{network:'signet',block_hash:hash}}));
  const service=new RgbValidationService({post} as any,{network:'signet',env:{ROOT_NETWORK:'mainnet'}} as any);const seen:any[]=[];service.validate('private-consignment').subscribe(v=>seen.push(v));const w=TestWorker.last;
  w.reply({status:'unresolved',anchor_txids:[id]});expect(post).toHaveBeenCalledWith('/signet/api/v1/intelligence/rgb/anchors',{txids:[id]});expect(JSON.stringify(post.mock.calls)).not.toContain('private-consignment');
  expect(w.postMessage.mock.calls[1][0]).toMatchObject({consignment:'private-consignment',witnesses:{[id]:{raw_tx:'00'}}});w.reply({status:'invalid',reason:'seal mismatch'});expect(seen[0]).toMatchObject({status:'invalid'});expect(w.terminate).toHaveBeenCalled();
 });
 it('rejects foreign network evidence',()=>{vi.stubGlobal('Worker',TestWorker);const service=new RgbValidationService({post:()=>of({witnesses:{},unresolved:[],source:{network:'mainnet',block_hash:hash}})} as any,{network:'signet',env:{ROOT_NETWORK:'mainnet'}} as any);let result:any;service.validate('aabb').subscribe(v=>result=v);TestWorker.last.reply({status:'unresolved',anchor_txids:[id]});expect(result.status).toBe('unresolved');expect(result.reason).toContain('inconsistent network');});
 it('terminates local work and cancels public reads when unsubscribed',()=>{vi.stubGlobal('Worker',TestWorker);const pending=new Subject<any>();const service=new RgbValidationService({post:()=>pending} as any,{network:'signet',env:{ROOT_NETWORK:'mainnet'}} as any);const sub=service.validate('aabb').subscribe();TestWorker.last.reply({status:'unresolved',anchor_txids:[id]});expect(pending.observed).toBe(true);sub.unsubscribe();expect(pending.observed).toBe(false);expect(TestWorker.last.terminate).toHaveBeenCalled();});
 it('clears input-dependent results on edits/network changes and destroy',()=>{const changes=new Subject<string>(),pending=new Subject<any>();const state={network:'signet',networkChanged$:changes};const view=new RgbStudioComponent({setTitle:()=>{}} as any,{validate:()=>pending} as any,state as any,{markForCheck:()=>{}} as any);view.consignmentHex='aabb';view.validate();pending.next({status:'valid'});expect(view.result?.status).toBe('valid');view.consignmentHex='ccdd';view.invalidate();expect(view.result).toBeNull();expect(pending.observed).toBe(false);view.validate();changes.next('testnet');expect(view.loading).toBe(false);expect(pending.observed).toBe(false);view.ngOnDestroy();expect(changes.observed).toBe(false);});
});
