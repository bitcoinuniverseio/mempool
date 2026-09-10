import { Application, Request, Response } from 'express';
import l2ObservatoryRoutes from './l2-observatory.routes';
import { L2ObservatoryEvidenceError, l2ObservatoryService } from './l2-observatory.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a BitVM2 bridge with a 1-of-n trust model, a challenge with
 * an invented assertion txid, and a reserve audit whose ratio was 1.0000
 * because both sides of it were the same constant. Passing those proved the
 * constants were present, not that any bridge, challenge or reserve had been
 * observed.
 */
describe('L2ObservatoryService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing bridge watcher rather than invented bridges, challenges and reserves', async () => {
    await expect(l2ObservatoryService.$getSystems()).rejects.toThrow(unavailable('unavailable-bridge-watcher'));
    await expect(l2ObservatoryService.$getSystem('bitvm2-permissionless')).rejects.toThrow(unavailable('unavailable-bridge-watcher'));
    await expect(l2ObservatoryService.$getChallenges()).rejects.toThrow(unavailable('unavailable-bridge-watcher'));
    await expect(l2ObservatoryService.$getChallenges('citrea-clementine')).rejects.toThrow(unavailable('unavailable-bridge-watcher'));
    await expect(l2ObservatoryService.$getReserveAudit('citrea-clementine')).rejects.toThrow(unavailable('unavailable-bridge-watcher'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => l2ObservatoryService.$getSystems(),
      () => l2ObservatoryService.$getSystem('unknown'),
      () => l2ObservatoryService.$getChallenges(),
      () => l2ObservatoryService.$getReserveAudit('unknown'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(L2ObservatoryEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('L2 observatory HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    l2ObservatoryRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(4);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { systemId: 'citrea-clementine' }, query: {} } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('systems');
      expect(body).not.toHaveProperty('challenges');
      expect(body).not.toHaveProperty('reserveRatio');
    }
  });
});
