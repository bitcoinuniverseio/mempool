import { ChangeDetectorRef, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { renderApplication } from '@angular/platform-server';
import { provideRouter } from '@angular/router';
import { Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { StateService } from '@app/services/state.service';
import { PayjoinAnalyzeComponent } from './payjoin-analyze.component';
import { PayjoinApiService } from './payjoin.service';

describe('payjoin comparison evidence lifecycle', () => {
  it('clears pending evidence on edits and network changes', () => {
    const pending = new Subject<any>(), network = new Subject<string>();
    const api = { analyzeProposal$: vi.fn(() => pending) };
    const page = new PayjoinAnalyzeComponent(api as any, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef, { networkChanged$: network } as any);
    page.originalPsbt = 'original'; page.proposalPsbt = 'proposal'; page.analyze(); page.edited(); pending.next({ is_valid: true }); expect(page.result).toBeNull();
    page.analyze(); network.next('signet'); pending.next({ is_valid: true }); expect(page.result).toBeNull(); expect(page.analyzing).toBe(false); page.ngOnDestroy();
  });
  it('sends explicit output and fee limits and uses the selected network', () => {
    const network = new Subject<string>(), http = { post: vi.fn(() => new Subject<any>()) };
    const state = { isBrowser: true, network: 'signet', env: { ROOT_NETWORK: 'mainnet' }, networkChanged$: network };
    const api = new PayjoinApiService(http as any, state as any);
    const page = new PayjoinAnalyzeComponent(api, { markForCheck: vi.fn() } as unknown as ChangeDetectorRef, state as any);
    page.originalPsbt = 'original'; page.proposalPsbt = 'proposal'; page.paymentIndex = 0; page.feeIndex = 1; page.feeLimit = 200; page.analyze();
    expect(http.post.mock.calls[0][0]).toBe('/signet/api/v1/intelligence/payments/payjoin/analyze');
    expect(http.post.mock.calls[0][1]).toMatchObject({ payment_output_index: 0, disable_output_substitution: true, additional_fee_output_index: 1, max_additional_fee_contribution: 200 });
    page.ngOnDestroy();
  });
  it('renders a failed result without the former unconditional verified heading', async () => {
    const html = await renderApplication(async context => {
      const app = await bootstrapApplication(PayjoinAnalyzeComponent, { providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: PayjoinApiService, useValue: {} }, { provide: StateService, useValue: { networkChanged$: new Subject<string>(), network: '', env: { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool' } } }] }, context);
      app.components[0].instance.result = { is_valid: false, protocol_version: 'BIP78', verification_scope: 'Comparison only', heuristics_broken: [], inputs_added_by_receiver: 1, receiver_contributed_sats: null, fee_delta_sats: null, effective_feerate_sats_vb: null, validation_messages: ['Sender output decreased.'] };
      app.components[0].changeDetectorRef.detectChanges(); return app;
    }, { document: '<html><body><app-payjoin-analyze></app-payjoin-analyze></body></html>', url: 'http://localhost/', allowedHosts: ['localhost'] });
    expect(html).toContain('Proposal checks failed'); expect(html).not.toContain('Proposal Verified'); expect(html).toContain('Sender output decreased.');
  });
});
