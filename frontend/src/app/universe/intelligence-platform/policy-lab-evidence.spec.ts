// @vitest-environment jsdom
import 'zone.js';
import { beforeAll,afterEach,describe,it,expect,vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule,platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { Subject,of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { IntelligenceApiService } from './intelligence-api.service';
import { PolicyLabComponent } from './policy-lab.component';
const raw='020000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff012823000000000000015100000000';
const digest=async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const setup=()=>{const responses=new Subject<any>(),networkChanged$=new Subject<string>(),state:any={network:'signet',networkChanged$};const api:any={getNodeProfiles$:()=>of({profiles:[]}),evaluatePackage$:vi.fn(()=>responses)};const page=new PolicyLabComponent(api,{markForCheck:()=>{}} as ChangeDetectorRef,state);return {page,api,state,responses};};
describe('policy input ownership',()=>{
 it('rejects foreign byte/network results and clears edits',async()=>{const {page,responses}=setup();page.rawTransactionsInput=raw;await page.evaluate();responses.next({package_report:{input_hash:'ff'.repeat(32),network:'signet',members:[{}]}});expect(page.evaluationResult).toBeNull();expect(page.errorMessage).toContain('does not match');page.invalidate();expect(page.errorMessage).toBeNull();});
 it('binds actual digest, then immediately removes result at network change',async()=>{const {page,state,responses}=setup();page.ngOnInit();page.rawTransactionsInput=raw;await page.evaluate();responses.next({package_report:{input_hash:await digest(),network:'signet',members:[{}]}});expect(page.evaluationResult).not.toBeNull();state.network='mainnet';state.networkChanged$.next('mainnet');expect(page.evaluationResult).toBeNull();expect(responses.observed).toBe(false);page.ngOnDestroy();});
 it('cancels pending evaluation on destroy without accepting late result',async()=>{const {page,responses}=setup();page.rawTransactionsInput=raw;await page.evaluate();page.ngOnDestroy();expect(responses.observed).toBe(false);responses.next({package_report:{input_hash:await digest(),network:'signet',members:[{}]}});expect(page.evaluationResult).toBeNull();});
});
describe('rendered uncalibrated evidence',()=>{
 beforeAll(()=>{Object.defineProperty(PolicyLabComponent,'ctorParameters',{configurable:true,value:()=>[{type:IntelligenceApiService},{type:ChangeDetectorRef},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});afterEach(()=>TestBed.resetTestingModule());
 it('renders unknown probability and fee fields without zero percentages or consensus success',()=>{
  TestBed.configureTestingModule({providers:[{provide:IntelligenceApiService,useValue:{getNodeProfiles$:()=>of({profiles:[]})}},{provide:StateService,useValue:{network:'signet'}}]});const view=TestBed.createComponent(PolicyLabComponent);view.componentInstance.evaluationResult={package_report:{overall_allowed:null,package_feerate_sats_vb:null,total_fees_sats:null,members:[{allowed:null,consensus_valid:null,relay_valid:null,fee_sats:null,effective_feerate:null}]},forecast:{next_block:null,confidence_interval:null,scope:'Observed queue only',queue_capacity_blocks:null}};view.detectChanges();const text=view.nativeElement.textContent;expect(text).toContain('Probability unknown');expect(text).toContain('Confidence interval unknown');expect(text).toContain('POLICY UNKNOWN');expect(text).toContain('Not independently verified');expect(text).not.toContain('0.0%');expect(text).not.toContain('NaN');
 });
});
