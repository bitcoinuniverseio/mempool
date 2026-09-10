import { Application, Request, Response } from 'express';
import compactFiltersRoutes from './compact-filters.routes';
import compactFiltersService, { CompactFiltersEvidenceError } from './compact-filters.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three peers at invented addresses, a checkpoint with an invented
 * filter header, a block filter that was returned for any hash "for demo
 * consistency", and a verification run whose conflict depended on whether a
 * provider name was in the request. Passing those proved the constants were
 * present, not that any peer or filter had been observed.
 */
describe('CompactFiltersService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing filter prober rather than a directory of invented peers', () => {
    expect(() => compactFiltersService.getOverview()).toThrow(unavailable('unavailable-filter-peers'));
    expect(() => compactFiltersService.listProviders()).toThrow(unavailable('unavailable-filter-peers'));
    expect(() => compactFiltersService.getProvider('filter-peer-us-east')).toThrow(unavailable('unavailable-filter-peers'));
    expect(() => compactFiltersService.getProviderHistory('filter-peer-us-east')).toThrow(unavailable('unavailable-filter-peers'));
  });

  it('reports the missing filter index rather than a filter for any block hash', () => {
    expect(() => compactFiltersService.getBlockFilter('00'.repeat(32))).toThrow(unavailable('unavailable-filter-index'));
    expect(() => compactFiltersService.listCheckpoints()).toThrow(unavailable('unavailable-filter-index'));
    expect(() => compactFiltersService.getRanges()).toThrow(unavailable('unavailable-filter-index'));
  });

  it('reports the missing prober rather than a verification run decided by provider names', () => {
    expect(() => compactFiltersService.createVerification({ start_height: 860000, end_height: 860100, providers: ['filter-peer-us-east'] }))
      .toThrow(unavailable('unavailable-filter-peers'));
    expect(() => compactFiltersService.getVerification('vrun-1')).toThrow(unavailable('unavailable-filter-peers'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => compactFiltersService.getOverview(),
      () => compactFiltersService.listProviders(),
      () => compactFiltersService.getProviderHistory('any'),
      () => compactFiltersService.listCheckpoints(),
      () => compactFiltersService.getRanges(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(CompactFiltersEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Compact filters HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
    };
    compactFiltersRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const { gets } = mount();
    expect(gets.size).toBe(8);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { providerId: 'peer', blockHash: '00'.repeat(32), verificationId: 'vrun' } } as unknown as Request,
        res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('providers');
      expect(body).not.toHaveProperty('filter_hash');
    }
  });

  it('answers a verification request with a 503 rather than a run that never queried a peer', () => {
    const { posts } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    posts.get('/api/v1/intelligence/compact-filters/verifications')!(
      { body: { start_height: 1, end_height: 2, providers: [] } } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-filter-peers' }));
  });
});
