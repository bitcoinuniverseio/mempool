import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { convertToParamMap } from '@angular/router';
import { Transaction } from 'bitcoinjs-lib';
import { PackageSimulatorComponent } from './package-simulator.component';
import { BumpComponent } from './bump.component';
const tx=new Transaction();tx.addInput(Buffer.alloc(32,1),0);tx.addOutput(Buffer.from('51','hex'),1000);
const raw=tx.toHex(),id=tx.getId();
const response:any={accepted:true,cyclic:false,replacement:null,transactions:[{txid:id,allowed:true}]};
const cdr=()=>({markForCheck:vi.fn()} as any),seo=()=>({setTitle:vi.fn()} as any);
function simulator(){
 const network={network:'signet',networkChanged$:new Subject<string>()},reads:Subject<any>[]=[];
 const api:any={simulatePackage$:vi.fn(()=>{const read=new Subject();reads.push(read);return read;})};
 const page=new PackageSimulatorComponent(api,seo(),cdr(),network as any);page.ngOnInit();page.input=raw;return{page,network,reads,api};
}
describe('Package simulator input and request lifecycle',()=>{
 it('clear and invalid next input cancel the old request before validation',()=>{
  const {page,reads}=simulator();page.run();page.clear();expect(reads[0].observed).toBe(false);reads[0].next(response);expect(page.simulation).toBeNull();expect(page.running).toBe(false);
  page.input=raw;page.run();page.input='not hex';page.run();reads[1].next(response);expect(page.simulation).toBeNull();expect(page.inputError).toBeTruthy();page.ngOnDestroy();
 });
 it('network changes clear input and result, and destroy cancels all subscriptions',()=>{
  const {page,reads,network}=simulator();page.run();reads[0].next(response);expect(page.headline?.positive).toBe(true);
  network.networkChanged$.next('regtest');expect(page.input).toBe('');expect(page.headline).toBeNull();page.input=raw;page.run();page.ngOnDestroy();expect(reads[1].observed).toBe(false);expect(network.networkChanged$.observed).toBe(false);
 });
 it('rejects mismatched transaction identity and nonboolean acceptance',()=>{
  const {page,reads}=simulator();page.run();reads[0].next({...response,transactions:[{txid:'f'.repeat(64),allowed:true}]});expect(page.headline).toBeNull();expect(page.requestError).toContain('mismatched');
  page.run();reads[1].next({...response,accepted:'true'});expect(page.simulation).toBeNull();page.ngOnDestroy();
 });
 it('rejects truncated serialization before sending it and distinguishes source failure from rejection',()=>{
  const {page,api,reads}=simulator();page.input='01'.repeat(61);page.run();expect(api.simulatePackage$).not.toHaveBeenCalled();expect(page.inputError).toContain('serialized');
  page.input=raw;page.run();reads[0].error({status:503,error:'Policy source unavailable'});expect(page.requestError).toBe('Policy source unavailable');expect(page.headline).toBeNull();page.ngOnDestroy();
 });
});
function bump(){
 const params=new BehaviorSubject(convertToParamMap({txid:id})),query=new BehaviorSubject(convertToParamMap({targetFeerate:'20'}));
 const network={network:'signet',networkChanged$:new Subject<string>()},reads:Subject<any>[]=[];
 const api:any={getBumpPlan$:vi.fn(()=>{const read=new Subject();reads.push(read);return read;})};
 const page=new BumpComponent(api,seo(),{paramMap:params,queryParamMap:query} as any,{navigate:vi.fn()} as any,cdr(),network as any);page.ngOnInit();return{page,params,query,network,reads};
}
const plan:any={txid:id,targetFeerate:20,alreadyAtTarget:false,rbf:{available:false,evictedTxids:[]},cpfp:{available:false}};
describe('Fee bump planner route, input and network lifecycle',()=>{
 it('clears the old plan immediately on route and network changes',()=>{
  const {page,params,network,reads}=bump();reads[0].next(plan);expect(page.plan).toBeTruthy();params.next(convertToParamMap({txid:'b'.repeat(64)}));expect(page.plan).toBeNull();expect(reads[0].observed).toBe(false);
  reads[1].next(plan);expect(page.plan).toBeNull();expect(page.error).toContain('mismatched');network.networkChanged$.next('regtest');expect(page.error).toBeNull();page.ngOnDestroy();expect(reads[2].observed).toBe(false);
 });
 it('invalid query or edited target cannot be overwritten by an old plan',()=>{
  const {page,query,reads}=bump();query.next(convertToParamMap({targetFeerate:'invalid'}));reads[0].next(plan);expect(page.plan).toBeNull();expect(page.loading).toBe(false);
  query.next(convertToParamMap({targetFeerate:'20'}));page.targetInput='invalid';page.submitTyped();reads[1].next(plan);expect(page.plan).toBeNull();expect(page.error).toContain('Enter a fee rate');page.ngOnDestroy();
 });
 it('unsubscribes query and network listeners at destroy',()=>{
  const {page,params,query,network}=bump();page.ngOnDestroy();expect(params.observed).toBe(false);expect(query.observed).toBe(false);expect(network.networkChanged$.observed).toBe(false);
 });
});
