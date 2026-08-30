import config from '../config';
import DB from '../database';
import logger from '../logger';
import backendInfo from './backend-info';
import { Common } from './common';
import { preflightFailures, type PreflightFailure, type PreflightInput } from './capabilities.preflight';
import {
  $probeAddressIndex,
  addressBackendKind,
  type AddressBackendKind,
  type AddressIndexState,
} from './bitcoin/address-index';

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

/**
 * `syncing` exists because a dependency that is present, correct and simply
 * not finished yet is not the same as one that is broken, and a reader who is
 * told "unavailable" about an index that will answer in an hour has been told
 * the wrong thing.
 */
export type CapabilityState = 'ready' | 'syncing' | 'degraded' | 'unavailable' | 'disabled';

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
  /**
   * Which kind of infrastructure answers this feature, when the feature has a
   * choice. Absent for features that are only ever served from this process.
   */
  readonly backendKind?: AddressBackendKind;
  /** Height the feature's own index has reached, when it has one. */
  readonly indexedTip?: number | null;
  /** Height Bitcoin Core reports, for comparison with the line above. */
  readonly bitcoinCoreTip?: number | null;
  /** How far the index is behind Core, in blocks. */
  readonly lagBlocks?: number | null;
  /** How far behind it may be and still be called current. */
  readonly maxLagBlocks?: number | null;
  /** What the index says it was built from. Never an origin, port or path. */
  readonly sourceRelease?: string | null;
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
   * True when this deployment offers Bitcoin address lookup at all.
   *
   * With `MEMPOOL.BACKEND` set to `none` there is no address index and the
   * whole family answers that it cannot be served. Anything else means an
   * index was chosen, and the report below says whether it can actually
   * answer.
   */
  public addressLookupEnabled(): boolean {
    return addressBackendKind() !== 'none';
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
      addressBackend: addressBackendKind(),
      esploraEndpointConfigured: !!(config.ESPLORA.UNIX_SOCKET_PATH || config.ESPLORA.REST_API_URL),
      esploraFallbacks: config.ESPLORA.FALLBACK || [],
    });
  }

  /**
   * Full report, cached briefly so health polling cannot load the database.
   * @asyncSafe
   */
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
        addressLookup: await this.$addressLookupReport(),
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

  /**
   * Confirms the database answers, without reporting host, user, or password.
   * @asyncSafe
   */
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

  /** @asyncSafe */
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

  /**
   * Whether Bitcoin address lookup can be served, and how truthfully.
   *
   * This is the feature the capability model was missing when it mattered
   * most. Statistics and mining were both represented here, so a deployment
   * that could not serve them was caught before it shipped. Address lookup was
   * not, so a deployment with no address index at all passed every gate, put
   * "Search a transaction, block, address, or asset" in the header, and
   * answered every address with a 405 that the page then explained as the
   * address having too many transactions.
   *
   * A listening port is not readiness here. The verdict comes from an actual
   * address query, an actual UTXO query and a height compared against Bitcoin
   * Core, and it is computed by one function shared with the release gates so
   * the deployment and the checks cannot form different opinions.
   *
   * @asyncSafe
   */
  private async $addressLookupReport(): Promise<CapabilityReport> {
    const routesRegistered = this.routesRegistered('addressLookup');
    const chainSync = backendInfo.getBackendInfo().chainSync;
    const chainTip = typeof chainSync?.blocks === 'number' ? chainSync.blocks : null;

    let probe: Awaited<ReturnType<typeof $probeAddressIndex>>;
    try {
      probe = await $probeAddressIndex(chainTip);
    } catch (e) {
      // The probe is written not to throw, so reaching here means something
      // outside it did. Report unavailable rather than let one failed probe
      // take the whole capability document down with it.
      logger.debug('Address capability probe failed: ' + (e instanceof Error ? e.message : e));
      return {
        enabled: this.addressLookupEnabled(),
        routesRegistered,
        dependencies: [{
          name: 'address-index',
          configured: false,
          reachable: false,
          detail: 'The address index could not be probed.',
        }],
        state: 'unavailable',
        coverage: null,
        rowCount: null,
        lastSuccessfulUpdate: null,
        lagSeconds: null,
        degradedReason: 'The address index could not be probed.',
        backendKind: addressBackendKind(),
        indexedTip: null,
        bitcoinCoreTip: chainTip,
        lagBlocks: null,
        maxLagBlocks: null,
        sourceRelease: null,
      };
    }

    const dependencies: CapabilityDependency[] = [{
      name: 'address-index',
      configured: probe.configured,
      // "Reachable" here means it answered a request, not that a socket
      // accepted a connection. Those are different claims and only one of
      // them is worth publishing.
      reachable: probe.reachable && probe.summaryAnswered && probe.utxoAnswered,
      detail: probe.reachable
        ? (probe.summaryAnswered && probe.utxoAnswered
            ? null
            : 'The index answered but an address or UTXO query did not return a usable document.')
        : (probe.configured ? 'The index did not answer.' : 'No address index is configured.'),
    }];

    return {
      enabled: this.addressLookupEnabled(),
      routesRegistered,
      dependencies,
      state: addressStateToCapabilityState(probe.state),
      // Address history is bounded by what the index has reached, which is a
      // block range rather than a span of time.
      coverage: probe.indexedTip === null
        ? null
        : { from: '0', to: String(probe.indexedTip) },
      rowCount: null,
      lastSuccessfulUpdate: chainSync?.checkedAt ?? null,
      lagSeconds: null,
      degradedReason: probe.degradedReason,
      backendKind: probe.backendKind,
      indexedTip: probe.indexedTip,
      bitcoinCoreTip: probe.chainTip,
      lagBlocks: probe.lagBlocks,
      maxLagBlocks: probe.backendKind === 'esplora' ? probe.maxBehindTip : null,
      sourceRelease: probe.sourceRelease,
    };
  }

  /** @asyncSafe */
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

/**
 * The address index has its own vocabulary for the same idea, and the two are
 * kept deliberately identical rather than mapped loosely, so a state added to
 * one has to be given a meaning in the other.
 */
function addressStateToCapabilityState(state: AddressIndexState): CapabilityState {
  switch (state) {
    case 'ready': return 'ready';
    case 'syncing': return 'syncing';
    case 'degraded': return 'degraded';
    case 'unavailable': return 'unavailable';
    case 'disabled': return 'disabled';
  }
}

export default new Capabilities();
