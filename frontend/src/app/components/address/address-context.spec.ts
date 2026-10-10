// @vitest-environment jsdom
import 'zone.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, Subject, of, Subscription } from 'rxjs';
import { convertToParamMap, NavigationCancel, NavigationEnd, NavigationError, NavigationStart, ParamMap, Router } from '@angular/router';
import { UntypedFormBuilder } from '@angular/forms';
import { StateService, networkRouteUrls$ } from '@app/services/state.service';
import { AddressComponent } from './address.component';
import { Address, Transaction, Utxo } from '@interfaces/electrs.interface';
import { AddressInformation } from '@interfaces/node-api.interface';

const MAIN='1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3';
const OTHER_MAIN='1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const SIGNET='mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
function summary(reference:string):Address {return {address:reference,chain_stats:{funded_txo_count:1,funded_txo_sum:10,spent_txo_count:0,spent_txo_sum:0,tx_count:1},mempool_stats:{funded_txo_count:0,funded_txo_sum:0,spent_txo_count:0,spent_txo_sum:0,tx_count:0}} as Address;}
function transaction(reference:string,confirmed=true):Transaction {return {txid:'a'.repeat(64),version:2,locktime:0,size:100,weight:400,fee:1,vin:[],vout:[{value:10,scriptpubkey:'51',scriptpubkey_address:reference}],status:{confirmed,block_height:1,block_time:1700000000}} as Transaction;}
interface AddressFixture {
  component: AddressComponent;
  state: { network: string; networkChanged$: Subject<string>; mempoolTransactions$: Subject<Transaction> };
  params: BehaviorSubject<ParamMap>;
  reads: { network: string; reference: string; response: Subject<Address> }[];
  histories: Subject<Transaction[]>[]; utxos: Subject<Utxo[]>[]; times: Subject<number[]>[]; validations: Subject<AddressInformation>[];
  socket: { startTrackAddress: (address: string) => void };
  networkSubscription: Subscription;
  begin(id: number, target: string): void; earlyNetwork(id: number, next: string): void;
  end(id: number, target: string): void; cancel(id: number): void; fail(id: number): void;
}
function setup(network='',reference=MAIN): AddressFixture {
  const events=new Subject<unknown>();let active:{id:number}|null=null;let successful={id:1,finalUrl:{toString:(): string=>'/address/'+reference}};let url='/address/'+reference;
  const router={events,getCurrentNavigation:()=>active,get lastSuccessfulNavigation(){return successful;},get url(){return url;}} as Router;
  const params=new BehaviorSubject<ParamMap>(convertToParamMap({id:reference}));
  const state={network,env:{ROOT_NETWORK:'',BASE_MODULE:network.startsWith('liquid')?'liquid':'mempool',ACCELERATOR_BUTTON:false},networkChanged$:new Subject<string>(),connectionState$:new Subject<number>(),loadingIndicators$:new BehaviorSubject({}),mempoolTransactions$:new Subject<Transaction>(),mempoolRemovedTransactions$:new Subject<Transaction>(),blockTransactions$:new Subject<Transaction>()};
  const reads:{network:string;reference:string;response:Subject<Address>}[]=[];const histories:Subject<Transaction[]>[]=[];const utxos:Subject<Utxo[]>[]=[];const times:Subject<number[]>[]=[];const validations:Subject<AddressInformation>[]=[];
  const electrs={getAddress$:vi.fn((address:string)=>{const response=new Subject<Address>();reads.push({network:state.network,reference:address,response});return response;}),getAddressTransactions$:vi.fn(()=>{const response=new Subject<Transaction[]>();histories.push(response);return response;}),getAddressUtxos$:vi.fn(()=>{const response=new Subject<Utxo[]>();utxos.push(response);return response;})};
  const api={getTransactionTimes$:vi.fn(()=>{const response=new Subject<number[]>();times.push(response);return response;}),validateAddress$:vi.fn(()=>{const response=new Subject<AddressInformation>();validations.push(response);return response;})};
  const socket={want:vi.fn(),startTrackAddress:vi.fn(),stopTrackingAddress:vi.fn(),stopTrackAccelerations:vi.fn()};
  const route={paramMap:params,fragment:new BehaviorSubject<string|null>(null),get snapshot(): {paramMap: ParamMap} {return {paramMap:params.value};}};
  const component=new AddressComponent(route as never,electrs as never,socket as never,state as never,{playSound:vi.fn()} as never,api as never,{setTitle:vi.fn(),setDescription:vi.fn(),logSoft404:vi.fn()} as never,new UntypedFormBuilder(),{getAddressLookup$:vi.fn(()=>of({state:'unavailable'}))} as never,router);
  const networkSubscription=networkRouteUrls$(router).subscribe(target=>StateService.prototype.setNetworkBasedonUrl.call(state as never,target));
  Object.defineProperty(document.body,'scrollTo',{configurable:true,value:vi.fn()});component.ngOnInit();
  return {component,state,params,reads,histories,utxos,times,validations,socket,networkSubscription,
    begin(id:number,target:string): void {active={id};events.next(new NavigationStart(id,target));},
    earlyNetwork(id:number,next:string): void {active={id};state.network=next;state.networkChanged$.next(next);},
    end(id:number,target:string): void {url=target;successful={id,finalUrl:{toString:(): string=>target}};events.next(new NavigationEnd(id,target,target));active=null;},
    cancel(id:number): void {active=null;events.next(new NavigationCancel(id,url,'guard'));},
    fail(id:number): void {active=null;events.next(new NavigationError(id,url,new Error('guard failed')));},
  };
}
afterEach(()=>vi.restoreAllMocks());
describe('actual address controller read ownership',()=>{
  it('cancels old downstream history/UTXO and hides data before early network and delayed route values settle',()=>{
    const f=setup();f.reads[0].response.next(summary(MAIN));expect(f.component.address.address).toBe(MAIN);expect(f.histories[0].observed).toBe(true);expect(f.utxos[0].observed).toBe(true);
    f.earlyNetwork(2,'signet');expect(f.component.address).toBeNull();expect(f.component.addressString).toBe('');expect(f.histories[0].observed||f.utxos[0].observed).toBe(false);expect(f.reads).toHaveLength(1);
    f.state.mempoolTransactions$.next(transaction(MAIN));expect(f.component.transactions).toBeNull();
    f.begin(2,'/signet/address/'+SIGNET);f.params.next(convertToParamMap({id:SIGNET}));expect(f.reads).toHaveLength(1);
    f.histories[0].next([transaction(MAIN)]);f.histories[0].complete();f.utxos[0].next([]);f.utxos[0].complete();expect(f.component.address).toBeNull();
    f.end(2,'/signet/address/'+SIGNET);expect(f.reads.map(read=>[read.network,read.reference])).toEqual([['',MAIN],['signet',SIGNET]]);
    f.component.ngOnDestroy();f.networkSubscription.unsubscribe();expect(f.reads[1].response.observed).toBe(false);
  });
  it('cancels the late transaction-time stage and reads only for the latest matching navigation end',()=>{
    const f=setup();f.reads[0].response.next(summary(MAIN));f.histories[0].next([transaction(MAIN,false)]);f.histories[0].complete();f.utxos[0].next([]);f.utxos[0].complete();expect(f.times[0].observed).toBe(true);
    f.begin(2,'/address/older');f.begin(3,'/address/'+OTHER_MAIN);expect(f.times[0].observed).toBe(false);f.params.next(convertToParamMap({id:OTHER_MAIN}));f.end(2,'/address/older');expect(f.reads).toHaveLength(1);
    f.end(3,'/address/'+OTHER_MAIN);expect(f.reads).toHaveLength(2);f.times[0].next([1700000000]);expect(f.component.transactions).toBeNull();f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
  it('retries a canceled same-context navigation only when the saved successful route/scope still match',()=>{
    const f=setup();f.begin(2,'/address/'+MAIN+'?discarded=1');f.cancel(2);expect(f.component.contextUnavailable).toBe(true);expect(f.component.isLoadingAddress).toBe(false);
    f.component.retryAddress();expect(f.reads).toHaveLength(2);expect(f.reads[1].reference).toBe(MAIN);expect(f.component.contextUnavailable).toBe(false);f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
  it('restores the accepted network after cancellation, retries it, and refuses a manually mismatched scope',()=>{
    const f=setup();f.earlyNetwork(2,'signet');f.begin(2,'/signet/address/'+SIGNET);f.cancel(2);expect(f.state.network).toBe('');f.component.retryAddress();expect(f.reads).toHaveLength(2);expect(f.reads[1].network).toBe('');f.begin(4,'/signet/address/'+SIGNET);f.cancel(4);f.state.network='signet';f.component.retryAddress();expect(f.reads).toHaveLength(2);
    f.earlyNetwork(5,'signet');f.begin(5,'/signet/address/'+SIGNET);f.params.next(convertToParamMap({id:SIGNET}));f.end(5,'/signet/address/'+SIGNET);expect(f.reads).toHaveLength(3);expect(f.reads[2].network).toBe('signet');f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
  it('clears on NavigationError and permits explicit same-accepted-context retry without stale rows',()=>{
    const f=setup();f.begin(2,'/address/'+MAIN+'?failed=1');f.fail(2);expect(f.component.contextUnavailable).toBe(true);expect(f.component.address).toBeNull();f.component.retryAddress();expect(f.reads).toHaveLength(2);f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
  it('owns the formerly detached Liquid validation within the same cancellation chain',()=>{
    // Synthetic opaque reference exercises caller ownership, not native address validity.
    const reference='V'.repeat(80);const f=setup('liquid',reference);f.reads[0].response.next(summary(reference));expect(f.validations[0].observed).toBe(true);
    f.begin(2,'/liquid/address/next');expect(f.validations[0].observed).toBe(false);f.validations[0].next({unconfidential:'old'} as AddressInformation);expect(f.socket.startTrackAddress).not.toHaveBeenCalled();f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
  it('makes empty/malformed summary replies unavailable and preserves a usable fresh retry',()=>{
    const f=setup();f.reads[0].response.next(null);expect(f.component.isLoadingAddress).toBe(false);expect(f.component.error).toBeDefined();f.component.retryAddress();expect(f.reads).toHaveLength(2);f.component.ngOnDestroy();f.networkSubscription.unsubscribe();
  });
});
