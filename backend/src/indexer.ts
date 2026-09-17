import { Common } from './api/common';
import blocks from './api/blocks';
import mempool from './api/mempool';
import mining from './api/mining/mining';
import logger from './logger';
import bitcoinClient from './api/bitcoin/bitcoin-client';
import priceUpdater from './tasks/price-updater';
import PricesRepository from './repositories/PricesRepository';
import config from './config';
import auditReplicator from './replication/AuditReplication';
import statisticsReplicator from './replication/StatisticsReplication';
import AccelerationRepository from './repositories/AccelerationRepository';
import BlocksAuditsRepository from './repositories/BlocksAuditsRepository';
import BlocksRepository from './repositories/BlocksRepository';

export interface CoreIndex {
  name: string;
  synced: boolean;
  best_block_height: number;
}

type TaskName = 'blocksPrices' | 'coinStatsIndex';

export type SingleTaskStatus =
  | 'completed'
  | 'already-running'
  | 'disabled'
  | 'deferred'
  | 'network-inapplicable'
  | 'failed';

/**
 * What actually happened when a single task was asked to run. A caller that
 * needs authoritative completion (the admin adapter) must only trust
 * `completed`, and even then confirm the persisted rows itself.
 */
export interface SingleTaskOutcome {
  task: TaskName;
  status: SingleTaskStatus;
  /** Why the task did not run, for every status other than completed. */
  reason?: string;
  /** The failure message, for status failed. */
  error?: string;
  /** Wall-clock bounds of the work, for status completed. */
  checkpoint?: { startedAt: string; finishedAt: string };
}

class Indexer {
  private runIndexer = true;
  private indexerRunning = false;
  private tasksRunning: { [key in TaskName]?: boolean; } = {};
  private tasksScheduled: { [key in TaskName]?: NodeJS.Timeout; } = {};
  private reindexTimeout: NodeJS.Timeout | undefined;
  private coreIndexes: CoreIndex[] = [];

  public indexerIsRunning(): boolean {
    return this.indexerRunning;
  }

  /**
   * Check which core index is available for indexing
   * 
   * @asyncUnsafe
   */
  public async checkAvailableCoreIndexes(): Promise<void> {
    const updatedCoreIndexes: CoreIndex[] = [];

    const indexes: any = await bitcoinClient.getIndexInfo();
    for (const indexName in indexes) {
      const newState = {
        name: indexName,
        synced: indexes[indexName].synced,
        best_block_height: indexes[indexName].best_block_height,
      };
      logger.info(`Core index '${indexName}' is ${indexes[indexName].synced ? 'synced' : 'not synced'}. Best block height is ${indexes[indexName].best_block_height}`);
      updatedCoreIndexes.push(newState);

      if (indexName === 'coinstatsindex' && newState.synced === true) {
        const previousState = this.isCoreIndexReady('coinstatsindex');
        // if (!previousState || previousState.synced === false) {
          void this.runSingleTask('coinStatsIndex');
        // }
      }
    }

    this.coreIndexes = updatedCoreIndexes;
  }

  /**
   * Return the best block height if a core index is available, or 0 if not
   *
   * @param name
   * @returns
   */
  public isCoreIndexReady(name: string): CoreIndex | null {
    for (const index of this.coreIndexes) {
      if (index.name === name && index.synced === true) {
        return index;
      }
    }
    return null;
  }

  /**
   * Releases the indexing loop to run again. Returns whether the request was
   * accepted; it is refused when indexing is disabled in this deployment.
   */
  public reindex(): boolean {
    if (!Common.indexingEnabled()) {
      return false;
    }
    if (this.reindexTimeout) {
      clearTimeout(this.reindexTimeout);
      this.reindexTimeout = undefined;
    }
    this.runIndexer = true;
    return true;
  }

  private scheduleNextRun(timeout: number): void {
    if (!this.reindexTimeout) { // Only one future run should be planned, ignore if already scheduled
      this.reindexTimeout = setTimeout(() => {
        this.reindexTimeout = undefined;
        this.reindex();
      }, timeout);
    }
  }

  /**
   * schedules a single task to run in `timeout` ms
   * only one task of each type may be scheduled
   *
   * @param {TaskName} task - the type of task
   * @param {number} timeout - delay in ms
   * @param {boolean} replace - `true` replaces any already scheduled task (works like a debounce), `false` ignores subsequent requests (works like a throttle)
   */
  public scheduleSingleTask(task: TaskName, timeout: number = 10000, replace = false): void {
    if (this.tasksScheduled[task]) {
      if (!replace) { //throttle
        return;
      } else { // debounce
        clearTimeout(this.tasksScheduled[task]);
        delete this.tasksScheduled[task];
      }
    }
    const handle = setTimeout(async () => {
      // Release the slot before the work starts so the task can schedule its
      // own successor. Identity-compared: a replaced timer's callback never
      // fires, but it must not be able to clear a newer handle either way.
      if (this.tasksScheduled[task] === handle) {
        delete this.tasksScheduled[task];
      }
      try {
        const outcome = await this.runSingleTask(task);
        if (outcome.status === 'failed') {
          logger.err(`Scheduled task ${task} failed: ${outcome.error ?? 'unknown error'}`);
        }
      } catch (e) {
        logger.err(`Unexpected error in scheduled task ${task}: ` + (e instanceof Error ? e.message : e));
      }
    }, timeout);
    this.tasksScheduled[task] = handle;
  }

