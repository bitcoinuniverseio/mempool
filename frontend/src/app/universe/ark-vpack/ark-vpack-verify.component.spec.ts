import { StateService } from '@app/services/state.service';
// @vitest-environment jsdom
import 'zone.js';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { ArkVpackVerifyComponent } from './ark-vpack-verify.component';
describe('Ark anchor verifier interaction', () => {
  beforeAll(() => {
    Object.defineProperty(ArkVpackVerifyComponent, 'ctorParameters', { configurable: true, value: () => [{ type: HttpClient }, { type: ChangeDetectorRef }, { type: StateService }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());
  function render(response: any) {
    const post = vi.fn(() => response);
    const state = { network: 'signet', env: { ROOT_NETWORK: 'signet' }, networkChanged$: new Subject<string>() };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: StateService, useValue: state }, { provide: HttpClient, useValue: { post } }] });
    const view = TestBed.createComponent(ArkVpackVerifyComponent); view.detectChanges(); return { view, post, state };
  }
  it('starts without a fabricated success and submits the entered outpoint', () => {
    const { view, post } = render(of({ anchor_outpoint: 'bb'.repeat(32) + ':0', spend_status: 'spent', exists_onchain: true, confirmations: 3, commitment_matches: null,
      protocol_verified: null, exit_delay_blocks: null, script_pub_key: '51', errors: [], verification_scope: 'Owned Core output evidence',
      source: { network: 'signet', block_hash: 'aa'.repeat(32), observed_at: '2026-09-15T00:00:00Z' } }));
    expect(view.nativeElement.textContent).not.toContain('45 confirmations');
    const input = view.nativeElement.querySelector('input'); input.value = 'bb'.repeat(32) + ':0'; input.dispatchEvent(new Event('input')); view.detectChanges();
    view.nativeElement.querySelector('button').click(); view.detectChanges();
    expect(post).toHaveBeenCalledWith('/api/v1/intelligence/ark/vpack/public-anchors/verify', { anchor_outpoint: 'bb'.repeat(32) + ':0' });
    expect(view.nativeElement.textContent).toContain('Observed output: spent');
    expect(view.nativeElement.textContent).toContain('Ark protocol proof: Not established');
  });
  it('renders source errors instead of retaining a verified result', () => {
    const { view } = render(throwError(() => ({ error: { error: 'Owned source unavailable' } })));
    view.componentInstance.outpoint = 'bb'.repeat(32) + ':0'; view.componentInstance.verify(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('Owned source unavailable'); expect(view.componentInstance.result).toBeNull();
  });
  it('rejects malformed success bodies', () => {
    const { view } = render(of({ verified: true })); view.componentInstance.verify(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('invalid evidence'); expect(view.componentInstance.result).toBeNull();
  });
  it('invalidates pending reads on edit and network changes and cancels on destroy', () => {
    const response = new Subject<any>(); const { view, state } = render(response);
    view.componentInstance.outpoint = 'bb'.repeat(32) + ':0'; view.componentInstance.verify();
    expect(response.observed).toBe(true);
    view.componentInstance.outpoint = 'cc'.repeat(32) + ':1'; view.componentInstance.invalidate();
    expect(response.observed).toBe(false); expect(view.componentInstance.result).toBeNull();
    view.componentInstance.verify(); state.network = 'testnet'; state.networkChanged$.next('testnet');
    expect(response.observed).toBe(false); expect(view.componentInstance.result).toBeNull();
    view.componentInstance.verify(); view.destroy(); expect(response.observed).toBe(false);
  });
  it('rejects evidence for a different network or outpoint', () => {
    const { view } = render(of({ anchor_outpoint: 'bb'.repeat(32) + ':0', source: { network: 'mainnet', block_hash: 'aa'.repeat(32) },
      spend_status: 'unspent', errors: [], verification_scope: 'wrong source' }));
    view.componentInstance.outpoint = 'bb'.repeat(32) + ':0'; view.componentInstance.verify(); view.detectChanges();
    expect(view.componentInstance.result).toBeNull(); expect(view.nativeElement.textContent).toContain('invalid evidence');
  });
});
