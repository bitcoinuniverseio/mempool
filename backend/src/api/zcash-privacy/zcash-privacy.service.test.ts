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

  it('reports the missing Zcash node rather than a summary with invented pool balances', /** @asyncUnsafe */ async () => {
    await expect(zcashPrivacyService.$getSummary()).rejects.toThrow(unavailable('unavailable-zcash-node'));
    await expect(zcashPrivacyService.$getPools()).rejects.toThrow(unavailable('unavailable-zcash-node'));
  });

  it('still answers the network upgrade catalogue, which is protocol reference', /** @asyncUnsafe */ async () => {
    const upgrades = await zcashPrivacyService.$getUpgrades();
    expect(upgrades.length).toBe(11);
    const nu5 = upgrades.find((u) => u.name === 'NU5');
    expect(nu5?.branchId).toBe('0xc2d6d0b4');
    expect(nu5?.activationHeight).toBe(1687104);
  });

  it('never resolves an absent source as an empty directory', /** @asyncUnsafe */ async () => {
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

  it('answers the observation reads with a 503 that names the missing node and the catalogue with a 200', /** @asyncUnsafe */ async () => {
    const gets = mount();
    expect([...gets.keys()].map(path => path.split('/').pop()).sort()).toEqual(['blocks', 'history', 'pools', 'summary', 'upgrades']);
    for (const [path, handler] of gets) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
      const query = path.endsWith('history') ? { network: 'mainnet' } : {network:'mainnet',start:'415000',end:'415000'};
      await handler({query} as unknown as Request, res as unknown as Response);
      if (path.endsWith('upgrades')) {
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 11 }));
        continue;
      }
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe(path.endsWith('history') ? 'unavailable-pool-ledger' : 'unavailable-zcash-node');
      expect(body).not.toHaveProperty('pools');
    }
  });
  it('rejects arbitrary history query fields before source or persistence access', async () => {
    const gets = mount(); const history = [...gets].find(([path]) => path.endsWith('history'))![1];
    const source = jest.spyOn(zcashPrivacyService, '$getHistory');
    try {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
      await history({ query: { network: 'testnet', source: 'http://untrusted' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(400); expect(source).not.toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    } finally { source.mockRestore(); }
  });
});
