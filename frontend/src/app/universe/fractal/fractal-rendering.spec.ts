// @vitest-environment jsdom
import 'zone.js';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '../universe-api.service';
import { FractalDashboardComponent } from './fractal-dashboard.component';

describe('Fractal native nullable template facts',()=>{
 beforeAll(()=>{Object.defineProperty(FractalDashboardComponent,'ctorParameters',{configurable:true,value:()=>[{type:UniverseApiService},{type:SeoService}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
 afterEach(()=>TestBed.resetTestingModule());
 function render(failed=false):HTMLElement {
  TestBed.overrideComponent(FractalDashboardComponent,{set:{template:readFileSync('src/app/universe/fractal/fractal-dashboard.component.html','utf8'),templateUrl:undefined,styles:[],styleUrls:[]}});
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:StateService,useValue:{network:'signet',networkChanged$:new Subject(),env:{ROOT_NETWORK:'mainnet',BASE_MODULE:'mempool'}}},{provide:SeoService,useValue:{setTitle:vi.fn()}},{provide:UniverseApiService,useValue:{selectedNetwork$:()=>of('signet'),getFractalTip$:()=>of({height:12,hash:'a'.repeat(64),network:'fractal-testnet',observation:{ready:false,network:'fractal-testnet',source:{release:'0.4.0'},observedAt:'2026-10-04T12:00:00Z',checkpoint:{height:12,hash:'a'.repeat(64)}}}),getFractalBlock$:()=>of({height:12,hash:'a'.repeat(64),difficulty:1,size:1234567,weight:4000000,txCount:1}),getFractalMempool$:()=>failed?throwError(()=>new Error('native unavailable')):of({count:0,pendingCat20TxCount:null,medianFeeRate:null,minFeeRate:null,maxFeeRate:null})}}]});
  const fixture=TestBed.createComponent(FractalDashboardComponent);fixture.detectChanges();return fixture.nativeElement;
 }
 it('shows syncing source identity and Unknown instead of blank fees or fake cadence',()=>{
  const text=render().textContent;expect(text).toContain('fractal-testnet');expect(text).toContain('Node is still syncing');expect(text).toContain('CAT-20 pending count: Unknown');expect(text).toContain('Unknown');expect(text).toContain('1234567 bytes');expect(text).not.toContain('~30s');expect(text).not.toContain('null');expect(text).not.toContain('NaN');
 });
 it('keeps observed tip/block beside an explicit mempool warning',()=>{const element=render(true);expect(element.textContent).toContain('#12');expect(element.textContent).toContain('Block at the observed tip');expect(element.querySelector('[role="alert"]').textContent).toContain('Mempool unavailable: native unavailable');});
});
