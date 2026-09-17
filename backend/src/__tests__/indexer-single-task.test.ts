const configState = {
  MEMPOOL: { NETWORK: 'mainnet', INDEXING_BLOCKS_AMOUNT: -1, ENABLED: true },
  DATABASE: { ENABLED: true },
  FIAT_PRICE: { ENABLED: true },
};
const commonState = { indexingEnabled: true };
const miningState = {
  indexBlockPrices: jest.fn(async () => undefined),
  indexCoinStatsIndex: jest.fn(async () => undefined),
};
const pricesState = { latestPriceId: jest.fn(async (): Promise<number | null> => 7) };
const priceUpdaterState = { historyInserted: true };

jest.mock('../config', () => ({ __esModule: true, default: configState }));
jest.mock('../api/common', () => ({ Common: { indexingEnabled: () => commonState.indexingEnabled } }));
jest.mock('../api/mining/mining', () => ({
  __esModule: true,
  default: {
    $indexBlockPrices: () => miningState.indexBlockPrices(),
    $indexCoinStatsIndex: () => miningState.indexCoinStatsIndex(),
  },
}));
jest.mock('../repositories/PricesRepository', () => ({
  __esModule: true,
  default: { $getLatestPriceId: () => pricesState.latestPriceId() },
}));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: priceUpdaterState }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../replication/AuditReplication', () => ({ __esModule: true, default: {} }));
jest.mock('../replication/StatisticsReplication', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/AccelerationRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksAuditsRepository', () => ({ __esModule: true, default: {} }));
jest.mock('../repositories/BlocksRepository', () => ({ __esModule: true, default: {} }));

import indexer from '../indexer';

/** Lets every promise chain queued so far settle while timers are faked. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('indexer single tasks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    configState.MEMPOOL.NETWORK = 'mainnet';
    configState.FIAT_PRICE.ENABLED = true;
    commonState.indexingEnabled = true;
    priceUpdaterState.historyInserted = true;
    miningState.indexBlockPrices.mockReset().mockResolvedValue(undefined);
    miningState.indexCoinStatsIndex.mockReset().mockResolvedValue(undefined);
    pricesState.latestPriceId.mockReset().mockResolvedValue(7);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('executes a first and a second scheduled call', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(1);

    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(2);
  });

  it('lets a task reschedule itself while it runs', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    // A blocksPrices run without price history defers itself with a new timer.
    priceUpdaterState.historyInserted = false;
    indexer.scheduleSingleTask('blocksPrices', 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexBlockPrices).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);

    priceUpdaterState.historyInserted = true;
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(miningState.indexBlockPrices).toHaveBeenCalledTimes(1);
  });

  it('does not let a replaced timer cancel its replacement', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    indexer.scheduleSingleTask('coinStatsIndex', 5000, true);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexCoinStatsIndex).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4000);
    await flush();
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(1);
    // The replacement fired; a further throttled call must still be accepted.
    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(2);
  });

  it('throttles a second call while one is pending', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    indexer.scheduleSingleTask('coinStatsIndex', 1000);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected job as failed and permits a later retry', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    miningState.indexBlockPrices.mockRejectedValueOnce(new Error('isolated task failure'));
    const failed = await indexer.runSingleTask('blocksPrices');
    expect(failed).toEqual({ task: 'blocksPrices', status: 'failed', error: 'isolated task failure' });

    const retried = await indexer.runSingleTask('blocksPrices');
    expect(retried.status).toBe('completed');
    expect(retried.checkpoint?.startedAt).toBeDefined();
    expect(retried.checkpoint?.finishedAt).toBeDefined();
    expect(miningState.indexBlockPrices).toHaveBeenCalledTimes(2);
  });

  it('does not run a duplicate concurrent task twice', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    let release: () => void = () => undefined;
    miningState.indexCoinStatsIndex.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const first = indexer.runSingleTask('coinStatsIndex');
    await flush();
    const second = await indexer.runSingleTask('coinStatsIndex');
    expect(second.status).toBe('already-running');
    release();
    expect((await first).status).toBe('completed');
    expect(miningState.indexCoinStatsIndex).toHaveBeenCalledTimes(1);
  });

  it('reports disabled indexing without touching the job', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    commonState.indexingEnabled = false;
    const outcome = await indexer.runSingleTask('coinStatsIndex');
    expect(outcome.status).toBe('disabled');
    expect(miningState.indexCoinStatsIndex).not.toHaveBeenCalled();
  });

  it('reports disabled fiat prices for the blocksPrices task', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    configState.FIAT_PRICE.ENABLED = false;
    const outcome = await indexer.runSingleTask('blocksPrices');
    expect(outcome.status).toBe('disabled');
    expect(miningState.indexBlockPrices).not.toHaveBeenCalled();
  });

  it('reports network-inapplicable for blocksPrices on signet', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    configState.MEMPOOL.NETWORK = 'signet';
    const outcome = await indexer.runSingleTask('blocksPrices');
    expect(outcome.status).toBe('network-inapplicable');
    expect(miningState.indexBlockPrices).not.toHaveBeenCalled();
  });

  it('reports deferred when price history is unavailable and schedules a real retry', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    pricesState.latestPriceId.mockResolvedValueOnce(null);
    const outcome = await indexer.runSingleTask('blocksPrices');
    expect(outcome.status).toBe('deferred');
    expect(miningState.indexBlockPrices).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(miningState.indexBlockPrices).toHaveBeenCalledTimes(1);
  });

  it('does not hide a coinStatsIndex failure from the caller', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    miningState.indexCoinStatsIndex.mockRejectedValueOnce(new Error('isolated coinstats failure'));
    const outcome = await indexer.runSingleTask('coinStatsIndex');
    expect(outcome).toEqual({ task: 'coinStatsIndex', status: 'failed', error: 'isolated coinstats failure' });
  });

  it('accepts a reindex only when indexing is enabled', () => {
    expect(indexer.reindex()).toBe(true);
    commonState.indexingEnabled = false;
    expect(indexer.reindex()).toBe(false);
  });
});
