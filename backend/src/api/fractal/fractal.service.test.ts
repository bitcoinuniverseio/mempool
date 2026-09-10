import { Application, Request, Response } from 'express';
import fractalRoutes from './fractal.routes';
import { FractalEvidenceError, fractalService } from './fractal.service';

/**
 * These assertions replace a suite that asserted the constants the service
 * used to return: a fixed tip height, a block invented for whatever height was
 * asked, a CAT-20 transfer decoded from the last two characters of a txid, and
 * a holder table with percentages no indexer had computed. Passing those
 * proved the constants were present, not that any block, transaction or token
 * had been observed.
 */
describe('FractalService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Fractal node rather than an invented chain state', async () => {
    await expect(fractalService.$getTip()).rejects.toThrow(unavailable('unavailable-fractal-node'));
    await expect(fractalService.$getMempool()).rejects.toThrow(unavailable('unavailable-fractal-node'));
    await expect(fractalService.$getBlock('482910')).rejects.toThrow(unavailable('unavailable-fractal-node'));
    await expect(fractalService.$getTransaction('e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f'))
      .rejects.toThrow(unavailable('unavailable-fractal-node'));
  });

  it('reports the missing CAT-20 indexer rather than a directory of invented tokens', async () => {
    await expect(fractalService.$getCat20Tokens()).rejects.toThrow(unavailable('unavailable-cat20-indexer'));
    await expect(fractalService.$getCat20Token('FCAT')).rejects.toThrow(unavailable('unavailable-cat20-indexer'));
    await expect(fractalService.$getCat20Holders('45322080f954c25603d665b10cdbcf07010e000d'))
      .rejects.toThrow(unavailable('unavailable-cat20-indexer'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => fractalService.$getTip(),
      () => fractalService.$getMempool(),
      () => fractalService.$getBlock('0'),
      () => fractalService.$getTransaction('ab'.repeat(32)),
      () => fractalService.$getCat20Tokens(),
      () => fractalService.$getCat20Token('unknown'),
      () => fractalService.$getCat20Holders('unknown'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(FractalEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Fractal HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    fractalRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every read with a 503 that names the missing source', async () => {
    const gets = mount();
    expect(gets.size).toBe(7);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { hash: '482910', txid: 'ab'.repeat(32), tokenId: 'FCAT' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('tokens');
      expect(body).not.toHaveProperty('holders');
      expect(body).not.toHaveProperty('height');
    }
  });
});
