import { Application, Request, Response } from 'express';
import quantumRoutes from './quantum.routes';
import { QuantumEvidenceError, quantumService } from './quantum.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: five cohorts whose exposed share was positive by construction, a
 * known outpoint that was exposed because the constant said so, an audit that
 * classified any string starting with bc1p as exposed and invented a random
 * txid and a 100000-sat amount for it, and a migration plan whose total was
 * 500000 sats per outpoint. Passing those proved the constants were present,
 * not that any output had been observed.
 */
describe('QuantumService', () => {
  const unavailable = expect.objectContaining({ code: 'unavailable-exposure-index', status: 503 });

  it('reports the missing exposure index rather than invented cohorts and reveals', () => {
    expect(() => quantumService.getOverview()).toThrow(unavailable);
    expect(() => quantumService.getCohorts()).toThrow(unavailable);
    expect(() => quantumService.getRecentReveals()).toThrow(unavailable);
  });

  it('reports the missing exposure index for an audit instead of classifying by prefix', () => {
    expect(() => quantumService.auditAddressOrOutpoint('4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0')).toThrow(unavailable);
    expect(() => quantumService.auditAddressOrOutpoint('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0')).toThrow(unavailable);
    expect(() => quantumService.auditAddressOrOutpoint('')).toThrow(expect.objectContaining({ code: 'invalid-input', status: 400 }));
  });

  it('reports the missing exposure index for a migration plan instead of inventing amounts', () => {
    expect(() => quantumService.generateMigrationPlan({
      exposed_outpoints: ['4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b:0'],
      target_standard: 'p2wpkh',
    })).toThrow(unavailable);
    expect(() => quantumService.generateMigrationPlan({ exposed_outpoints: [], target_standard: 'p2wpkh' }))
      .toThrow(expect.objectContaining({ code: 'invalid-input', status: 400 }));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => quantumService.getCohorts(),
      () => quantumService.getRecentReveals(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(QuantumEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Quantum HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    quantumRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', async () => {
    const { gets, posts } = mount();
    expect(gets.size).toBe(3);
    expect(posts.size).toBe(2);
    const body = { identifier: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', exposed_outpoints: ['ab'.repeat(32) + ':0'] };
    for (const handler of [...gets.values(), ...posts.values()]) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ body } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const answer = res.json.mock.calls[0][0];
      expect(answer.stage).toBe('unavailable-exposure-index');
      expect(typeof answer.error).toBe('string');
      expect(answer).not.toHaveProperty('cohorts');
      expect(answer).not.toHaveProperty('is_exposed');
      expect(answer).not.toHaveProperty('steps');
    }
  });

  it('answers a malformed audit or plan request with a 400', async () => {
    const { posts } = mount();
    for (const handler of posts.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ body: {} } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].stage).toBe('invalid-input');
    }
  });
});
