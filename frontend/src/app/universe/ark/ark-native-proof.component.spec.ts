// @vitest-environment jsdom
import 'zone.js';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { UniverseApiService } from '../universe-api.service';
import { ArkNativeProofComponent } from './ark-native-proof.component';
import { nativeInput, nativeSource, nativeVerdict } from './ark-native-test-fixtures';

describe('Versioned native Ark proof consumer ownership', () => {
  beforeAll(() => TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()));
  afterEach(() => TestBed.resetTestingModule());
  function setup() {
    const requests: Subject<any>[]=[];
    const verifyArkNativeProof$=vi.fn(() => {const response=new Subject();requests.push(response);return response;});
    const state={network:'',networkChanged$:new Subject<string>(),env:{ROOT_NETWORK:'signet'}};
    TestBed.configureTestingModule({providers:[{provide:UniverseApiService,useValue:{verifyArkNativeProof$}},{provide:StateService,useValue:state}]});
    const fixture=TestBed.createComponent(ArkNativeProofComponent);
    const component=fixture.componentInstance;
    component.operators=[{id:nativeSource.profile.providerId,name:'Observed native provider',aspPubkey:nativeSource.info.signerPubkey,
      status:'observed',activeVtxoCount:null,currentBatchHeight:null,totalVolumeSats:null,roundIntervalSec:null,source:nativeSource}];
    fixture.detectChanges(); component.edit(JSON.stringify(nativeInput));
    return {fixture,component,state,requests,verifyArkNativeProof$};
  }
  it('submits one exact public package on a Signet root and renders the bounded native verdict without exit promotion', () => {
    const {component,fixture,requests,verifyArkNativeProof$}=setup();
    component.verify();component.verify();
    expect(verifyArkNativeProof$).toHaveBeenCalledTimes(1);expect(verifyArkNativeProof$).toHaveBeenCalledWith(nativeInput);
    expect(component.pending).toBe(true);requests[0].next(nativeVerdict);requests[0].complete();fixture.detectChanges();
    expect(component.pending).toBe(false);expect(component.verdict.valid).toBe(true);
    const text=fixture.nativeElement.textContent;
    expect(text).toContain('Native proof verified within the stated scope');
    expect(text).toContain('Unilateral exit viability: Unknown');expect(text).toContain('Whole protocol verification: Unknown');
    expect(text).toContain(nativeVerdict.evidence.amountAtomic+' sats');
    expect(text).toContain(nativeVerdict.evidence.nativePsbtSha256[0]);
    expect(text).not.toContain('Exit verified');
  });
  it.each(['input','clear','network','provider','destroy'])('cancels pending native verification on %s and rejects late evidence', cause => {
    const {component,state,requests,fixture}=setup();component.verify();
    if(cause==='input')component.edit('{}');
    if(cause==='clear')component.clear();
    if(cause==='network'){state.network='mainnet';state.networkChanged$.next('mainnet');}
    if(cause==='provider'){component.operators=[];component.ngOnChanges();}
    if(cause==='destroy')fixture.destroy();
    expect(requests[0].observed).toBe(false);requests[0].next(nativeVerdict);requests[0].complete();
    expect(component.verdict).toBeNull();expect(component.pending).toBe(false);
    if(['clear','network'].includes(cause))expect(component.text).toBe('');
  });
  it('renders an unavailable scoped verdict as unknown and permits a genuine retry', () => {
    const {component,fixture,requests}=setup();component.verify();
    requests[0].error({status:503,error:{schema:'universe-ark-native-proof-verdict-v1',valid:null,stage:'unavailable-native-verifier',
      exitViable:null,protocolVerified:null,error:'Native anchor unavailable.',scope:nativeVerdict.scope}});
    fixture.detectChanges();expect(component.verdict.valid).toBeNull();expect(component.pending).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Native verifier unavailable');
    component.verify();expect(requests).toHaveLength(2);requests[1].next(nativeVerdict);requests[1].complete();
    expect(component.verdict.valid).toBe(true);
  });
  it('rejects a foreign provider digest instead of rendering a verified badge', () => {
    const {component,requests,fixture}=setup();component.verify();const verdict=structuredClone(nativeVerdict);
    verdict.source.profileSha256='f'.repeat(64);requests[0].next(verdict);requests[0].complete();fixture.detectChanges();
    expect(component.verdict).toBeNull();expect(component.error).toContain('source changed');
    expect(fixture.nativeElement.textContent).not.toContain('Native proof verified within');
  });
  it('does not issue IO for hash arrays, unobserved providers or a foreign network', () => {
    const {component,state,verifyArkNativeProof$}=setup();
    component.edit(JSON.stringify(['a'.repeat(64)]));component.verify();
    component.edit(JSON.stringify(nativeInput));component.operators=[];component.verify();
    state.network='mainnet';component.verify();expect(verifyArkNativeProof$).not.toHaveBeenCalled();
  });
});
