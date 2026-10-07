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
    const c=fixture.componentInstance, cp={blockHeight:10,blockHash:'2'.repeat(64),network:'signet',genesisHash:'1'.repeat(64),signetChallenge:'51',verifiedAt:'2026-10-03T00:00:00Z'};
    c.version='v4';c.view={schema:'universe-address-utxo-reconstruction-v4',status:'PARTIAL',address:'tb1qpublic',network:'signet',
      confirmedAnchor:{...cp,sourceId:'3'.repeat(64),scriptPubKey:'51',chainStats:{tx_count:1,funded_txo_count:1,spent_txo_count:0,funded_txo_sum:1,spent_txo_sum:0}},
      latestObservedTip:cp,confirmedTailAnchor:null,mempoolAnchor:null,progress:{phase:'confirmed',confirmedEpoch:0,mempoolEpoch:0,pageLimit:100,
        confirmedTransactionsProcessed:0,confirmedTransactionsExpected:1,confirmedTailTransactionsProcessed:0,confirmedTailTransactionsExpected:null,
        mempoolTransactionsProcessed:0,mempoolTransactionsExpected:null,candidateOutputs:0,verifiedOutputs:0,retainedBytes:0},
      globalMempoolProof:{mode:'strict-global-fallback',fallbackReason:'GLOBAL_TRANSACTION_CAPACITY',transactionCount:101,maximumTransactions:100,
        maximumRetainedBytes:524288,retainedBytes:0,transitionCount:0,maximumTransitions:128,maximumRetainedTransitions:8,initialIdentity:'4'.repeat(64),
        sequenceAtomic:'1',transitions:[],verifiedOutputContext:null},cursor:0,sessionId:'12345678-1234-1234-1234-123456789abc',observedAt:cp.verifiedAt,expiresAt:'2026-10-03T01:00:00Z'};
    c['cd'].markForCheck();fixture.detectChanges();const text=fixture.nativeElement.textContent;
    expect(text).toContain('V4 page limit');expect(text).toContain('strict-global-fallback');expect(text).toContain('GLOBAL_TRANSACTION_CAPACITY');
    expect(text).toContain('Latest observed shared tip: 10 /');expect(text).not.toContain('\uFFFD');
    expect(text).toContain('No eligible output list or complete balance');expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('option[value=v4]')).not.toBeNull();
  });
});
