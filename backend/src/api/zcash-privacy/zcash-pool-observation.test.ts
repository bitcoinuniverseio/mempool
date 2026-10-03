import { observeZcashPools } from './zcash-pool-observation';
import { ZCASH_GENESIS } from './zcash-owned-reader';
const tip = 'a'.repeat(64);
function fixture(mutate?: (info: any, count: number) => void) {
  let count = 0;
  const call = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockhash') return params[0] === 0 ? ZCASH_GENESIS.testnet : tip;
    const info = {chain: 'test', blocks: 280000, bestblockhash: tip, consensus: {chaintip: '76b809bb', nextblock: '76b809bb'}, chainSupply: {chainValueZat: 100000003}, valuePools: ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'].map((id, index) => ({id, chainValueZat: index === 0 ? 100000000 : index === 3 ? 3 : 0, monitored: index === 0 || index === 3}))};
    mutate?.(info, ++count); return info;
  });
  return {implementation: 'zebra' as const, ready: jest.fn().mockResolvedValue(true), call};
}
describe('checkpoint-bound Zcash node pool accounting', () => {
  it('retains exact atomic values, Ironwood zero, and unknown history instead of fabricated circulation', async () => {
    const result = await observeZcashPools(fixture(), 'testnet');
    expect(result.nodeAccountedSupplyZec).toBe('1.00000003');
    expect(result.totalShieldedSupplyZat).toBe('3');
    expect(result.pools.find(pool => pool.id === 'orchard')?.balanceZec).toBe('0.00000003');
    expect(result.pools.find(pool => pool.id === 'ironwood')).toMatchObject({balanceZat: '0', monitored: false, txCount: null});
    expect(result).toMatchObject({totalCirculatingSupplyZat: null, recentFlows: null, historyStatus: 'unavailable', source: {genesis: ZCASH_GENESIS.testnet, tipHash: tip}});
  });
  it.each(['duplicate', 'missing', 'unsafe', 'sum', 'branch', 'network'])('rejects malformed source %s', async mutation => {
    const reader = fixture(info => {
      if (mutation === 'duplicate') info.valuePools[5].id = 'sprout';
      if (mutation === 'missing') info.valuePools.splice(5, 1);
      if (mutation === 'unsafe') info.valuePools[0].chainValueZat = Number.MAX_SAFE_INTEGER + 1;
      if (mutation === 'sum') info.chainSupply.chainValueZat++;
      if (mutation === 'branch') info.consensus.chaintip = 'wrong';
      if (mutation === 'network') info.chain = 'main';
    });
    await expect(observeZcashPools(reader, 'testnet')).rejects.toThrow();
  });
  it('rejects changed accounting at the same purported checkpoint', async () => {
    await expect(observeZcashPools(fixture((info, count) => {if (count === 2) info.valuePools[0].chainValueZat++;}), 'testnet')).rejects.toMatchObject({code: 'source-changed', status: 409});
  });
  it('rejects a syncing source before any pool result or block lookup', async () => {
    const reader = fixture(); reader.ready.mockResolvedValue(false);
    await expect(observeZcashPools(reader, 'testnet')).rejects.toMatchObject({code: 'unavailable-checkpoint'});
    expect(reader.call).toHaveBeenCalledTimes(1);
  });
  it('bounds an unresponsive injected readiness provider and releases capacity', async () => {
    jest.useFakeTimers();
    try {
      const reader = fixture(); reader.ready.mockImplementation(() => new Promise(() => {}));
      const result = expect(observeZcashPools(reader, 'testnet')).rejects.toMatchObject({code: 'source-timeout'});
      await jest.advanceTimersByTimeAsync(15000); await result;
      await expect(observeZcashPools(fixture(), 'testnet')).resolves.toMatchObject({tipHeight: 280000});
    } finally {jest.useRealTimers();}
  });
});
