import { Application, Request, Response } from 'express';
import zcashPrivacyRoutes from './zcash-privacy.routes';
import { ZcashPrivacyEvidenceError, zcashPrivacyService } from './zcash-privacy.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: a tip above 2,000,000, five pools with exact balances no node
 * reported, and recent flows with invented block hashes. Passing those proved
 * the constants were present, not that any pool had been observed.
 */
describe('ZcashPrivacyService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing Zcash node rather than a summary with invented pool balances', async () => {
    await expect(zcashPrivacyService.$getSummary()).rejects.toThrow(unavailable('unavailable-zcash-node'));
    await expect(zcashPrivacyService.$getPools()).rejects.toThrow(unavailable('unavailable-zcash-node'));
  });

  it('still answers the network upgrade catalogue, which is protocol reference', async () => {
    const upgrades = await zcashPrivacyService.$getUpgrades();
    expect(upgrades.length).toBe(6);
    const nu5 = upgrades.find((u) => u.name === 'NU5');
    expect(nu5?.branchId).toBe('0xc2d6d0b4');
    expect(nu5?.activationHeight).toBe(1687104);
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => zcashPrivacyService.$getSummary(),
      () => zcashPrivacyService.$getPools(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(ZcashPrivacyEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Zcash privacy HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
    };
    zcashPrivacyRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers the observation reads with a 503 that names the missing node and the catalogue with a 200', async () => {
    const gets = mount();
    expect(gets.size).toBe(3);
    for (const [path, handler] of gets) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({} as Request, res as unknown as Response);
      if (path.endsWith('upgrades')) {
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 6 }));
        continue;
      }
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe('unavailable-zcash-node');
      expect(body).not.toHaveProperty('pools');
    }
  });
});
