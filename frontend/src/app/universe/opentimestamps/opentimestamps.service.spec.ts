import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { OpenTimestampsApiService } from './opentimestamps.service';

describe('OpenTimestamps verification API contract', () => {
  it('posts proof, optional digest and selected network to the mounted verifier without upgrading its verdict', () => {
    const pending = { status: 'pending_calendar_attestation', verified: false, digest_matches: null };
    const post = vi.fn(() => of(pending));
    const service = new OpenTimestampsApiService({ post } as unknown as HttpClient);
    const next = vi.fn(); const request = { proof: 'encoded-proof', digest: 'ab'.repeat(32), network: 'signet' as const };
    service.verifyProof$(request).subscribe(next);
    expect(post).toHaveBeenCalledWith('/api/v1/intelligence/timestamps/proofs/verify', request);
    expect(next).toHaveBeenCalledWith(pending);
  });

  it('preserves an unavailable verifier response', () => {
    const unavailable = { status: 503, error: { stage: 'unavailable-bitcoin-header', error: 'Owned reader unavailable' } };
    const service = new OpenTimestampsApiService({ post: () => throwError(() => unavailable) } as unknown as HttpClient);
    const error = vi.fn(); service.verifyProof$({ proof: 'encoded-proof' }).subscribe({ error });
    expect(error).toHaveBeenCalledWith(unavailable);
  });
});
