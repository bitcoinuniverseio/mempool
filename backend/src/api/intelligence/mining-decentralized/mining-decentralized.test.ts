import { Application, Request, Response } from 'express';
import decentralizedMiningRoutes from './mining-decentralized.routes';
import decentralizedMiningService, { DecentralizedMiningEvidenceError } from './mining-decentralized.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: three sources on invented hosts, a Braidpool share with two
 * parents, a payout verified on chain because the constant said so, and a
 * template comparison whose similarity was above 0.9 by construction. Passing
 * those proved the constants were present, not that any share had been observed.
 */
describe('DecentralizedMiningService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('still answers the protocol catalogue, which is reference material', () => {
    const ids = decentralizedMiningService.listProtocols().map((p) => p.protocol_id);
    expect(ids).toEqual(['datum_gateway', 'p2pool_v2', 'braidpool']);
  });

  it('reports the missing share feeds rather than invented sources, shares and templates', () => {
    expect(() => decentralizedMiningService.getOverview()).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.listSources()).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.listShares()).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.getShare('share-datum-860500-001')).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.listTemplates()).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.getTemplate('tmpl-datum-860500')).toThrow(unavailable('unavailable-share-source'));
    expect(() => decentralizedMiningService.compareTemplates()).toThrow(unavailable('unavailable-share-source'));
  });

  it('reports the missing payout source rather than a payout that claims to be verified on chain', () => {
    expect(() => decentralizedMiningService.listPayouts()).toThrow(unavailable('unavailable-payout-source'));
  });

  it('never resolves an absent source as an empty directory', () => {
    for (const read of [
      () => decentralizedMiningService.listSources(),
      () => decentralizedMiningService.listShares(),
      () => decentralizedMiningService.listTemplates(),
      () => decentralizedMiningService.listPayouts(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(DecentralizedMiningEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Decentralized mining HTTP responses', () => {
  type Handler = (req: Request, res: Response) => void;

  function mount(): Map<string, Handler> {
    const gets = new Map<string, Handler>();
    const app = { get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }) };
    decentralizedMiningRoutes.initRoutes(app as unknown as Application);
    return gets;
  }

  it('answers every observation read with a 503 that names the missing source', () => {
    const gets = mount();
    expect(gets.size).toBe(9);
    for (const [path, handler] of gets) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      handler({ params: { shareId: 's', templateId: 't' } } as unknown as Request, res as unknown as Response);
      if (path.endsWith('/protocols')) {
        expect(res.status).not.toHaveBeenCalled();
        continue;
      }
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('sources');
      expect(body).not.toHaveProperty('recent_shares');
    }
  });
});
