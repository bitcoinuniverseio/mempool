/**
 * The indexer and reconcile operation handlers consume typed outcomes. Only
 * a completed task whose persisted rows read back complete may be verified.
 */
const indexerState = { runSingleTask: jest.fn(), reindex: jest.fn() };
const dbState = { query: jest.fn() };
const runStoreState = { reconcileAbandonedRuns: jest.fn() };

jest.mock('../config', () => ({
  __esModule: true,
  default: { DATABASE: { ENABLED: true }, REDIS: { ENABLED: false }, FIAT_PRICE: { ENABLED: true }, MEMPOOL: { INDEXING_BLOCKS_AMOUNT: -1, NETWORK: 'signet' } },
}));
jest.mock('../database', () => ({ __esModule: true, default: { query: (...args: unknown[]) => dbState.query(...args) } }));
jest.mock('../api/backend-info', () => ({ __esModule: true, default: { getBackendInfo: () => ({}) } }));
jest.mock('../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: {} }));
jest.mock('../api/bitcoin/address-index', () => ({ $probeAddressIndex: jest.fn() }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: {} }));
jest.mock('../api/capabilities', () => ({ __esModule: true, default: {} }));
jest.mock('../indexer', () => ({ __esModule: true, default: indexerState }));
jest.mock('../api/mempool', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/pools-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../tasks/price-updater', () => ({ __esModule: true, default: {} }));
jest.mock('../api/redis-cache', () => ({ __esModule: true, default: {} }));
jest.mock('../api/admin-adapter/admin-adapter.runs', () => ({ __esModule: true, default: runStoreState }));

import { findExplorerOperation } from '../api/admin-adapter/admin-adapter.operations';

const context = (input: Record<string, unknown>) => ({
  runId: 'run', correlationId: 'c', actor: 'a', reason: null, idempotencyKey: null, input,
});

describe('explorer.indexer.task.run', () => {
  const operation = findExplorerOperation('explorer.indexer.task.run');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['disabled', 'already-running', 'deferred', 'network-inapplicable'] as const)(
    'never verifies a task that answered %s',
    /** @asyncUnsafe Jest owns the test promise. */ async (status) => {
      indexerState.runSingleTask.mockResolvedValue({ task: 'coinStatsIndex', status, reason: `fixture ${status}` });
      const outcome = await operation.execute(context({ task: 'coinStatsIndex' }));
      expect(outcome.verification.verified).toBe(false);
      expect(outcome.result.status).toBe(status);
      expect(outcome.result.reason).toBe(`fixture ${status}`);
      expect(outcome.verification.evidence.join(' ')).toContain(status);
      expect(dbState.query).not.toHaveBeenCalled();
    },
  );

  it('turns a failed task into a run failure carrying the error', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexerState.runSingleTask.mockResolvedValue({ task: 'coinStatsIndex', status: 'failed', error: 'isolated coinstats failure' });
    await expect(operation.execute(context({ task: 'coinStatsIndex' }))).rejects.toThrow('isolated coinstats failure');
  });

  it('verifies a completed task only when the persisted rows read back complete', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexerState.runSingleTask.mockResolvedValue({
      task: 'coinStatsIndex', status: 'completed', checkpoint: { startedAt: '2026-09-17T12:00:00.000Z', finishedAt: '2026-09-17T12:00:05.000Z' },
    });
    dbState.query.mockResolvedValueOnce([[{ remaining: 0 }]]).mockResolvedValueOnce([[{ tip: 250_000 }]]);
    const verified = await operation.execute(context({ task: 'coinStatsIndex' }));
    expect(verified.verification.verified).toBe(true);
    expect(verified.result).toMatchObject({ status: 'completed', remaining: 0, indexedTip: 250_000, startedAt: '2026-09-17T12:00:00.000Z', finishedAt: '2026-09-17T12:00:05.000Z' });

    dbState.query.mockResolvedValueOnce([[{ remaining: 12 }]]).mockResolvedValueOnce([[{ tip: 249_000 }]]);
    const incomplete = await operation.execute(context({ task: 'coinStatsIndex' }));
    expect(incomplete.verification.verified).toBe(false);
    expect(incomplete.result.remaining).toBe(12);

    dbState.query.mockRejectedValueOnce(new Error('isolated unavailable database fixture'));
    const unreadable = await operation.execute(context({ task: 'coinStatsIndex' }));
    expect(unreadable.verification.verified).toBe(false);
    expect(unreadable.result.checkpointError).toBe('isolated unavailable database fixture');
  });

  it('reads the blocks_prices checkpoint for the blocksPrices task', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexerState.runSingleTask.mockResolvedValue({ task: 'blocksPrices', status: 'completed', checkpoint: { startedAt: 'a', finishedAt: 'b' } });
    dbState.query.mockResolvedValueOnce([[{ remaining: 0 }]]).mockResolvedValueOnce([[{ tip: 100 }]]);
    const outcome = await operation.execute(context({ task: 'blocksPrices' }));
    expect(outcome.verification.verified).toBe(true);
    expect(String(dbState.query.mock.calls[0][0])).toContain('blocks_prices');
  });
});

describe('explorer.indexer.reindex', () => {
  const operation = findExplorerOperation('explorer.indexer.reindex');

  it('reports scheduled only when the indexer accepted, and never completion', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    indexerState.reindex.mockReturnValue(true);
    const accepted = await operation.execute(context({ confirmation: 'REINDEX EXPLORER BLOCKS' }));
    expect(accepted.result).toEqual({ scheduled: true, indexingCompleted: false });
    expect(accepted.summary).toContain('not complete');

    indexerState.reindex.mockReturnValue(false);
    await expect(operation.execute(context({ confirmation: 'REINDEX EXPLORER BLOCKS' }))).rejects.toThrow(/refused/);
  });
});

describe('explorer.runs.reconcile', () => {
  const operation = findExplorerOperation('explorer.runs.reconcile');

  it('verifies only a clean pass with nothing remaining', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    runStoreState.reconcileAbandonedRuns.mockResolvedValue({ reconciled: 3, remaining: 0, verified: true });
    const clean = await operation.execute(context({}));
    expect(clean.verification.verified).toBe(true);
    expect(clean.result).toEqual({ reconciled: 3, remaining: 0, storageError: null });

    runStoreState.reconcileAbandonedRuns.mockResolvedValue({ reconciled: 200, remaining: 7, verified: false });
    const partial = await operation.execute(context({}));
    expect(partial.verification.verified).toBe(false);
    expect(partial.result.remaining).toBe(7);

    runStoreState.reconcileAbandonedRuns.mockResolvedValue({ reconciled: 0, remaining: null, verified: false, error: 'isolated unavailable database fixture' });
    const failed = await operation.execute(context({}));
    expect(failed.verification.verified).toBe(false);
    expect(failed.result.storageError).toBe('isolated unavailable database fixture');
    expect(failed.summary).toContain('storage error');
  });
});
