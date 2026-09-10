import { Application, Request, Response } from 'express';
import liquidObservatoryRoutes from './liquid-observatory.routes';
import { LiquidObservatoryEvidenceError, liquidObservatoryService } from './liquid-observatory.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a reserve of exactly 384219400000 sats, a federation of 15
 * signers with an 11 threshold, and an asset registry that contained L-BTC
 * because the constant said so. Passing those proved the constants were
 * present, not that any peg, signer or asset had been observed.
 */
describe('LiquidObservatoryService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Elements node rather than an invented federation and peg history', async () => {
    await expect(liquidObservatoryService.$getSummary()).rejects.toThrow(unavailable('unavailable-elements-node'));
    await expect(liquidObservatoryService.$getPegs()).rejects.toThrow(unavailable('unavailable-elements-node'));
    await expect(liquidObservatoryService.$getFederation()).rejects.toThrow(unavailable('unavailable-elements-node'));
  });

  it('reports the missing asset registry rather than a directory of invented assets', async () => {
    await expect(liquidObservatoryService.$getAssets()).rejects.toThrow(unavailable('unavailable-asset-registry'));
    await expect(liquidObservatoryService.$getAsset('L-BTC')).rejects.toThrow(unavailable('unavailable-asset-registry'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => liquidObservatoryService.$getSummary(),
      () => liquidObservatoryService.$getAssets(),
      () => liquidObservatoryService.$getAsset('unknown'),
      () => liquidObservatoryService.$getPegs(),
      () => liquidObservatoryService.$getFederation(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(LiquidObservatoryEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Liquid observatory HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    liquidObservatoryRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(5);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { assetId: 'L-BTC' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('assets');
      expect(body).not.toHaveProperty('pegs');
      expect(body).not.toHaveProperty('recentPegs');
    }
  });
});
