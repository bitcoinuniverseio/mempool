// Every module the two loops pull in is stubbed: this test is about the
// lifetime of the stall timer and the disk cache lock, not about blocks.
const lockState = { locks: 0 };
jest.mock('../api/disk-cache', () => ({
  __esModule: true,
  default: {
    lock: jest.fn(() => { lockState.locks++; }),
    unlock: jest.fn(() => { lockState.locks = Math.max(0, lockState.locks - 1); }),
    $saveCacheToDisk: jest.fn(),
  },
}));
const tip = { $getBlockHeightTip: jest.fn() };
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {},
  bitcoinCoreApi: tip,
}));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getBlockchainInfo: jest.fn(async () => ({ blocks: 1, headers: 2 })) } }));
jest.mock('../api/bitcoin/bitcoin-second-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: { convertBlock: jest.fn() } }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => false, blocksSummariesIndexingEnabled: () => false } }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: {} }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: {} }));
jest.mock('../api/websocket-handler', () => ({ __esModule: true, default: {} }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/chain-tips', () => ({ __esModule: true, default: {} }));
jest.mock('../api/cpfp', () => ({ calculateFastBlockCpfp: jest.fn(), calculateGoodBlockCpfp: jest.fn() }));
jest.mock('../api/difficulty-adjustment', () => ({ calcBitsDifference: jest.fn() }));
jest.mock('../api/mining/mining', () => ({ __esModule: true, default: {} }));
jest.mock('../api/pools-parser', () => ({ __esModule: true, default: {} }));
jest.mock('../api/services/acceleration', () => ({ __esModule: true, default: {} }));
jest.mock('../indexer', () => ({ __esModule: true, default: { reindex: jest.fn(), scheduleSingleTask: jest.fn() } }));
jest.mock('../database', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../utils/bitcoin-script', () => ({ parseDATUMTemplateCreator: jest.fn() }));
jest.mock('../utils/file-read', () => ({ getBlockFirstSeenFromLogs: jest.fn(), getOldestLogTimestampFromLogs: jest.fn(), scanLogsForBlocksFirstSeen: jest.fn() }));
for (const repo of ['Pools', 'Blocks', 'Hashrates', 'BlocksSummaries', 'BlocksAudits', 'Cpfp', 'DifficultyAdjustments', 'Prices', 'Acceleration']) {
  jest.mock(`../repositories/${repo}Repository`, () => ({ __esModule: true, default: {} }));
}

import blocks from '../api/blocks';

// testSetup.ts replaces the mempool module with an empty object for every
// test; this one needs the real loop, so load it explicitly and stop its
// per-second interval afterwards.
const memPool = jest.requireActual('../api/mempool').default;

describe('main loop stall timers and locks are released on every exit path', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    lockState.locks = 0;
    tip.$getBlockHeightTip.mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    memPool.destroy();
  });

  it('$updateBlocks: a rejected RPC call clears its timer and releases its lock', async () => {
    tip.$getBlockHeightTip.mockRejectedValue(new Error('Invalid params, response status code: 401'));
    await expect(blocks.$updateBlocks()).rejects.toThrow('401');
    expect(lockState.locks).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('$updateBlocks: five failed runs leave no accumulated timers or locks', async () => {
    tip.$getBlockHeightTip.mockRejectedValue(new Error('ETIMEDOUT'));
    for (let i = 0; i < 5; i++) {
      await expect(blocks.$updateBlocks()).rejects.toThrow('ETIMEDOUT');
    }
    expect(lockState.locks).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('$updateBlocks: a run that reaches the tip with nothing to do also cleans up', async () => {
    // With no cached blocks the loop fast forwards to the tip and processes nothing.
    tip.$getBlockHeightTip.mockResolvedValue(-1);
    await expect(blocks.$updateBlocks()).resolves.toBe(0);
    expect(lockState.locks).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('$updateMempool: a thrown error clears the stall timer', async () => {
    // A null accelerations map with a mempool delta of zero exercises the
    // early part of the run; a non-array transaction list makes it throw.
    await expect(memPool.$updateMempool(undefined as unknown as string[], null, [], 1, 2000)).rejects.toBeTruthy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
