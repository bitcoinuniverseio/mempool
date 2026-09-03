import { fractalService } from './fractal.service';

describe('FractalService', () => {
  it('returns valid tip metadata for Fractal network', async () => {
    const tip = await fractalService.$getTip();
    expect(tip.network).toBe('fractal-mainnet');
    expect(tip.height).toBeGreaterThan(0);
    expect(tip.hash).toHaveLength(64);
  });

  it('returns block summary with exact metrics', async () => {
    const block = await fractalService.$getBlock('482910');
    expect(block).not.toBeNull();
    expect(block?.height).toBe(482910);
    expect(block?.txCount).toBeGreaterThan(0);
  });

  it('returns transaction details and decodes CAT-20 operations', async () => {
    const txid = 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f';
    const tx = await fractalService.$getTransaction(txid);
    expect(tx).not.toBeNull();
    expect(tx?.cat20Operations).toBeDefined();
    expect(tx?.cat20Operations?.length).toBe(1);
    expect(tx?.cat20Operations?.[0].valid).toBe(true);
  });

  it('lists CAT-20 tokens with exact integer supplies', async () => {
    const tokens = await fractalService.$getCat20Tokens();
    expect(tokens.length).toBeGreaterThan(0);
    const fcat = tokens.find((t) => t.symbol === 'FCAT');
    expect(fcat).toBeDefined();
    expect(fcat?.maxSupplyAtomic).toBe('2100000000');
  });

  it('retrieves token holders for a known token', async () => {
    const holders = await fractalService.$getCat20Holders('45322080f954c25603d665b10cdbcf07010e000d');
    expect(holders.length).toBeGreaterThan(0);
    expect(holders[0].percentage).toBe('10.00');
  });
});
