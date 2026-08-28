import config from '../config';
import DB from '../database';
import logger from '../logger';
import backendInfo from './backend-info';
import { Common } from './common';
import { preflightFailures, type PreflightFailure, type PreflightInput } from './capabilities.preflight';

export { preflightFailures };
export type { PreflightFailure, PreflightInput };

/**
 * One place that knows which public features this deployment can actually
 * serve, so the frontend never advertises a page whose backend routes were
 * never mounted and the deployment can refuse to cut over when the two
 * disagree.
 *
 * Nothing here reports a secret, a private origin, or a credential.
 */

export type CapabilityState = 'ready' | 'degraded' | 'unavailable' | 'disabled';

export interface CapabilityDependency {
  readonly name: string;
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly detail: string | null;
}

export interface CapabilityReport {
  /** Feature is switched on in configuration. */
  readonly enabled: boolean;
  /** The HTTP routes backing the feature were actually mounted. */
  readonly routesRegistered: boolean;
  readonly dependencies: readonly CapabilityDependency[];
  readonly state: CapabilityState;
  /** Oldest and newest real data this feature can answer for. */
  readonly coverage: { readonly from: string | null; readonly to: string | null } | null;
  readonly rowCount: number | null;
  readonly lastSuccessfulUpdate: string | null;
  /** Age of the newest row, in seconds, or null when nothing is stored yet. */
  readonly lagSeconds: number | null;
  readonly degradedReason: string | null;
}

export interface CapabilitiesResponse {
  readonly schemaVersion: 'universe-explorer-capabilities-v1';
  readonly releaseSha: string;
  readonly network: string;
  readonly generatedAt: string;
  readonly features: Readonly<Record<string, CapabilityReport>>;
}

const CACHE_TTL_MS = 10_000;
/** A statistics row is written every minute; five minutes is a stall. */
const STATISTICS_STALE_AFTER_SECONDS = 300;

class Capabilities {
  private registeredRoutes = new Set<string>();
  private cached: { at: number; value: CapabilitiesResponse } | null = null;

  /**
   * Called by the route setup for every feature it mounts, so the report can
   * never claim a route exists that was not registered.
   */
  public markRoutesRegistered(feature: string): void {
    this.registeredRoutes.add(feature);
  }

  public routesRegistered(feature: string): boolean {
    return this.registeredRoutes.has(feature);
  }

  /** True when configuration says the statistics feature should be served. */
  public statisticsEnabled(): boolean {
    return config.STATISTICS.ENABLED === true
      && config.DATABASE.ENABLED === true
      && config.MEMPOOL.ENABLED === true;
  }

  /** True when configuration says the mining feature should be served. */
  public miningEnabled(): boolean {
    return Common.indexingEnabled() && config.MEMPOOL.ENABLED === true;
  }

  /**
   * Configuration combinations that would put a broken public feature in front
   * of users. An empty list means the deployment is coherent.
   */
  public preflight(): PreflightFailure[] {
    return preflightFailures({
      statisticsEnabled: config.STATISTICS.ENABLED === true,
      databaseEnabled: config.DATABASE.ENABLED === true,
      mempoolEnabled: config.MEMPOOL.ENABLED === true,
      indexingBlocksAmount: config.MEMPOOL.INDEXING_BLOCKS_AMOUNT,
    });
  }

