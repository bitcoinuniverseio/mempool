// Exercise the actual Blocks polling loop with bounded native API responses.
// External indexing side effects are stubbed; the hub and History are real.
const lockState = { locks: 0 };
jest.mock('../api/disk-cache', () => ({
  __esModule: true,
  default: {
    lock: jest.fn(() => { lockState.locks++; }),
    unlock: jest.fn(() => { lockState.locks = Math.max(0, lockState.locks - 1); }),
    $saveCacheToDisk: jest.fn(),
  },
}));
const tip = { $getBlockHeightTip: jest.fn(), $getBlockHash: jest.fn() };
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  __esModule: true,
  default: {},
  bitcoinCoreApi: tip,
}));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { getBlock: jest.fn() } }));
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
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import BitcoinApi from '../api/bitcoin/bitcoin-api';
import { calculateGoodBlockCpfp } from '../api/cpfp';
import chainTips from '../api/chain-tips';
import mempool from '../api/mempool';
import config from '../config';
const txid = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const originalNetwork = config.MEMPOOL.NETWORK;
const originalCache = config.MEMPOOL.CACHE_ENABLED;
describe('confirmed native fee conversion through Blocks polling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const state = blocks as any;
    state.canonicalChangeCallbacks = []; state.newBlockCallbacks = []; state.newAsyncBlockCallbacks = [];
    state.lastDifficultyAdjustmentTime = 1; state.quarterEpochBlockTime = 1;
    blocks.setBlocks([{ height: 1 } as any]); blocks.setBlockSummaries([]);
    tip.$getBlockHeightTip.mockResolvedValue(2); tip.$getBlockHash.mockResolvedValue(hash);
    jest.spyOn(state, 'updateQuarterEpochBlockTime').mockResolvedValue(undefined);
    jest.spyOn(state, '$getBlockExtended').mockImplementation(async (block: any) => block);
    jest.spyOn(state, 'summarizeBlockTransactions').mockReturnValue({ transactions: [] });
    (chainTips as any).updateOrphanedBlocks = jest.fn();
    (mempool as any).getAccelerations = jest.fn(() => ({}));
    config.MEMPOOL.CACHE_ENABLED = false;
    config.MEMPOOL.NETWORK = 'signet';
    (BitcoinApi.convertBlock as jest.Mock).mockReturnValue({ id: hash, height: 2, timestamp: 1000 });
    (calculateGoodBlockCpfp as jest.Mock).mockImplementation((_height, transactions) => ({ transactions }));
  });
  afterEach(() => { jest.restoreAllMocks(); config.MEMPOOL.NETWORK = originalNetwork; config.MEMPOOL.CACHE_ENABLED = originalCache; });
  it.each([[0.00001, 1000], [0.0000029, 290], [0.00000001, 1]])('delivers native fee %s as exactly %s satoshis to the block callback', async (fee, expected) => {
    const transaction = { txid, fee: undefined, weight: 437 } as any;
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: [{ txid, fee }] });
    jest.spyOn(blocks as any, '$getTransactionsExtended').mockResolvedValue([transaction]);
    const observed: number[] = [];
    blocks.setNewAsyncBlockCallback(async (_block, _ids, transactions) => { observed.push(transactions[0].fee); });
    expect(await blocks.$updateBlocks()).toBe(1);
    expect(observed).toEqual([expected]);
    expect(Number.isSafeInteger(observed[0])).toBe(true);
  });
  it.each([[undefined, undefined, 0], [0, undefined, 0], [0.00001, 123, 123]])('preserves missing coinbase fees, exact zero and existing satoshi fees', async (fee, cached, expected) => {
    const transaction = { txid, fee: cached, weight: 437 } as any;
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: [{ txid, fee }] });
    jest.spyOn(blocks as any, '$getTransactionsExtended').mockResolvedValue([transaction]);
    const callback = jest.fn(async () => undefined); blocks.setNewAsyncBlockCallback(callback);
    await blocks.$updateBlocks();
    expect(transaction.fee).toBe(expected); expect(callback).toHaveBeenCalledTimes(1);
  });
  it('rejects a fractional satoshi at the Bitcoin source boundary before callbacks', async () => {
    (bitcoinClient.getBlock as jest.Mock).mockResolvedValue({ tx: [{ txid, fee: 0.000000001 }] });
    jest.spyOn(blocks as any, '$getTransactionsExtended').mockResolvedValue([{ txid }]);
    const callback = jest.fn(); blocks.setNewAsyncBlockCallback(callback);
    await expect(blocks.$updateBlocks()).rejects.toThrow('Fractional satoshis');
    expect(callback).not.toHaveBeenCalled(); expect(lockState.locks).toBe(0);
  });
});
