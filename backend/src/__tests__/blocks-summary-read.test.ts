// A block summary the caches no longer hold is read from Core in one request.
const api = { $getTxsForBlock: jest.fn(), $getTxsForBlockWithoutPrevouts: jest.fn(), $getBlock: jest.fn() };
const commonState = { liquid: false };
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: api, bitcoinCoreApi: {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-second-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: {} }));
jest.mock('../api/common', () => ({ Common: { isLiquid: () => commonState.liquid, blocksSummariesIndexingEnabled: () => false } }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: { extendTransaction: (tx: any) => tx } }));
jest.mock('../api/disk-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: {} }));
jest.mock('../api/websocket-handler', () => ({ __esModule: true, default: {} }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/chain-tips', () => ({ __esModule: true, default: { getOrphanedBlock: () => undefined } }));
jest.mock('../api/cpfp', () => ({ calculateFastBlockCpfp: jest.fn(), calculateGoodBlockCpfp: jest.fn() }));
jest.mock('../api/difficulty-adjustment', () => ({ calcBitsDifference: jest.fn() }));
jest.mock('../api/mining/mining', () => ({ __esModule: true, default: {} }));
jest.mock('../api/pools-parser', () => ({ __esModule: true, default: {} }));
jest.mock('../api/services/acceleration', () => ({ __esModule: true, default: {} }));
jest.mock('../indexer', () => ({ __esModule: true, default: {} }));
jest.mock('../database', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../utils/bitcoin-script', () => ({ parseDATUMTemplateCreator: jest.fn() }));
jest.mock('../utils/file-read', () => ({ getBlockFirstSeenFromLogs: jest.fn(), getOldestLogTimestampFromLogs: jest.fn(), scanLogsForBlocksFirstSeen: jest.fn() }));
for (const repo of ['Pools', 'Blocks', 'Hashrates', 'BlocksSummaries', 'BlocksAudits', 'Cpfp', 'DifficultyAdjustments', 'Prices', 'Acceleration']) {
  jest.mock(`../repositories/${repo}Repository`, () => ({ __esModule: true, default: {} }));
}

import blocks from '../api/blocks';

const hash = '000000000000000000003d83ef1fd499745adb6fe3f8c6d4f30d1901e79840be';
const transactions = [{ txid: 'a'.repeat(64) }, { txid: 'b'.repeat(64) }];

describe('block summary read for a block outside the caches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonState.liquid = false;
    blocks.setBlockSummaries([]);
    api.$getBlock.mockResolvedValue({ id: hash, height: 970914 });
    jest.spyOn(blocks, 'summarizeBlockTransactions').mockImplementation((id, _height, txs) => ({ id, transactions: txs as any }));
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads the block once instead of every input prevout', async () => {
    api.$getTxsForBlockWithoutPrevouts.mockResolvedValue(transactions);
    expect(await blocks.$getStrippedBlockTransactions(hash)).toEqual(transactions);
    expect(api.$getTxsForBlockWithoutPrevouts).toHaveBeenCalledWith(hash);
    expect(api.$getTxsForBlock).not.toHaveBeenCalled();
  });

  it('falls back to prevout reads when the one-request read fails', async () => {
    api.$getTxsForBlockWithoutPrevouts.mockRejectedValue(new Error('not an active-chain block'));
    api.$getTxsForBlock.mockResolvedValue(transactions);
    expect(await blocks.$getStrippedBlockTransactions(hash)).toEqual(transactions);
    expect(api.$getTxsForBlock).toHaveBeenCalledWith(hash, true);
  });

  it('keeps the prevout read on Liquid', async () => {
    commonState.liquid = true;
    api.$getTxsForBlock.mockResolvedValue(transactions);
    await blocks.$getStrippedBlockTransactions(hash);
    expect(api.$getTxsForBlockWithoutPrevouts).not.toHaveBeenCalled();
  });
});
