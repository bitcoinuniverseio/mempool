import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '@angular/common/http';
import { StateService } from '@app/services/state.service';
import { throwError } from 'rxjs';
import { MultipartyApiService } from './multiparty.service';

describe('multiparty verifier contract', () => {
  it('calls the mounted public-session route with the actual browser form fields and preserves unavailable evidence', () => {
    const unavailable = { status: 503, error: { stage: 'unavailable-musig2-engine', verified: false } };
    const post = vi.fn(() => throwError(() => unavailable));
    const service = new MultipartyApiService({ post } as unknown as HttpClient,
      { isBrowser: true } as StateService);
    const failure = vi.fn();
    service.verifyMusig2Session$({ cosigners: ['first', 'second'], message_digest: 'digest' }).subscribe({ error: failure });
    expect(post).toHaveBeenCalledWith('/api/v1/intelligence/multiparty/public-sessions/verify', expect.objectContaining({
      participant_public_keys: ['first', 'second'], message_hash: 'digest',
    }));
    expect(failure).toHaveBeenCalledWith(unavailable);
  });
});
