import { Application, Request, Response } from 'express';
import verificationRoutes from './verification.routes';
import { VerificationEvidenceError, verificationService } from './verification.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: an SPV proof whose merkle root was a hash of the txid, a compact
 * filter that matched any nonempty script, a signature that was valid because
 * it was long enough, and two incidents with invented block hashes. Passing
 * those proved the constants were present, not that anything was verified.
 */
describe('VerificationService', () => {
  const txid = '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d';
  const blockHash = '000000000000000000019973b2778f08ad6d21e083302ff0833d17066921ebb';
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Bitcoin reader rather than an SPV proof with an invented root', () => {
    expect(() => verificationService.generateSpvProof(txid, blockHash, 860145)).toThrow(unavailable('unavailable-bitcoin-reader'));
    expect(() => verificationService.verifySpvProof({ txid, merkle_root: 'ab', hashes: ['cd'] } as never))
      .toThrow(unavailable('unavailable-bitcoin-reader'));
    expect(() => verificationService.queryCompactFilter(blockHash, ['0014751e76e8199196d454941c45d1b3a323f1433bd6']))
      .toThrow(unavailable('unavailable-bitcoin-reader'));
  });

  it('reports the missing signature verifier rather than a verdict based on signature length', () => {
    const long = 'A'.repeat(88);
    expect(() => verificationService.verifySignature('bc1q751e76e8199196d454941c45d1b3a323f1433bd6', 'msg', long, 'bip322_simple'))
      .toThrow(unavailable('unavailable-signature-verifier'));
    expect(() => verificationService.verifySignature('bc1q751e76e8199196d454941c45d1b3a323f1433bd6', 'msg', 'short'))
      .toThrow(unavailable('unavailable-signature-verifier'));
  });

  it('reports the missing incident ledger rather than a history of invented reorgs', () => {
    expect(() => verificationService.getIncidents()).toThrow(unavailable('unavailable-incident-ledger'));
    expect(() => verificationService.getIncidentById('inc-reorg-850122')).toThrow(unavailable('unavailable-incident-ledger'));
  });

  it('never resolves an absent source as an empty directory or an unverified verdict', () => {
    for (const read of [
      () => verificationService.getIncidents(),
      () => verificationService.getIncidentById('inc-reorg-850122'),
      () => verificationService.verifySpvProof({ txid, merkle_root: 'ab', hashes: [] } as never),
      () => verificationService.verifySignature('addr', 'msg', 'sig'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(VerificationEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Verification HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    verificationRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every incident read with a 503 that names the missing ledger', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(2);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { id: 'inc-1' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe('unavailable-incident-ledger');
      expect(body).not.toHaveProperty('incidents');
    }
  });

  it.each([
    ['/api/v1/intelligence/verification/spv-proof', { txid: 'ab'.repeat(32), block_hash: '00'.repeat(32) }, 'unavailable-bitcoin-reader'],
    ['/api/v1/intelligence/verification/verify-spv', { txid: 'ab'.repeat(32), merkle_root: 'cd', hashes: ['ef'] }, 'unavailable-bitcoin-reader'],
    ['/api/v1/intelligence/verification/compact-filter', { block_hash: '00'.repeat(32), scripts: ['0014ab'] }, 'unavailable-bitcoin-reader'],
    ['/api/v1/intelligence/verification/verify-signature', { address: 'bc1q', message: 'm', signature: 'A'.repeat(88) }, 'unavailable-signature-verifier'],
  ])('never returns a verdict from %s without its source', async (path, body, stage) => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await posts.get(path)!({ body } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('is_valid');
  });

  it('keeps a 400 for a request with no inputs to verify', async () => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await posts.get('/api/v1/intelligence/verification/verify-signature')!({ body: {} } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
