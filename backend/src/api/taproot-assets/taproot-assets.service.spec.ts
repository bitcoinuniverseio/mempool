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
