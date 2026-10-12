const hashPs = jest.fn();
const poolRow = { poolId: 1, name: 'Foundry USA', link: '', blockCount: 300, slug: 'foundryusa', avgMatchRate: null, avgFeeDelta: null, poolUniqueId: 111 };

jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'mainnet' }, DATABASE: { ENABLED: true } } }));
jest.mock('../logger', () => ({ __esModule: true, default: { debug: () => undefined, err: () => undefined, tags: { mining: 'Mining' } } }));
jest.mock('../database', () => ({ __esModule: true, default: {} }));
jest.mock('../api/common', () => ({ Common: {} }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getNetworkHashPs: (blocks: number) => hashPs(blocks) } }));
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/PoolsRepository', () => ({ __esModule: true, default: { $getPoolsInfo: async () => [poolRow] } }));
jest.mock('../repositories/BlocksRepository', () => ({
  __esModule: true,
  default: { $countEmptyBlocks: async () => [{ poolId: 1, count: 2 }], $blockCount: async () => 1008 },
}));
jest.mock('../repositories/HashratesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/DifficultyAdjustmentsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/PricesRepository', () => ({ __esModule: true, default: {} }));

import mining from '../api/mining/mining';

describe('pool ranking does not wait on a busy node', () => {
  afterEach(() => {
    jest.useRealTimers();
    hashPs.mockReset();
  });

  it('answers with the indexed ranking when the hashrate estimate never returns', /** @asyncUnsafe Jest owns the test. */ async () => {
    jest.useFakeTimers();
    hashPs.mockImplementation(() => new Promise(() => undefined));
    const pending = mining.$getPoolsStats('1w');
    await jest.advanceTimersByTimeAsync(5000);
    const stats = await pending as { pools: { slug: string; rank: number; emptyBlocks: number }[]; blockCount: number; lastEstimatedHashrate: number };
    expect(stats.pools).toEqual([expect.objectContaining({ slug: 'foundryusa', rank: 1, emptyBlocks: 2 })]);
    expect(stats.blockCount).toBe(1008);
    expect(stats.lastEstimatedHashrate).toBe(0);
    expect(hashPs).toHaveBeenCalledTimes(1);
  });

  it('keeps every estimate when the node answers in time', /** @asyncUnsafe Jest owns the test. */ async () => {
    hashPs.mockResolvedValue(7e20);
    const stats = await mining.$getPoolsStats('1w') as Record<string, number>;
    expect(stats.lastEstimatedHashrate).toBe(7e20);
    expect(stats.lastEstimatedHashrate3d).toBe(7e20);
    expect(stats.lastEstimatedHashrate1w).toBe(7e20);
  });
});
