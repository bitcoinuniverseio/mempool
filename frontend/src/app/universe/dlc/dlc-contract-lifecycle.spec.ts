// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { sha256 } from '@scure/btc-signer/utils.js';
import { StateService } from '@app/services/state.service';
import { DlcApiService } from './dlc.service';
import { DlcInspectComponent } from './dlc-inspect.component';
import { DlcSimulateComponent } from './dlc-simulate.component';
const network=()=>({network:'signet',networkChanged$:new Subject<string>()});
const digest=(value:unknown)=>Array.from(sha256(new TextEncoder().encode(JSON.stringify(value))), b=>b.toString(16).padStart(2,'0')).join('');
function inspector(){
 const state=network(),reads:Subject<any>[]=[];const api:any={verifyContractPackage$:vi.fn(()=>{const read=new Subject();reads.push(read);return read;})};
 const page=new DlcInspectComponent(api,{markForCheck:vi.fn()} as any,state as any);page.ngOnInit();page.loadSample();
 const result=()=>({input_sha256:digest(JSON.parse(page.packageInput)),configured_network:'signet',valid:null,structural_checks_passed:true,cryptographic_verification:'not-established',scope:'Declared arithmetic only',warnings:['Unverified contract'],errors:[],total_collateral_sats:20000,cet_count:1});
 return{page,state,api,reads,result};
}
describe('DLC structural evidence ownership',()=>{
 it('binds reported arithmetic to exact submitted JSON and leaves cryptographic validity unknown',()=>{const f=inspector();f.page.verifyPackage();f.reads[0].next(f.result());expect(f.page.report.valid).toBeNull();expect(f.page.report.total_collateral_sats).toBe(20000);f.page.ngOnDestroy();});
 it.each([{input_sha256:'f'.repeat(64)},{configured_network:'mainnet'},{valid:true},{valid:'true'},{total_collateral_sats:NaN},{errors:['x']}])('rejects mismatched or unsupported success shape %j',patch=>{const f=inspector();f.page.verifyPackage();f.reads[0].next({...f.result(),...patch});expect(f.page.report).toBeNull();expect(f.page.error).toContain('mismatched');f.page.ngOnDestroy();});
 it.each(['edit','sample','network','destroy'])('cancels pending evidence on %s',action=>{const f=inspector();f.page.verifyPackage();if(action==='edit')f.page.edited();else if(action==='sample')f.page.loadSample();else if(action==='network')f.state.networkChanged$.next('regtest');else f.page.ngOnDestroy();expect(f.reads[0].observed).toBe(false);f.reads[0].next(f.result());expect(f.page.report).toBeNull();f.page.ngOnDestroy();});
 it('separates malformed input and unavailable service from cryptographic invalidity',()=>{const f=inspector();f.page.packageInput='null';f.page.verifyPackage();expect(f.api.verifyContractPackage$).not.toHaveBeenCalled();expect(f.page.report).toBeNull();f.page.loadSample();f.page.verifyPackage();f.reads[0].error({status:503,error:{error:'Source unavailable'}});expect(f.page.error).toBe('Source unavailable');expect(f.page.report).toBeNull();f.page.ngOnDestroy();});
});
describe('DLC simulation request ownership',()=>{
 it('uses actual contract/scenario/oracle parameter names and cancels on edit/network',()=>{const state=network(),read=new Subject<any>(),api:any={runSimulation$:vi.fn(()=>read)};const page=new DlcSimulateComponent(api,{markForCheck:vi.fn()} as any,state as any);page.ngOnInit();page.contractId='contract-1';page.selectedOracle='oracle-1';page.runSimulation();expect(api.runSimulation$).toHaveBeenCalledWith({scenario:'settlement',contract_id:'contract-1',oracle_ids:['oracle-1']});state.networkChanged$.next('regtest');expect(read.observed).toBe(false);expect(page.result).toBeNull();page.ngOnDestroy();});
 it('keeps unavailable and malformed responses separate from success and checks IDs locally',()=>{const read=new Subject<any>(),api:any={runSimulation$:vi.fn(()=>read)},page=new DlcSimulateComponent(api,{markForCheck:vi.fn()} as any,network() as any);page.ngOnInit();page.runSimulation();expect(api.runSimulation$).not.toHaveBeenCalled();page.contractId='c1';page.selectedOracle='o1';page.runSimulation();read.next({status:'simulated_success'});expect(page.result).toBeNull();expect(page.error).toContain('mismatched');page.runSimulation();read.error({status:503,error:{error:'Simulator not connected'}});expect(page.result).toBeNull();expect(page.error).toBe('Simulator not connected');page.ngOnDestroy();});
});
describe('rendered DLC report scope',()=>{
 beforeAll(()=>{for(const component of [DlcInspectComponent,DlcSimulateComponent])Object.defineProperty(component,'ctorParameters',{configurable:true,value:()=>[{type:DlcApiService},{type:ChangeDetectorRef},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
 afterEach(()=>TestBed.resetTestingModule());
 it('renders arithmetic success without a cryptographic or browser-private claim',()=>{const f=inspector();TestBed.configureTestingModule({providers:[provideRouter([]),{provide:DlcApiService,useValue:f.api},{provide:StateService,useValue:f.state}]});const view=TestBed.createComponent(DlcInspectComponent);view.detectChanges();view.componentInstance.loadSample();view.componentInstance.verifyPackage();f.reads[0].next(f.result());view.detectChanges();const text=view.nativeElement.textContent;expect(text).toContain('Arithmetic checks passed; contract unverified');expect(text).toContain('20,000 sat');expect(text).toContain('sent to this explorer backend');expect(text).not.toContain('All collateral, payout curves, and adaptor signatures verified');expect(text).not.toContain('strictly in your local session');f.page.ngOnDestroy();});
 it('renders real service failure without a completed simulation message',()=>{const read=new Subject<any>();TestBed.configureTestingModule({providers:[provideRouter([]),{provide:DlcApiService,useValue:{runSimulation$:()=>read}},{provide:StateService,useValue:network()}]});const view=TestBed.createComponent(DlcSimulateComponent);view.detectChanges();view.componentInstance.contractId='c1';view.componentInstance.selectedOracle='o1';view.componentInstance.runSimulation();read.error({status:503,error:{error:'Simulator unavailable'}});view.detectChanges();const text=view.nativeElement.textContent;expect(text).toContain('Simulator unavailable');expect(text).not.toContain('Simulation completed');expect(text).not.toContain('Reported simulation result');});
});
