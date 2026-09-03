import { arkService } from './ark.service';

describe('ArkService', () => {
  it('returns registered Ark server providers', async () => {
    const operators = await arkService.$getOperators();
    expect(operators.length).toBeGreaterThan(0);
    expect(operators[0].aspPubkey).toBeDefined();
    expect(operators[0].status).toBe('online');
  });

  it('provides on-chain settlement batches with merkle roots', async () => {
    const batches = await arkService.$getBatches();
    expect(batches.length).toBeGreaterThan(0);
    expect(batches[0].anchorTxid).toHaveLength(64);
    expect(batches[0].status).toBe('settled');
  });

  it('tracks VTXO tree indices and timelocks', async () => {
    const vtxo = await arkService.$getVtxo('vtxo-78192a83918273918273918273918273');
    expect(vtxo).not.toBeNull();
    expect(vtxo?.status).toBe('spendable');
    expect(vtxo?.timelockExpiryBlocks).toBe(2016);
  });
});
