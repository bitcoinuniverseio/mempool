import { Application, Request, Response } from 'express';
import taprootAssetsRoutes from './taproot-assets.routes';
import { TaprootAssetsEvidenceError, taprootAssetsService } from './taproot-assets.service';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: a Tether asset with an invented anchor, an offer that was valid
 * because the constant said so, and a quote whose spread was positive by
 * construction. Passing those proved the constants were present, not that
 * any asset, offer or quote had been observed.
 */
describe('TaprootAssetsService', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing asset Universe rather than a directory of invented assets', async () => {
    await expect(taprootAssetsService.$getAssets()).rejects.toThrow(unavailable('unavailable-universe'));
    await expect(taprootAssetsService.$getGroups()).rejects.toThrow(unavailable('unavailable-universe'));
    await expect(taprootAssetsService.$getAsset('4a19b872019842fbc9e19842a98712344a19b872019842fbc9e19842a9871234'))
      .rejects.toThrow(unavailable('unavailable-universe'));
  });

  it('reports the missing offer source rather than an offer that claims to be valid', async () => {
    await expect(taprootAssetsService.$getOffers()).rejects.toThrow(unavailable('unavailable-offer-source'));
  });

  it('reports the missing RFQ source rather than a quote with a load-time expiry', async () => {
    await expect(taprootAssetsService.$getRfqQuotes()).rejects.toThrow(unavailable('unavailable-rfq-source'));
  });

  it('never resolves an absent source as an empty directory', async () => {
    for (const read of [
      () => taprootAssetsService.$getAssets(),
      () => taprootAssetsService.$getGroups(),
      () => taprootAssetsService.$getOffers(),
      () => taprootAssetsService.$getRfqQuotes(),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = await read();
      } catch (e) {
        expect(e).toBeInstanceOf(TaprootAssetsEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });
});

describe('Taproot Assets proof verification boundary', () => {
  it.each([
    ['not-an-asset', 'proof-data'],
    ['ab'.repeat(32), ''],
    ['ab'.repeat(32), ' '.repeat(30)],
    ['ab'.repeat(32), 'a'.repeat(1024 * 1024 + 1)],
  ])('rejects malformed or oversized inputs', async (assetId, proofData) => {
    await expect(taprootAssetsService.$verifyProof(assetId, proofData)).resolves.toMatchObject({ valid: false, stage: 'invalid-input' });
  });

  it.each(['long-enough-to-have-been-accepted-before', 'ab'.repeat(100), Buffer.from('not a Taproot Assets proof').toString('base64')])(
    'never verifies long or encoded junk without an actual proof engine', async (proofData) => {
      const result = await taprootAssetsService.$verifyProof('ab'.repeat(32), proofData);
      expect(result).toMatchObject({ valid: false, stage: 'unavailable-verifier' });
      expect(result).not.toHaveProperty('rootHash');
      expect(result).not.toHaveProperty('anchorBlockHeight');
    },
  );
});

describe('Taproot Assets HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; post: Handler } {
    const gets = new Map<string, Handler>();
    let post!: Handler;
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((_path: string, callback: Handler) => { post = callback; return app; }),
    };
    taprootAssetsRoutes.initRoutes(app as unknown as Application);
    return { gets, post };
  }

  it.each([
    [{}, 400, 'invalid-input'],
    [{ assetId: 'ab'.repeat(32), proofData: 'long-enough-to-have-been-accepted-before' }, 503, 'unavailable-verifier'],
  ])('never returns successful verification for missing or unverified proof data', async (body, status, stage) => {
    const { post } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await post({ body } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, stage }));
  });

  it('answers every observation read with a 503 that names the missing source', async () => {
    const { gets } = mount();
    expect(gets.size).toBe(5);
    for (const handler of gets.values()) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { assetId: 'ab'.repeat(32) } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toMatch(/^unavailable-/);
      expect(typeof body.error).toBe('string');
      expect(body).not.toHaveProperty('assets');
      expect(body).not.toHaveProperty('offers');
      expect(body).not.toHaveProperty('quotes');
    }
  });
});
