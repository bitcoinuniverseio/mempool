// Shutdown ends the long indexing loops between items instead of after the whole backfill.
const api = { $getBlockHash: jest.fn(), $getTxsForBlock: jest.fn() };
const repositories = {
  Blocks: { $getCPFPUnindexedBlocks: jest.fn() },
  BlocksSummaries: { $getSummariesBelowVersion: jest.fn(), $getTemplatesBelowVersion: jest.fn(), $saveTransactions: jest.fn() },
};
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: api, bitcoinCoreApi: {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-second-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-api', () => ({ __esModule: true, default: {} }));
jest.mock('../api/common', () => ({ Common: {
  isLiquid: () => false, cpfpIndexingEnabled: () => true, gogglesIndexingEnabled: () => true, sleep$: async () => undefined,
} }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: { extendMempoolTransaction: (tx: any) => tx } }));
jest.mock('../api/disk-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/loading-indicators', () => ({ __esModule: true, default: { setProgress: () => undefined } }));
jest.mock('../api/websocket-handler', () => ({ __esModule: true, default: {} }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/chain-tips', () => ({ __esModule: true, default: {} }));
jest.mock('../api/cpfp', () => ({ calculateFastBlockCpfp: jest.fn(), calculateGoodBlockCpfp: () => ({ transactions: [], clusters: [] }) }));
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
  jest.mock(`../repositories/${repo}Repository`, () => ({ __esModule: true, default: repositories[repo] ?? {} }));
}

import logger from '../logger';

/** A fresh blocks singleton and stop flag; the flag is process-wide by design. */
function fresh(): { blocks: any; stop: typeof import('../api/indexing-stop'); config: any } {
  let blocks: any;
  let config: any;
  let stop!: typeof import('../api/indexing-stop');
  jest.isolateModules(() => {
    blocks = require('../api/blocks').default;
    stop = require('../api/indexing-stop');
    config = require('../config').default;
  });
  return { blocks, stop, config };
}

describe('indexing loops at shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'err').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('ends a CPFP backfill at the next block without reporting a failure', async () => {
    const { blocks, stop } = fresh();
    repositories.Blocks.$getCPFPUnindexedBlocks.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => i));
    api.$getBlockHash.mockImplementation(async (height: number) => 'hash-' + height);
    const indexed: number[] = [];
    jest.spyOn(blocks, '$indexCPFP').mockImplementation(async (...args: unknown[]) => {
      indexed.push(args[1] as number);
      if (indexed.length === 3) stop.requestIndexingStop();
    });
    await expect(blocks.$generateCPFPDatabase()).rejects.toBeInstanceOf(stop.IndexingStopped);
    expect(indexed).toEqual([0, 1, 2]);
    expect(logger.err).not.toHaveBeenCalled();
  });

  it('ends block classification even though each height swallows its own errors', async () => {
    const { blocks, stop, config } = fresh();
    config.MEMPOOL.BACKEND = 'esplora';
    jest.spyOn(blocks, 'getCurrentBlockHeight').mockReturnValue(900_000);
    const unclassified = Array.from({ length: 50 }, (_, i) => ({ height: 900_000 - i, id: 'block-' + i, version: 0 }));
    repositories.BlocksSummaries.$getSummariesBelowVersion.mockResolvedValue(unclassified);
    repositories.BlocksSummaries.$getTemplatesBelowVersion.mockResolvedValue([]);
    api.$getTxsForBlock.mockResolvedValue([]);
    jest.spyOn(blocks, 'summarizeBlockTransactions').mockReturnValue({ transactions: [] });
    let saved = 0;
    repositories.BlocksSummaries.$saveTransactions.mockImplementation(async () => {
      if (++saved === 2) stop.requestIndexingStop();
    });
    await expect(blocks.$classifyBlocks()).rejects.toBeInstanceOf(stop.IndexingStopped);
    expect(saved).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
