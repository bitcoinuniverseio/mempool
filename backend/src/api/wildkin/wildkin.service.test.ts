import { Application, Request, Response } from 'express';
import wildkinRoutes from './wildkin.routes';
import { WildkinEvidenceError, wildkinService } from './wildkin.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a status whose creature count was the length of a constant
 * array, a braid whose heir and parents were three invented creature IDs, and
 * a creature with a binding UTXO nobody had looked up. Passing those proved
 * the constants were present, not that any inscription had been observed.
 */
describe('WildkinService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Wildkin indexer rather than invented creatures and braids', async () => {
    await expect(wildkinService.$getStatus()).rejects.toThrow(unavailable('unavailable-wildkin-indexer'));
    await expect(wildkinService.$getCreatures()).rejects.toThrow(unavailable('unavailable-wildkin-indexer'));
    await expect(wildkinService.$getCreature('wk-cr-001')).rejects.toThrow(unavailable('unavailable-wildkin-indexer'));
    await expect(wildkinService.$getBraids()).rejects.toThrow(unavailable('unavailable-wildkin-indexer'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => wildkinService.$getStatus(),
      () => wildkinService.$getCreatures(),
      () => wildkinService.$getCreature('unknown'),
      () => wildkinService.$getBraids(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(WildkinEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Wildkin HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    wildkinRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(4);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { id: 'wk-cr-001' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('creatures');
      expect(body).not.toHaveProperty('braids');
      expect(body).not.toHaveProperty('latestCreatures');
    }
  });
});
