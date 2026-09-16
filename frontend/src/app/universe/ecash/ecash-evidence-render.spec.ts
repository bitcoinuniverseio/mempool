// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { EcashApiService } from './ecash.service';
import { EcashCashuComponent } from './ecash-cashu.component';
describe('rendered Cashu unavailable keysets',()=>{
 beforeAll(()=>{Object.defineProperty(EcashCashuComponent,'ctorParameters',{configurable:true,value:()=>[{type:EcashApiService},{type:ChangeDetectorRef}]});TestBed.initTestEnvironment(BrowserDynamicTestingModule,platformBrowserDynamicTesting());});
 afterEach(()=>TestBed.resetTestingModule());
 it('does not render failed source as online or zero keysets',()=>{
  TestBed.configureTestingModule({providers:[provideRouter([]),{provide:EcashApiService,useValue:{getCashuMints$:()=>of([{mint_id:'mint-test',mint_url:'https://mint.example.org',name:null,nuts_supported:null,keysets:null,active_keysets_count:null,reachable:false,last_heartbeat:null}])}}]});
  const view=TestBed.createComponent(EcashCashuComponent);view.detectChanges();const text=view.nativeElement.textContent;
  expect(text).toContain('Observation incomplete');expect(text).toContain('Keysets unknown');expect(text).toContain('Supported NUTs unknown');expect(text).not.toContain('Online');expect(text).not.toContain('NaN');
 });
});
