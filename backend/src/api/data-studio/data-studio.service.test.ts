import { Application, Request, Response } from 'express';
import dataStudioRoutes from './data-studio.routes';
import { DataStudioEvidenceError, dataStudioService } from './data-studio.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three dataset manifests with invented row counts, three stream
 * registrations for endpoints the backend never served, three MCP tools no
 * server exposed, and query rows that were the same three constants for every
 * request. Passing those proved the constants were present, not that any
 * dataset had been exported.
 */
describe('DataStudioService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing export service rather than a catalog of invented datasets', async () => {
    await expect(dataStudioService.$getCatalog()).rejects.toThrow(unavailable('unavailable-data-catalog'));
  });

  it('reports the missing query engine rather than constant rows', async () => {
    await expect(dataStudioService.$executeQuery({ datasetId: 'bitcoin.blocks', limit: 2 })).rejects.toThrow(unavailable('unavailable-query-engine'));
    await expect(dataStudioService.$executeQuery({ datasetId: 'invalid.dataset' })).rejects.toThrow(unavailable('unavailable-query-engine'));
  });

  it('never resolves an absent source as an empty catalog', async () => {
    for (const read of [
      () => dataStudioService.$getCatalog(),
      () => dataStudioService.$executeQuery({ datasetId: 'bitcoin.blocks' }),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(DataStudioEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Data Studio HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; post: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((_path: string, callback: Handler) => { post = callback; return app; }),
    };
    dataStudioRoutes.initRoutes(app as unknown as Application);
    return { gets, post };
  }

  it('answers every catalog read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(2);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({} as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe('unavailable-data-catalog');
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('datasets');
      expect(body).not.toHaveProperty('tools');
    }
  });

  it('keeps 400 for a missing dataset id and answers a query with a 503', async () => {
    const { post } = mount();
    const invalid = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body: {} } as Request, invalid as unknown as Response);
    expect(invalid.status).toHaveBeenCalledWith(400);

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body: { datasetId: 'bitcoin.blocks' } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-query-engine' }));
  });
});
