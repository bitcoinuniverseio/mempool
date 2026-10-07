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
import { coverage,summary,federation,assets,pegs } from './liquid-fixtures';
import { LiquidObservatoryComponent } from './liquid-observatory.component';

describe('Liquid native unknown facts', () => {
 beforeAll(() => { Object.defineProperty(LiquidObservatoryComponent, 'ctorParameters', {configurable:true,value:()=>[{type:UniverseApiService},{type:SeoService}]}); TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
 afterEach(() => TestBed.resetTestingModule());
 function render(failed=false,requests=false): HTMLElement {
  TestBed.overrideComponent(LiquidObservatoryComponent,{set:{template:readFileSync('src/app/universe/liquid-observatory/liquid-observatory.component.html','utf8'),templateUrl:undefined,styles:[],styleUrls:[]}});
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:StateService,useValue:{network:'signet',networkChanged$:new Subject(),env:{ROOT_NETWORK:'mainnet',BASE_MODULE:'mempool'}}},{provide:SeoService,useValue:{setTitle:vi.fn()}},{provide:UniverseApiService,useValue:{getLiquidNode$:()=>throwError(()=>new Error('unavailable')),getLiquidProjection$:()=>of(coverage()),getLiquidObservatorySummary$:()=>of(summary()),getLiquidFederation$:()=>of(federation()),getLiquidAssets$:()=>failed?throwError(()=>new Error('catalog unavailable')):of(assets()),getLiquidPegs$:()=>failed?throwError(()=>new Error('pegs unavailable')):of(requests?{...pegs(),pegOuts:{...pegs().pegOuts,total:1,requests:[{txid:"f".repeat(64),vout:0,amountAtomic:"200000",parentScript:"51",parentAddress:null,parentPayoutStatus:"UNKNOWN",bitcoinTxid:null}]}}:pegs())}}]});
  const fixture=TestBed.createComponent(LiquidObservatoryComponent); fixture.detectChanges(); return fixture.nativeElement;
 }
 it('does not convert an unknown reserve to zero BTC',()=>{const text=render().textContent;expect(text).not.toContain('0.00 BTC');expect(text).toContain('Unknown');});
 it('shows a peg-out request without fabricating a parent explorer or payout',()=>{const element=render(false,true);expect(element.textContent).toContain('0.00200000 BTC (200000 atomic)');expect(element.textContent).toContain('Unknown; no proven parent transaction');expect([...element.querySelectorAll('a')].some(link=>link.getAttribute('href')?.includes('/tx/'))).toBe(false);});
 it('retains observed height while catalog and peg reads are unavailable',()=>{const text=render(true).textContent;expect(text).toContain('11');expect(text).toContain('catalog unavailable');expect(text).toContain('pegs unavailable');});
});
