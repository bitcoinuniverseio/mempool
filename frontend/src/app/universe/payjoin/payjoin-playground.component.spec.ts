import { ChangeDetectorRef, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { StateService } from '@app/services/state.service';
import { PayjoinApiService } from './payjoin.service';
import { PayjoinPlaygroundComponent } from './payjoin-playground.component';

const session = (step: 'original_created' | 'proposal_generated' | 'signed_and_broadcast' = 'original_created') => ({ session_id: 'owned-simulation', simulated: true as const, original_txid: null, payjoin_txid: null, step, sender_address: 'simulated', receiver_address: 'simulated', amount_sats: 100000, events_trace: [] });
function fixture() {
  const create = new Subject<any>(), advance = new Subject<any>(), network = new Subject<string>();
  const api = { createPlaygroundSession$: vi.fn(() => create), advancePlaygroundSession$: vi.fn(() => advance) };
  const page = new PayjoinPlaygroundComponent(api as any, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef, { networkChanged$: network } as any);
  return { page, create, advance, network, api };
}
describe('Payjoin narrated simulation lifecycle', () => {
  it('retains the prior session after failure and lets the same step retry', () => {
    const f = fixture(); f.page.session = session(); f.page.advanceSession();
    f.advance.error(new Error('unavailable'));
    expect(f.page.session).toEqual(session()); expect(f.page.advancing).toBe(false); expect(f.page.errorMessage).toContain('Could not advance');
    const retry = new Subject<any>(); f.api.advancePlaygroundSession$.mockReturnValue(retry);
    f.page.advanceSession(); retry.next(session('proposal_generated'));
    expect(f.page.session?.step).toBe('proposal_generated'); expect(f.page.errorMessage).toBeNull(); f.page.ngOnDestroy();
  });
  it('reset and network change cancel pending work without restoring stale sessions', () => {
    const f = fixture(); f.page.startSession(); expect(f.create.observed).toBe(true);
    f.page.resetSession(); expect(f.create.observed).toBe(false); f.create.next(session()); expect(f.page.session).toBeNull();
    f.page.session = session(); f.page.advanceSession(); f.network.next('signet'); expect(f.advance.observed).toBe(false);
    f.advance.next(session('proposal_generated')); expect(f.page.session).toBeNull(); expect(f.page.advancing).toBe(false); f.page.ngOnDestroy();
  });
  it('destroy cancels pending work and duplicate start does not create another session', () => {
    const f = fixture(); f.page.startSession(); f.page.startSession(); expect(f.api.createPlaygroundSession$).toHaveBeenCalledTimes(1);
    f.page.ngOnDestroy(); expect(f.create.observed).toBe(false); expect(f.network.observed).toBe(false);
  });
  it('rejects a claimed transaction or foreign session and preserves the last valid simulation', () => {
    const f = fixture(); f.page.session = session(); f.page.advanceSession(); f.advance.next({ ...session('proposal_generated'), session_id: 'foreign', simulated: false, payjoin_txid: 'invented' });
    expect(f.page.session).toEqual(session()); expect(f.page.errorMessage).toContain('unsupported'); f.page.ngOnDestroy();
  });
  it('renders the offered real capability as unavailable with wallet prerequisites and a retryable error', async () => {
    const html = await renderApplication(async context => {
      const app = await bootstrapApplication(PayjoinPlaygroundComponent, { providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: PayjoinApiService, useValue: {} }, { provide: StateService, useValue: { networkChanged$: new Subject<string>(), network: '', env: { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool' } } }] }, context);
      app.components[0].instance.session = session('proposal_generated');
      app.components[0].instance.errorMessage = 'Could not advance this simulation session.';
      app.components[0].changeDetectorRef.detectChanges(); return app;
    }, { document: '<html><body><app-payjoin-playground></app-payjoin-playground></body></html>', url: 'http://localhost/', allowedHosts: ['localhost'] });
    expect(html).toContain('connected signing wallet'); expect(html).toContain('Sign &amp; Broadcast Payjoin: unavailable'); expect(html).toContain('Explain Signing &amp; Broadcast'); expect(html).toContain('role="alert"'); expect(html).toContain('Retry the current step');
    expect(html).not.toContain('Safe Signet/Regtest Sandbox');
  });
});