  /** Full report, cached briefly so health polling cannot load the database. */
  public async $report(): Promise<CapabilitiesResponse> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.value;
    }
    const value: CapabilitiesResponse = {
      schemaVersion: 'universe-explorer-capabilities-v1',
      releaseSha: backendInfo.getBackendInfo().gitCommit,
      network: config.MEMPOOL.NETWORK,
      generatedAt: new Date().toISOString(),
      features: {
        statistics: await this.$statisticsReport(),
        mining: await this.$miningReport(),
      },
    };
    this.cached = { at: now, value };
    return value;
  }

  private databaseDependency(reachable: boolean, detail: string | null): CapabilityDependency {
    return {
      name: 'database',
      configured: config.DATABASE.ENABLED === true,
      reachable,
      detail,
    };
  }

  /** Confirms the database answers, without reporting host, user, or password. */
  private async $databaseReachable(): Promise<{ reachable: boolean; detail: string | null }> {
    if (config.DATABASE.ENABLED !== true) {
      return { reachable: false, detail: 'The database is disabled in configuration.' };
    }
    try {
      await DB.query('SELECT 1');
      return { reachable: true, detail: null };
    } catch (e) {
      logger.debug('Capability probe could not reach the database: ' + (e instanceof Error ? e.message : e));
      return { reachable: false, detail: 'The database did not answer.' };
    }
  }

  private async $statisticsReport(): Promise<CapabilityReport> {
    const enabled = this.statisticsEnabled();
    const routesRegistered = this.routesRegistered('statistics');
    if (!enabled) {
      return {
        enabled: false,
        routesRegistered,
        dependencies: [this.databaseDependency(false, null)],
        state: 'disabled',
        coverage: null,
        rowCount: null,
        lastSuccessfulUpdate: null,
        lagSeconds: null,
        degradedReason: 'Statistics collection is switched off in this deployment.',
      };
    }

    const database = await this.$databaseReachable();
    const dependencies = [this.databaseDependency(database.reachable, database.detail)];
    if (!database.reachable) {
      return {
        enabled, routesRegistered, dependencies,
        state: 'unavailable',
        coverage: null, rowCount: null, lastSuccessfulUpdate: null, lagSeconds: null,
        degradedReason: 'The statistics database is unavailable.',
      };
    }

    try {
      const [rows]: any[] = await DB.query(
        `SELECT COUNT(*) AS total,
                MIN(added) AS oldest,
                MAX(added) AS newest
         FROM statistics`
      );
      const total = Number(rows[0]?.total ?? 0);
      const oldest: Date | null = rows[0]?.oldest ?? null;
      const newest: Date | null = rows[0]?.newest ?? null;
      const lagSeconds = newest ? Math.max(0, Math.round((Date.now() - newest.getTime()) / 1000)) : null;
      const stale = lagSeconds !== null && lagSeconds > STATISTICS_STALE_AFTER_SECONDS;
      return {
        enabled, routesRegistered, dependencies,
        state: total === 0 ? 'degraded' : stale ? 'degraded' : 'ready',
        coverage: {
          from: oldest ? oldest.toISOString() : null,
          to: newest ? newest.toISOString() : null,
        },
        rowCount: total,
        lastSuccessfulUpdate: newest ? newest.toISOString() : null,
        lagSeconds,
        degradedReason: total === 0
          ? 'Statistics collection has started but no sample has been stored yet.'
          : stale
            ? 'The newest statistics sample is older than the collection interval allows.'
            : null,
      };
    } catch (e) {
      logger.debug('Capability probe could not read statistics: ' + (e instanceof Error ? e.message : e));
      return {
        enabled, routesRegistered, dependencies,
        state: 'unavailable',
        coverage: null, rowCount: null, lastSuccessfulUpdate: null, lagSeconds: null,
        degradedReason: 'The statistics table could not be read.',
      };
    }
  }

  private async $miningReport(): Promise<CapabilityReport> {
    const enabled = this.miningEnabled();
    const routesRegistered = this.routesRegistered('mining');
    if (!enabled) {
      return {
        enabled: false,
        routesRegistered,
        dependencies: [this.databaseDependency(false, null)],
        state: 'disabled',
        coverage: null, rowCount: null, lastSuccessfulUpdate: null, lagSeconds: null,
        degradedReason: 'Block indexing is switched off in this deployment.',
      };
    }

    const database = await this.$databaseReachable();
    const dependencies: CapabilityDependency[] = [this.databaseDependency(database.reachable, database.detail)];
    if (!database.reachable) {
      return {
        enabled, routesRegistered, dependencies,
        state: 'unavailable',
        coverage: null, rowCount: null, lastSuccessfulUpdate: null, lagSeconds: null,
        degradedReason: 'The mining index database is unavailable.',
      };
    }

    try {
      const [rows]: any[] = await DB.query(
        `SELECT COUNT(*) AS total,
                MIN(height) AS lowest,
                MAX(height) AS highest,
                MAX(blockTimestamp) AS newest
         FROM blocks`
      );
      const total = Number(rows[0]?.total ?? 0);
      const lowest = rows[0]?.lowest === null || rows[0]?.lowest === undefined ? null : Number(rows[0].lowest);
      const highest = rows[0]?.highest === null || rows[0]?.highest === undefined ? null : Number(rows[0].highest);
      const newest: Date | null = rows[0]?.newest ?? null;

      const [poolRows]: any[] = await DB.query('SELECT COUNT(*) AS total FROM pools');
      const poolCount = Number(poolRows[0]?.total ?? 0);
      dependencies.push({
        name: 'pool-metadata',
        configured: config.MEMPOOL.POOLS_JSON_FILE !== '',
        reachable: poolCount > 0,
        detail: poolCount > 0 ? null : 'No mining pool metadata has been imported.',
      });

      const indexed = total > 0 && poolCount > 0;
      return {
        enabled, routesRegistered, dependencies,
        state: indexed ? 'ready' : 'degraded',
        coverage: {
          from: lowest === null ? null : String(lowest),
          to: highest === null ? null : String(highest),
        },
        rowCount: total,
        lastSuccessfulUpdate: newest ? newest.toISOString() : null,
        lagSeconds: newest ? Math.max(0, Math.round((Date.now() - newest.getTime()) / 1000)) : null,
        degradedReason: total === 0
          ? 'Block indexing is running but no block has been indexed yet.'
          : poolCount === 0
            ? 'Mining pool metadata has not been imported yet.'
            : null,
      };
    } catch (e) {
      logger.debug('Capability probe could not read the mining index: ' + (e instanceof Error ? e.message : e));
      return {
        enabled, routesRegistered, dependencies,
        state: 'unavailable',
        coverage: null, rowCount: null, lastSuccessfulUpdate: null, lagSeconds: null,
        degradedReason: 'The mining index tables could not be read.',
      };
    }
  }
}

export default new Capabilities();
