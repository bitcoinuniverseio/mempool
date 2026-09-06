// @vitest-environment jsdom
import 'zone.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OpenTimestampsApiService } from './opentimestamps.service';
import { OpenTimestampsVerifyComponent } from './opentimestamps-verify.component';

const digest = 'ab'.repeat(32);
const anchored = {
  status: 'bitcoin_attestation_verified', verified: true, digest_matches: null,
  file_digest: digest, file_hash_algorithm: 'sha256', network: 'mainnet',
  earliest_proven_block_height: 123, earliest_proven_time_utc: '2026-09-06T00:00:00Z',
  bitcoin_block_hash: 'cd'.repeat(32), attestation_type: 'bitcoin',
  operation_count: 4, calendar_attestations: [], notices: [], errors: [],
};

describe('OpenTimestamps verification presentation', () => {
  beforeAll(() => {
    // Vitest transpiles decorators without Angular's constructor metadata.
    Object.defineProperty(OpenTimestampsVerifyComponent, 'ctorParameters', { configurable: true,
      value: () => [{ type: OpenTimestampsApiService }, { type: StateService }] });
    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
  });
  afterEach(() => TestBed.resetTestingModule());

  function create(response: unknown = anchored) {
    const networkChanged$ = new Subject<string>();
    const state = { network: '', networkChanged$ };
    const api = { verifyProof$: vi.fn(() => of(response)) };
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: StateService, useValue: state }, { provide: OpenTimestampsApiService, useValue: api }] });
    const view = TestBed.createComponent(OpenTimestampsVerifyComponent);
    view.componentInstance.proofBase64 = 'public-test-proof';
    view.detectChanges();
    return { view, component: view.componentInstance, api, state, networkChanged$ };
  }

  it.each([{}, { verified: true }, { ...anchored, verified: false },
    { ...anchored, bitcoin_block_hash: undefined }, { ...anchored, network: 'signet' },
    { ...anchored, errors: ['commitment mismatch'] }])('never treats an incomplete or conflicting HTTP 200 as verified', response => {
    const { view, component } = create(response);
    component.verifyProof(); view.detectChanges();
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
    expect(component.verificationResult).toBeNull();
    expect(component.loadError).toContain('No proof was verified');
  });

  it.each([
    ['pending_calendar_attestation', 'Pending calendar attestation'],
    ['bitcoin_attestation_invalid', 'Proof verification failed'],
    ['file_mismatch', 'Proof verification failed'],
    ['bitcoin_attestation_reorg', 'Proof verification failed'],
    ['unsupported_attestation', 'Verification unavailable'],
  ])('renders %s without a confirmed badge', (status, heading) => {
    const { view, component } = create({ ...anchored, status, verified: false });
    component.verifyProof(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain(heading);
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
  });

  it('renders standard anchor fields without claiming file identity when no digest was supplied', () => {
    const { view, component, api } = create();
    component.verifyProof(); view.detectChanges();
    expect(api.verifyProof$).toHaveBeenCalledWith({ proof: 'public-test-proof', network: 'mainnet' });
    expect(view.nativeElement.textContent).toContain('BITCOIN CONFIRMED');
    expect(view.nativeElement.textContent).toContain('123');
    expect(view.nativeElement.textContent).toContain('2026-09-06T00:00:00Z');
    expect(view.nativeElement.textContent).toContain('4 step(s)');
    expect(view.nativeElement.textContent).toContain('No file digest was supplied');
    expect(view.nativeElement.textContent).not.toContain('Provided file digest matches');
  });

  it('sends and requires the exact optional digest and selected network', () => {
    const { view, component, api, state } = create({ ...anchored, network: 'signet', digest_matches: true });
    state.network = 'signet'; component.expectedDigest = digest.toUpperCase();
    component.verifyProof(); view.detectChanges();
    expect(api.verifyProof$).toHaveBeenCalledWith({ proof: 'public-test-proof', network: 'signet', digest });
    expect(view.nativeElement.textContent).toContain('Provided file digest matches');
  });

  it.each([{ digest_matches: false }, { digest_matches: null }, { digest_matches: true, file_digest: 'ef'.repeat(32) }])('does not certify an unchecked or different requested file digest', mismatch => {
    const { component, view } = create({ ...anchored, ...mismatch });
    component.expectedDigest = digest; component.verifyProof(); view.detectChanges();
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
    expect(component.loadError).toContain('No proof was verified');
  });

  it('rejects malformed expected digests before sending a request', () => {
    const { component, api, view } = create();
    component.expectedDigest = 'not a digest'; component.verifyProof(); view.detectChanges();
    expect(api.verifyProof$).not.toHaveBeenCalled();
    expect(component.loadError).toContain('hexadecimal');
  });

  it('preserves a negative network mismatch verdict from a reader configured for a different network', () => {
    const { component, view, state } = create({ ...anchored, verified: false, status: 'network_mismatch', errors: ['Reader is configured for mainnet'] });
    state.network = 'signet'; component.verifyProof(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain('Proof verification failed');
    expect(view.nativeElement.textContent).toContain('Reader is configured for mainnet');
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
  });

  it.each([
    [400, 'invalid-input', 'Invalid proof'],
    [400, 'unsupported-operation', 'Verification unavailable'],
    [503, 'unavailable-bitcoin-header', 'Verification unavailable'],
  ])('distinguishes HTTP %i failures without preserving an old positive verdict', (status, stage, heading) => {
    const { component, api, view } = create();
    component.verifyProof(); view.detectChanges();
    api.verifyProof$.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error: { stage, error: 'Specific verifier reason' } })));
    component.verifyProof(); view.detectChanges();
    expect(view.nativeElement.textContent).toContain(heading);
    expect(view.nativeElement.textContent).toContain('Specific verifier reason');
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
  });

  it('clears an old result when the proof input changes', () => {
    const { component, view } = create();
    component.verifyProof(); view.detectChanges();
    const proof = view.nativeElement.querySelector('textarea');
    proof.value = 'different-proof'; proof.dispatchEvent(new Event('input')); view.detectChanges();
    expect(component.verificationResult).toBeNull();
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
  });

  it('clears and cancels verification on a network change, including a late old-network response', () => {
    const { component, view, api, networkChanged$, state } = create();
    const response$ = new Subject<unknown>(); api.verifyProof$.mockReturnValue(response$);
    component.verifyProof(); state.network = 'signet'; networkChanged$.next('signet');
    response$.next(anchored); view.detectChanges();
    expect(component.verificationResult).toBeNull();
    expect(component.verifying).toBe(false);
    expect(view.nativeElement.textContent).not.toContain('BITCOIN CONFIRMED');
  });
});
