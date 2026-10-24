import { throwIfIndexingStopped } from '../api/indexing-stop';

// An indexer run that shutdown interrupts ends at the next item and skips the remaining steps.
const blocksState = {
  indexed: 0,
  release: undefined as undefined | (() => void),
  coinbase: jest.fn(async () => undefined),
};
jest.mock('../config', () => ({ __esModule: true, default: { MEMPOOL: { NETWORK: 'mainnet', ENABLED: true }, DATABASE: { ENABLED: true }, FIAT_PRICE: { ENABLED: false } } }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => true } }));
jest.mock('../api/mempool', () => ({ __esModule: true, default: { hasPriority: () => false } }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {
  getBlockchainInfo: async () => ({ blocks: 10, headers: 10 }),
  getIndexInfo: async () => ({}),
} }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: {
  /** Indexes one block per gate release, checking for shutdown between blocks like the real loop. */
  $generateBlockDatabase: async () => {
    for (let height = 0; height < 1000; height++) {
      throwIfIndexingStopped();
      await new Promise<void>(resolve => { blocksState.release = resolve; });
      blocksState.indexed++;
    }
    return true;
  },
  $indexCoinbaseAddresses: () => blocksState.coinbase(),
} }));
jest.mock('../api/mining/mining', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/PricesRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../replication/AuditReplication', () => ({ __esModule: true, default: {} }));
jest.mock('../replication/StatisticsReplication', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/AccelerationRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksRepository', () => ({ __esModule: true, default: {} }));

import indexer from '../indexer';
import logger from '../logger';

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('indexer stop during a running backfill', () => {
  it('drains at the next block, skips later steps and reports no failure', async () => {
    const err = jest.spyOn(logger, 'err').mockImplementation(() => undefined);
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const run = indexer.$run();
    await settle();
    blocksState.release!();
    await settle();
    blocksState.release!();
    await settle();
    expect(blocksState.indexed).toBe(2);
    indexer.stop();
    let drained = false;
    const drain = indexer.drain().then(() => { drained = true; });
    // The block already in flight completes; the loop then ends instead of continuing to 1000.
    blocksState.release!();
    await run;
    await drain;
    expect(drained).toBe(true);
    expect(blocksState.indexed).toBe(3);
    expect(blocksState.coinbase).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Indexing stopped for shutdown; the next run resumes from the missing items.');
    expect(jest.getTimerCount()).toBe(0);
  });
});