  /**
   * Runs a single task immediately
   *
   * (use `scheduleSingleTask` instead to queue a task to run after some timeout)
   *
   * @asyncSafe
   */
  public async runSingleTask(task: TaskName): Promise<SingleTaskOutcome> {
    if (!Common.indexingEnabled()) {
      return { task, status: 'disabled', reason: 'Indexing is disabled in this deployment.' };
    }
    if (this.tasksRunning[task]) {
      return { task, status: 'already-running', reason: `The ${task} task is already running.` };
    }
    this.tasksRunning[task] = true;
    const startedAt = new Date().toISOString();

    try {
      switch (task) {
        case 'blocksPrices': {
          if (['testnet', 'signet', 'testnet4', 'regtest'].includes(config.MEMPOOL.NETWORK)) {
            return { task, status: 'network-inapplicable', reason: `Coins on ${config.MEMPOOL.NETWORK} have no fiat price.` };
          }
          if (!config.FIAT_PRICE.ENABLED) {
            return { task, status: 'disabled', reason: 'Fiat prices are switched off in this deployment.' };
          }
          let lastestPriceId: number | null | undefined;
          try {
            lastestPriceId = await PricesRepository.$getLatestPriceId();
          } catch (e) {
            logger.debug('failed to fetch latest price id from db: ' + (e instanceof Error ? e.message : e));
          }
          if (priceUpdater.historyInserted === false || lastestPriceId === null || lastestPriceId === undefined) {
            logger.debug(`Blocks prices indexer is waiting for the price updater to complete`, logger.tags.mining);
            this.scheduleSingleTask(task, 10000);
            return { task, status: 'deferred', reason: 'Price history is not available yet; the task was rescheduled.' };
          }
          logger.debug(`Blocks prices indexer will run now`, logger.tags.mining);
          await mining.$indexBlockPrices();
          return { task, status: 'completed', checkpoint: { startedAt, finishedAt: new Date().toISOString() } };
        }

        case 'coinStatsIndex': {
          logger.debug(`Indexing coinStatsIndex now`);
          await mining.$indexCoinStatsIndex();
          return { task, status: 'completed', checkpoint: { startedAt, finishedAt: new Date().toISOString() } };
        }
      }
      return { task, status: 'failed', error: `Unknown task ${String(task)}.` };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.debug(`failed to run ${task}: ` + error);
      return { task, status: 'failed', error };
    } finally {
      this.tasksRunning[task] = false;
    }
  }

  /** @asyncSafe */
  public async $run(): Promise<void> {
    if (!Common.indexingEnabled() || this.runIndexer === false ||
      this.indexerRunning === true || mempool.hasPriority()
    ) {
      return;
    }

    this.runIndexer = false;
    this.indexerRunning = true;

    const retryDelay = 10000;
    const runEvery = 1000 * 3600; // 1 hour
    let nextRunDelay = runEvery;
    let runSuccessful = false;

    try {
      if (config.FIAT_PRICE.ENABLED) {
        try {
          await priceUpdater.$run();
        } catch (e) {
          logger.err(`Running priceUpdater failed. Reason: ` + (e instanceof Error ? e.message : e));
        }
      }

      // Do not attempt to index anything unless Bitcoin Core is fully synced
      const blockchainInfo = await bitcoinClient.getBlockchainInfo();
      if (blockchainInfo.blocks !== blockchainInfo.headers) {
        logger.debug(`Bitcoin Core not fully synced, retrying index run in 10 seconds.`);
        nextRunDelay = retryDelay;
        return;
      }

      logger.debug(`Running mining indexer`);

      await this.checkAvailableCoreIndexes();

      const chainValid = await blocks.$generateBlockDatabase();
      if (chainValid === false) {
        // Chain of block hash was invalid, so we need to reindex. Stop here and continue at the next iteration
        logger.warn(`The chain of block hash is invalid, re-indexing invalid data in 10 seconds.`, logger.tags.mining);
        nextRunDelay = retryDelay;
        return;
      }

      void this.runSingleTask('blocksPrices');
      await blocks.$indexCoinbaseAddresses();
      await mining.$indexDifficultyAdjustments();
      await mining.$generateNetworkHashrateHistory();
      await mining.$generatePoolHashrateHistory();
      await blocks.$generateBlocksSummariesDatabase();
      await blocks.$generateCPFPDatabase();
      await blocks.$generateAuditStats();
      await blocks.$indexBlocksFirstSeen();
      await auditReplicator.$sync();
      await statisticsReplicator.$sync();
      await AccelerationRepository.$indexPastAccelerations();
      await BlocksAuditsRepository.$migrateAuditsV0toV1();
      await BlocksRepository.$migrateBlocks();
      // do not wait for classify blocks to finish
      void blocks.$classifyBlocks();
      runSuccessful = true;
    } catch (e) {
      nextRunDelay = retryDelay;
      logger.err(`Indexer failed, trying again in 10 seconds. Reason: ` + (e instanceof Error ? e.message : e));
    } finally {
      this.indexerRunning = false;
      const nextRunAt = new Date(Date.now() + nextRunDelay).toUTCString();
      if (runSuccessful) {
        logger.debug(`Indexing completed. Next run planned at ${nextRunAt}`);
      } else {
        logger.debug(`Indexing did not complete, next run planned at ${nextRunAt}`);
      }
      this.scheduleNextRun(nextRunDelay);
    }
  }
}

export default new Indexer();
