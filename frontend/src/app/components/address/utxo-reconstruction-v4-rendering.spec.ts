// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { UtxoReconstructionComponent } from './utxo-reconstruction.component';
import { readFileSync } from 'node:fs';
import type { UtxoReconstructionV4View } from './utxo-reconstruction-v4-view';

describe('actual reconstruction template version and source disclosure', () => {
  beforeAll(() => {
    Object.defineProperty(UtxoReconstructionComponent, 'ctorParameters', { configurable:true, value:() => [{type:HttpClient},{type:StateService},{type:ChangeDetectorRef}] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());
  it('renders independent V4 fallback limits and shared tip with no replacement glyph or eligible output claim', () => {
    TestBed.configureTestingModule({providers:[provideRouter([]),{provide:HttpClient,useValue:{delete:vi.fn().mockReturnValue(of({}))}},
      {provide:StateService,useValue:{network:'signet',networkChanged$:new BehaviorSubject('signet'),env:{ROOT_NETWORK:'mainnet'}}}]});
    const fixture=TestBed.createComponent(UtxoReconstructionComponent);fixture.detectChanges();
    const native=JSON.parse(readFileSync('src/app/components/address/utxo-reconstruction-v4-native-fallback.fixture.json','utf8')) as {views:UtxoReconstructionV4View[]};
    const c=fixture.componentInstance;c.version='v4';c.view=native.views.find(view=>view.globalMempoolProof.mode==='strict-global-fallback');
    c['cd'].markForCheck();fixture.detectChanges();const text=fixture.nativeElement.textContent;
    expect(text).toContain('V4 page limit');expect(text).toContain('strict-global-fallback');expect(text).toContain('GLOBAL_POOL_EXCEEDS_PROOF_CAPACITY');
    expect(text).toContain('Observed global mempool: 2429 transactions');expect(text).toContain('Transaction proof capacity: 100 transactions');
    expect(text).toContain('Retained transaction proofs: none');expect(text).toContain('Retained fallback metadata: 512 bytes');
    expect(text).toContain('Global state accounting: 512 / 524288 bytes');expect(text).not.toContain('Bounded proof cache');
    expect(text).toContain('Latest observed shared tip: 325621 /');expect(text).not.toContain('\uFFFD');
    expect(text).toContain('No eligible output list or complete balance');expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('option[value=v4]')).not.toBeNull();
  });
  it('distinguishes actual irrelevant-proof retention from global observation and byte accounting',()=>{
    TestBed.configureTestingModule({providers:[provideRouter([]),{provide:HttpClient,useValue:{delete:vi.fn().mockReturnValue(of({}))}},
      {provide:StateService,useValue:{network:'signet',networkChanged$:new BehaviorSubject('signet'),env:{ROOT_NETWORK:'mainnet'}}}]});
    const fixture=TestBed.createComponent(UtxoReconstructionComponent);fixture.detectChanges();
    const native=JSON.parse(readFileSync('src/app/components/address/utxo-reconstruction-v4-native-measurement.fixture.json','utf8')) as {value:UtxoReconstructionV4View};
    const c=fixture.componentInstance;c.version='v4';c.view=native.value;c['cd'].markForCheck();fixture.detectChanges();
    const text=fixture.nativeElement.textContent;
    expect(text).toContain('irrelevant-delta-proof');expect(text).toContain('Observed global mempool: '+native.value.globalMempoolProof.transactionCount+' transactions');
    expect(text).toContain('Retained transaction proofs: '+native.value.globalMempoolProof.transactionCount+'.');
    expect(text).toContain('Retained proof state includes transaction proofs and metadata');
    expect(text).toContain('Global state accounting: '+native.value.globalMempoolProof.retainedBytes+' / 524288 bytes');
    expect(text).not.toContain('Retained fallback metadata');expect(text).not.toContain('Bounded proof cache');
  });

});
