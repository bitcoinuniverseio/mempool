import { Application, Request, Response } from 'express';
import networkObservatoryRoutes from './network-observatory.routes';
import { NetworkObservatoryEvidenceError, networkObservatoryService } from './network-observatory.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: at least four nodes online, a propagation timeline whose
 * median latency was positive because the deltas were literals, and a
 * template comparison at a height above 800000. Passing those proved the
 * constants were present, not that any node had reported.
 */
describe('NetworkObservatoryService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing observer fleet rather than invented nodes, timelines and templates', async () => {
    await expect(networkObservatoryService.$getNodes()).rejects.toThrow(unavailable('unavailable-observer-fleet'));
    await expect(networkObservatoryService.$getPropagation()).rejects.toThrow(unavailable('unavailable-observer-fleet'));
    await expect(networkObservatoryService.$getPropagation('ab'.repeat(32))).rejects.toThrow(unavailable('unavailable-observer-fleet'));
    await expect(networkObservatoryService.$getTemplates()).rejects.toThrow(unavailable('unavailable-observer-fleet'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => networkObservatoryService.$getNodes(),
      () => networkObservatoryService.$getPropagation(),
      () => networkObservatoryService.$getTemplates(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(NetworkObservatoryEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Network observatory HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    networkObservatoryRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(4);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { txid: 'ab'.repeat(32) } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('nodes');
      expect(body).not.toHaveProperty('nodeObservations');
      expect(body).not.toHaveProperty('candidateTemplates');
    }
  });
});
