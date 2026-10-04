// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { afterEach,beforeAll,describe,expect,it,vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule,platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of,Subject,throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '../universe-api.service';
import { StratumV2Component } from './stratum-v2.component';
import { configuredFixture,pagesFixture } from './stratum-v2.fixtures';
describe('Actual SV2 template truthful facts',()=>{
 beforeAll(()=>{Object.defineProperty(StratumV2Component,'ctorParameters',{configurable:true,value:()=>[{type:UniverseApiService},{type:SeoService},{type:StateService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});afterEach(()=>TestBed.resetTestingModule());
 function render(failed=false){const changed=new Subject<string>();const state={network:'signet',networkChanged$:changed,env:{ROOT_NETWORK:'mainnet',BASE_MODULE:'mempool',SV2_SOURCE_PROFILE:configuredFixture as any}};TestBed.overrideComponent(StratumV2Component,{set:{template:readFileSync('src/app/universe/stratum-v2/stratum-v2.component.html','utf8'),templateUrl:undefined,styles:[],styleUrls:[]}});TestBed.configureTestingModule({providers:[provideRouter([]),{provide:StateService,useValue:state},{provide:SeoService,useValue:{setTitle:vi.fn()}},{provide:UniverseApiService,useValue:{getStratumV2Page$:(f:keyof typeof pagesFixture)=>failed&&f==='declarations'?throwError(()=>new Error('Native declaration unavailable')):of(pagesFixture[f])}}]});const fixture=TestBed.createComponent(StratumV2Component);fixture.detectChanges();return{fixture,state,changed,element:fixture.nativeElement as HTMLElement};}
 it('displays independently labelled regtest/retention and remaining coinbase without unsupported Noise or total claims',()=>{const r=render();const text=r.element.textContent;expect(text).toContain('Independent SV2 source: regtest');expect(text).toContain('Complete history: No');expect(text).toContain('sats remaining; total coinbase: Unknown');expect(text).toContain('Transaction lists: Unknown');expect(text).not.toContain('Noise Secured');expect(text).not.toContain('null');expect(r.element.querySelectorAll('[role=region][tabindex="0"]')).toHaveLength(3);});
 it('declaration failure keeps observed roles/template visible, and context with no profile clears all retained source tables',()=>{const r=render(true);expect(r.element.textContent).toContain('template-provider');expect(r.element.textContent).toContain('Native declaration unavailable');expect(r.element.textContent).toContain('sats remaining');r.state.env.SV2_SOURCE_PROFILE=null;r.changed.next('testnet');r.fixture.detectChanges();expect(r.element.textContent).not.toContain('sats remaining');expect(r.element.textContent).not.toContain('template-provider');expect(r.element.textContent).toContain('No independently configured');expect(r.element.querySelectorAll('tbody tr')).toHaveLength(0);});
});
