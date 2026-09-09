import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@angular/common/http';
import { ReplaySubject, of, throwError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { OpenTimestampsApiService } from './opentimestamps.service';

function state(network = ''): { state: StateService; networkChanged$: ReplaySubject<string>; select: (network: string) => void } {
  const networkChanged$ = new ReplaySubject<string>(1);
  const value = { network, networkChanged$, env: { ROOT_NETWORK: 'mainnet' } };
  networkChanged$.next(network);
  return { state: value as unknown as StateService, networkChanged$, select: (next: string) => { value.network = next; networkChanged$.next(next); } };
}

describe('OpenTimestamps verification API contract', () => {
  it('posts proof, optional digest and selected network to the mounted verifier without upgrading its verdict', () => {
    const pending = { status: 'pending_calendar_attestation', verified: false, digest_matches: null };
    const post = vi.fn(() => of(pending));
    const service = new OpenTimestampsApiService({ post } as unknown as HttpClient, state().state);
    const next = vi.fn(); const request = { proof: 'encoded-proof', digest: 'ab'.repeat(32), network: 'signet' as const };
    service.verifyProof$(request).subscribe(next);
    expect(post).toHaveBeenCalledWith('/api/v1/intelligence/timestamps/proofs/verify', request);
    expect(next).toHaveBeenCalledWith(pending);
  });

  it('preserves an unavailable verifier response', () => {
    const unavailable = { status: 503, error: { stage: 'unavailable-bitcoin-header', error: 'Owned reader unavailable' } };
    const service = new OpenTimestampsApiService({ post: () => throwError(() => unavailable) } as unknown as HttpClient, state().state);
    const error = vi.fn(); service.verifyProof$({ proof: 'encoded-proof' }).subscribe({ error });
    expect(error).toHaveBeenCalledWith(unavailable);
  });
});

describe('OpenTimestamps network context', () => {
  it('sends every read and write to the selected network prefix', () => {
    const get = vi.fn((url: string) => of(url.endsWith('/overview') ? { network: 'signet' } : { calendars: [], anchors: [] }));
    const post = vi.fn(() => of({ network: 'signet' }));
    const service = new OpenTimestampsApiService({ get, post } as unknown as HttpClient, state('signet').state);
    service.getOverview$().subscribe();
    service.getCalendars$().subscribe();
    service.getBatches$().subscribe();
    service.stampDigest$('ab'.repeat(32)).subscribe();
    service.verifyProof$({ proof: 'p', network: 'signet' }).subscribe();
    service.upgradeProof$({ ots_proof: 'p', digest: 'ab'.repeat(32) }).subscribe();
    expect(get.mock.calls.map(call => call[0])).toEqual([
      '/signet/api/v1/intelligence/timestamps/overview',
      '/signet/api/v1/intelligence/timestamps/calendars',
      '/signet/api/v1/intelligence/timestamps/anchors',
    ]);
    expect(post.mock.calls.map(call => call[0])).toEqual([
      '/signet/api/v1/intelligence/timestamps/digests/stamp',
      '/signet/api/v1/intelligence/timestamps/proofs/verify',
      '/signet/api/v1/intelligence/timestamps/proofs/upgrade',
    ]);
    expect(post.mock.calls[2][1]).toEqual({ ots_proof: 'p', digest: 'ab'.repeat(32), network: 'signet' });
  });

  it.each([['', ''], ['mainnet', ''], ['testnet', '/testnet'], ['testnet4', '/testnet4']])('maps the selected network %j to prefix %j', (network, prefix) => {
    const get = vi.fn(() => of({ calendars: [] }));
    new OpenTimestampsApiService({ get } as unknown as HttpClient, state(network).state).getCalendars$().subscribe();
    expect(get).toHaveBeenCalledWith(`${prefix}/api/v1/intelligence/timestamps/calendars`);
  });

  it('re-issues a read at a network switch and drops the previous network answer', () => {
    const answers = new Map<string, ReplaySubject<unknown>>();
    const get = vi.fn((url: string) => { const subject = new ReplaySubject<unknown>(1); answers.set(url, subject); return subject; });
    const context = state('');
    const service = new OpenTimestampsApiService({ get } as unknown as HttpClient, context.state);
    const next = vi.fn(); const error = vi.fn();
    service.getOverview$().subscribe({ next, error });
    context.select('signet');
    answers.get('/api/v1/intelligence/timestamps/overview')!.next({ network: 'mainnet', total_proofs_tracked: 9 });
    answers.get('/signet/api/v1/intelligence/timestamps/overview')!.next({ network: 'signet', total_proofs_tracked: 1 });
    expect(get.mock.calls.map(call => call[0])).toEqual(['/api/v1/intelligence/timestamps/overview', '/signet/api/v1/intelligence/timestamps/overview']);
    expect(next.mock.calls.map(call => call[0])).toEqual([{ network: 'signet', total_proofs_tracked: 1 }]);
    expect(error).not.toHaveBeenCalled();
  });

  it('rejects an answer whose network is not the one it was asked for', () => {
    const service = new OpenTimestampsApiService({ post: () => of({ record_id: 'r', network: 'mainnet' }) } as unknown as HttpClient, state('signet').state);
    const next = vi.fn(); const error = vi.fn();
    service.stampDigest$('ab'.repeat(32)).subscribe({ next, error });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(new Error('timestamp-network-mismatch'));
  });
});
