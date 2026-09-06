// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { MultipartyMusig2Component } from './multiparty-musig2.component';
import { MultipartyApiService } from './multiparty.service';

describe('public MuSig2 transcript presentation', () => {
  beforeAll(() => {
    // esbuild omits constructor metadata normally emitted by Angular's compiler.
    Object.defineProperty(MultipartyMusig2Component, 'ctorParameters', { configurable: true,
      value: () => [{ type: MultipartyApiService }, { type: ChangeDetectorRef }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function setup(result: unknown, error = false) {
    const verify = vi.fn(() => error ? throwError(() => result) : of(result));
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: MultipartyApiService, useValue: { verifyMusig2Session$: verify } }] });
    const view = TestBed.createComponent(MultipartyMusig2Component);
    view.detectChanges();
    return { view, verify };
  }

  const partial = { verified: false, stage: 'partial-session', participant_count: 2,
    scope: 'bip327-untweaked-public-transcript',
    aggregate_public_key: '11'.repeat(32), key_aggregation_verified: true,
    nonce_aggregation_verified: false, partial_signature_validity: [], final_bip340_valid: null,
    errors: [], warnings: ['Public nonces and partial signatures are required to verify the complete transcript.'] };

  it('shows key-only scope without certifying a complete signing session', () => {
    const { view } = setup(partial);
    view.componentInstance.verifySession(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('Key aggregation verified. Session incomplete.');
    expect(view.nativeElement.textContent).toContain(partial.aggregate_public_key);
    expect(view.nativeElement.textContent).toContain('2 participants');
    expect(view.nativeElement.textContent).not.toContain('Public transcript verified');
    expect(view.nativeElement.textContent).not.toContain('Taproot Output Key');
  });

  it('preserves participant order and submits the complete optional public transcript', () => {
    const complete = { ...partial, verified: true, stage: 'verified-session', nonce_aggregation_verified: true,
      partial_signature_validity: [true, true], final_bip340_valid: true, final_signature: '22'.repeat(64), warnings: [] };
    const { view, verify } = setup(complete);
    const component = view.componentInstance;
    component.cosignersText = '03' + 'ab'.repeat(32) + '\n02' + 'cd'.repeat(32);
    component.publicNoncesText = 'aa'.repeat(66) + '\n' + 'bb'.repeat(66);
    component.partialSignaturesText = 'cc'.repeat(32) + '\n' + 'dd'.repeat(32);
    component.finalSignature = complete.final_signature;
    component.verifySession(); view.detectChanges();
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      participant_public_keys: component.cosignersText.split('\n'),
      public_nonces: component.publicNoncesText.split('\n'), partial_signatures: component.partialSignaturesText.split('\n'),
      final_signature: complete.final_signature,
    }));
    expect(view.nativeElement.textContent).toContain('Public transcript verified');
  });

  it('passes repeated participant keys to the BIP327 engine instead of inventing a uniqueness rule', () => {
    const { view, verify } = setup(partial);
    const key = '02' + 'ab'.repeat(32);
    view.componentInstance.cosignersText = key + '\n' + key;
    view.componentInstance.verifySession();
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ participant_public_keys: [key, key] }));
  });

  it('clears an earlier success and displays a rejected transcript without a fabricated aggregate', () => {
    const { view } = setup({ status: 400, error: { errors: ['Participant 1 partial signature is invalid.'] } }, true);
    view.componentInstance.verifySession(); view.detectChanges();
    expect(view.nativeElement.querySelector('[role="alert"]').textContent).toContain('Participant 1 partial signature is invalid.');
    expect(view.nativeElement.textContent).not.toContain('Public transcript verified');
    expect(view.componentInstance.report).toBeNull();
  });

  it.each([{}, { valid: true }, { ...partial, verified: true }, { ...partial, errors: ['Invalid point'] }])(
    'rejects an HTTP 200 body that does not establish the claimed verification scope', result => {
      const { view } = setup(result);
      view.componentInstance.verifySession(); view.detectChanges();
      expect(view.componentInstance.report).toBeNull();
      expect(view.nativeElement.querySelector('[role="alert"]').textContent).toContain('did not establish');
    });

  it('cancels an old request when public data changes and clears its verdict', () => {
    const { view, verify } = setup(partial);
    const response = new Subject<typeof partial>();
    verify.mockReturnValue(response);
    view.componentInstance.verifySession();
    expect(view.componentInstance.verifying).toBe(true);
    view.componentInstance.loadSample();
    response.next(partial);
    expect(view.componentInstance.verifying).toBe(false);
    expect(view.componentInstance.report).toBeNull();
    expect(response.observed).toBe(false);
  });
});
