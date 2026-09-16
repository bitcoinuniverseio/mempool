// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { StateService } from '@app/services/state.service';
import { Subject, of, throwError } from 'rxjs';
import { VerifyProofComponent } from './verify-proof.component';
const txid = '11'.repeat(32), block = '22'.repeat(32);
const valid = { txid, block_hash: block, is_valid: true, is_verified: true, verification_status: 'valid', network: 'signet', source: { network: 'signet' }, block_height: 100, tx_index: 1, proof_hex: '00', confirmations: 2, verification_scope: 'Owned node proof' };
describe('Owned-chain SPV verification UI', () => {
  beforeAll(() => { Object.defineProperty(VerifyProofComponent, 'ctorParameters', { configurable: true, value: () => [{ type: HttpClient }, { type: StateService }, { type: ChangeDetectorRef }] }); TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
  afterEach(() => TestBed.resetTestingModule());
  function render(response: any) {
    const state = { network: 'signet', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() }; let posted: any;
    TestBed.configureTestingModule({ providers: [{ provide: StateService, useValue: state }, { provide: HttpClient, useValue: { post: (url: string, body: any) => { posted = { url, body }; return response; } } }] });
    const view = TestBed.createComponent(VerifyProofComponent); view.componentInstance.spvTxid = txid; view.componentInstance.spvBlockHash = block; view.detectChanges();
    return { view, state, posted: () => posted };
  }
  it('shows positive inclusion only for explicit consistent owned-node evidence', () => {
    const { view, posted } = render(of(valid)); view.componentInstance.generateSpv(); view.detectChanges();
    expect(posted().body).toEqual({ txid, block_hash: block, network: 'signet' });
    expect(view.nativeElement.textContent).toContain('TXID INCLUSION VERIFIED AT OWNED CHECKPOINT');
    expect(view.nativeElement.textContent).not.toContain('Client-Side Verification');
  });
  it.each([{}, { ...valid, txid: '33'.repeat(32) }, { ...valid, source: { network: 'mainnet' } }, { ...valid, is_valid: 'true' }])('rejects malformed or mismatched response %j', result => {
    const { view } = render(of(result)); view.componentInstance.generateSpv(); view.detectChanges();
    expect(view.componentInstance.spvResult).toBeNull(); expect(view.componentInstance.spvError).toContain('inconsistent');
    expect(view.nativeElement.textContent).not.toContain('TXID INCLUSION VERIFIED AT OWNED CHECKPOINT');
  });
  it('renders invalid proof as invalid and never colors it as verified', () => {
    const { view } = render(of({ network: 'signet', is_valid: false, is_verified: false, error: 'Merkle mismatch', verification_status: 'invalid' }));
    view.componentInstance.generateSpv(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('INVALID PROOF'); expect(view.nativeElement.querySelector('.text-success')).toBeNull();
  });
  it('cancels input, network and destroyed requests and clears old results', () => {
    const response = new Subject<any>(); const { view, state } = render(response);
    view.componentInstance.generateSpv(); expect(response.observed).toBe(true);
    view.componentInstance.invalidateSpv(); expect(response.observed).toBe(false);
    view.componentInstance.generateSpv(); response.next(valid); expect(view.componentInstance.spvResult).not.toBeNull();
    state.network = 'regtest'; state.networkChanged$.next('regtest'); expect(view.componentInstance.spvResult).toBeNull(); expect(response.observed).toBe(false);
    view.componentInstance.generateSpv(); view.destroy(); expect(response.observed).toBe(false);
  });
  it('binds supplied raw proof bytes and rejects a response after an unreported field change', () => {
    const response = new Subject<any>(); const { view, posted } = render(response); view.componentInstance.spvProofHex = '00'; view.componentInstance.verifySpv();
    expect(posted().url).toContain('/verify-spv'); expect(posted().body.proof_hex).toBe('00');
    view.componentInstance.spvProofHex = '11'; response.next(valid); expect(view.componentInstance.spvResult).toBeNull();
  });
  it('sends an empty message for real verification and reports unavailable without a fake success', () => {
    const { view, posted } = render(throwError(() => ({ error: { error: 'Signature verifier unavailable' } })));
    view.componentInstance.sigAddress = 'address'; view.componentInstance.sigPayload = 'A'.repeat(88); view.componentInstance.sigMessage = '';
    view.componentInstance.verifySig(); view.detectChanges();
    expect(posted().body.message).toBe(''); expect(posted().url).toContain('/verify-signature');
    expect(view.componentInstance.sigResult).toBeNull(); expect(view.nativeElement.textContent).toContain('Signature verifier unavailable');
    expect(view.nativeElement.textContent).not.toContain('VALID CRYPTOGRAPHIC SIGNATURE');
  });
});
