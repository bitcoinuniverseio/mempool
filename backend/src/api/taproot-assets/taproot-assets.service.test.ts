import { Application, Request, Response } from 'express';
import taprootAssetsRoutes from './taproot-assets.routes';
import { taprootAssetsService } from './taproot-assets.service';

describe('TaprootAssetsService', () => {
  it('returns taproot assets list with exact integer amounts', async () => {
    const assets = await taprootAssetsService.$getAssets();
    expect(assets.length).toBeGreaterThan(0);
    const usdt = assets.find((a) => a.name.includes('Tether'));
    expect(usdt).toBeDefined();
    expect(usdt?.totalAmountAtomic).toBe('500000000000');
  });

  it('provides BOLT12 offer decodings and blind route counts', async () => {
    const offers = await taprootAssetsService.$getOffers();
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0].offerString.startsWith('lno1')).toBe(true);
    expect(offers[0].valid).toBe(true);
  });

  it('provides Lightning RFQ pricing spreads', async () => {
    const quotes = await taprootAssetsService.$getRfqQuotes();
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes[0].spreadBps).toBeGreaterThan(0);
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


describe('Taproot Assets proof HTTP responses', () => {
  it.each([
    [{}, 400, 'invalid-input'],
    [{ assetId: 'ab'.repeat(32), proofData: 'long-enough-to-have-been-accepted-before' }, 503, 'unavailable-verifier'],
  ])('never returns successful verification for missing or unverified proof data', async (body, status, stage) => {
    let handler: (req: Request, res: Response) => Promise<void>;
    const app = {
      get: jest.fn().mockReturnThis(),
      post: jest.fn((_path, callback) => { handler = callback; return app; }),
    };
    taprootAssetsRoutes.initRoutes(app as unknown as Application);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await handler!({ body } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ valid: false, stage }));
  });
});
