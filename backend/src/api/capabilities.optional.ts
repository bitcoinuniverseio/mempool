import config from '../config';
import DB from '../database';
import logger from '../logger';
import priceUpdater from '../tasks/price-updater';
import type { CapabilityDependency, CapabilityReport } from './capabilities';

/**
 * The Explorer subsystems that exist only in some deployments.
 *
 * They belong in the capability report for the same reason address lookup
 * does: a page that is switched off has to stay visible and say why, and a
 * page that is switched on but cannot answer must never be presented as if it
 * can. A feature that disappears from the report leaves an operator guessing
 * whether it was disabled on purpose or quietly broke.
 *
 * Nothing here reports a host, a credential, or a private origin.
 */

/** A Lightning graph older than this has stopped being synchronised. */
const LIGHTNING_STALE_AFTER_SECONDS = 6 * 60 * 60;
/** A price older than this is not a current price. */
const PRICE_STALE_AFTER_SECONDS = 3 * 60 * 60;

export type OptionalFeature =
  | 'lightning'
  | 'prices'
  | 'accelerations'
  | 'wallets'
  | 'stratum'
  | 'liquid'
  | 'mempoolIntelligence';

function disabled(reason: string, dependencies: CapabilityDependency[] = []): CapabilityReport {
  return {
    enabled: false,
    routesRegistered: false,
    dependencies,
    state: 'disabled',
    coverage: null,
    rowCount: null,
    lastSuccessfulUpdate: null,
    lagSeconds: null,
    degradedReason: reason,
  };
}

function ready(input: {
  routesRegistered: boolean;
  dependencies: CapabilityDependency[];
  rowCount?: number | null;
  lastSuccessfulUpdate?: string | null;
  lagSeconds?: number | null;
  coverage?: { from: string | null; to: string | null } | null;
  degradedReason?: string | null;
  state?: CapabilityReport['state'];
}): CapabilityReport {
  return {
    enabled: true,
    routesRegistered: input.routesRegistered,
    dependencies: input.dependencies,
    state: input.state ?? (input.degradedReason ? 'degraded' : 'ready'),
    coverage: input.coverage ?? null,
    rowCount: input.rowCount ?? null,
    lastSuccessfulUpdate: input.lastSuccessfulUpdate ?? null,
    lagSeconds: input.lagSeconds ?? null,
    degradedReason: input.degradedReason ?? null,
  };
}

/** @asyncSafe */
async function tableRows(
  table: string,
  timestampColumn: string | null,
): Promise<{ total: number; newest: Date | null } | null> {
  try {
    const columns = timestampColumn
      ? `COUNT(*) AS total, MAX(\`${timestampColumn}\`) AS newest`
      : 'COUNT(*) AS total, NULL AS newest';
    const [rows]: any[] = await DB.query(`SELECT ${columns} FROM \`${table}\``);
    return {
      total: Number(rows[0]?.total ?? 0),
      newest: (rows[0]?.newest as Date | null) ?? null,
    };
  } catch (e) {
    logger.debug(`Capability probe could not read ${table}: ` + (e instanceof Error ? e.message : e));
    return null;
  }
}

/** @asyncSafe */
async function $lightningReport(routesRegistered: boolean): Promise<CapabilityReport> {
  if (config.LIGHTNING.ENABLED !== true) {
    return disabled('The Lightning network explorer is switched off in this deployment.');
  }
  const databaseDependency = (reachable: boolean, detail: string | null): CapabilityDependency[] => [
    {
      name: 'database',
      configured: config.DATABASE.ENABLED === true,
      reachable,
      detail,
    },
  ];
  if (config.DATABASE.ENABLED !== true) {
    return {
      ...ready({
        routesRegistered,
        dependencies: databaseDependency(false, 'The database is switched off in this deployment.'),
      }),
      state: 'unavailable',
      degradedReason: 'Lightning needs the database, which is switched off in this deployment.',
    };
  }
  const nodes = await tableRows('nodes', 'updated_at');
  const dependencies = databaseDependency(
    nodes !== null,
    nodes === null ? 'The Lightning node table could not be read.' : null,
  );
  if (nodes === null) {
    return {
      ...ready({ routesRegistered, dependencies }),
      state: 'unavailable',
      degradedReason: 'The Lightning node table could not be read.',
    };
  }
  const lagSeconds = nodes.newest
    ? Math.max(0, Math.round((Date.now() - nodes.newest.getTime()) / 1000))
    : null;
  const stale = lagSeconds !== null && lagSeconds > LIGHTNING_STALE_AFTER_SECONDS;
  return ready({
    routesRegistered,
    dependencies,
    rowCount: nodes.total,
    lastSuccessfulUpdate: nodes.newest ? nodes.newest.toISOString() : null,
    lagSeconds,
    state: nodes.total === 0 ? 'syncing' : stale ? 'degraded' : 'ready',
    degradedReason:
      nodes.total === 0
        ? 'The Lightning graph is enabled but no node has been imported yet.'
        : stale
          ? `The newest Lightning node record is ${Math.round((lagSeconds ?? 0) / 3600)} hours old.`
          : null,
  });
}

/** @asyncSafe */
async function $pricesReport(routesRegistered: boolean): Promise<CapabilityReport> {
  if (config.FIAT_PRICE.ENABLED !== true) {
    return disabled('Fiat prices are switched off in this deployment.');
  }
  const latest = priceUpdater.getLatestPrices() as unknown as { time?: number; USD?: number };
  const hasPrice = typeof latest?.USD === 'number' && latest.USD > 0;
  const lagSeconds =
    typeof latest?.time === 'number'
      ? Math.max(0, Math.round((Date.now() - latest.time * 1000) / 1000))
      : null;
  const stale = lagSeconds !== null && lagSeconds > PRICE_STALE_AFTER_SECONDS;
  const dependencies: CapabilityDependency[] = [
    {
      name: 'price-feed',
      configured: true,
      reachable: hasPrice,
      detail: hasPrice ? null : 'No usable price has been stored yet.',
    },
  ];
  return ready({
    routesRegistered,
    dependencies,
    lastSuccessfulUpdate:
      typeof latest?.time === 'number' ? new Date(latest.time * 1000).toISOString() : null,
    lagSeconds,
    state: !hasPrice ? 'unavailable' : stale ? 'degraded' : 'ready',
    degradedReason: !hasPrice
      ? 'No usable price has been stored, so fiat values on the site are not current.'
      : stale
        ? `The newest price is ${Math.round((lagSeconds ?? 0) / 3600)} hours old.`
        : null,
  });
}

/** @asyncSafe */
async function $accelerationsReport(routesRegistered: boolean): Promise<CapabilityReport> {
  if (config.MEMPOOL_SERVICES.ACCELERATIONS !== true) {
    return disabled('Accelerations are switched off in this deployment.');
  }
  const dependencies: CapabilityDependency[] = [
    {
      name: 'mempool-services',
      configured: Boolean(config.MEMPOOL_SERVICES.API),
      reachable: Boolean(config.MEMPOOL_SERVICES.API),
      detail: config.MEMPOOL_SERVICES.API
        ? null
        : 'Accelerations are enabled but no services endpoint is configured.',
    },
  ];
  if (config.DATABASE.ENABLED !== true) {
    return ready({
      routesRegistered,
      dependencies,
      state: 'degraded',
      degradedReason:
        'Acceleration history needs the database, which is switched off in this deployment.',
    });
  }
  const rows = await tableRows('accelerations', 'added');
  return ready({
    routesRegistered,
    dependencies,
    rowCount: rows?.total ?? null,
    lastSuccessfulUpdate: rows?.newest ? rows.newest.toISOString() : null,
    lagSeconds: rows?.newest
      ? Math.max(0, Math.round((Date.now() - rows.newest.getTime()) / 1000))
      : null,
    state: rows === null ? 'unavailable' : 'ready',
    degradedReason: rows === null ? 'The acceleration table could not be read.' : null,
  });
}

function walletsReport(routesRegistered: boolean): CapabilityReport {
  if (config.WALLETS.ENABLED !== true) {
    return disabled('Hosted wallet services are switched off in this deployment.');
  }
  const names = Array.isArray(config.WALLETS.WALLETS) ? config.WALLETS.WALLETS : [];
  return ready({
    routesRegistered,
    dependencies: [
      {
        name: 'wallet-service',
        configured: names.length > 0,
        reachable: names.length > 0,
        detail: names.length > 0 ? null : 'No wallet is named in the configuration.',
      },
    ],
    rowCount: names.length,
    state: names.length > 0 ? 'ready' : 'degraded',
    degradedReason:
      names.length > 0 ? null : 'Wallet services are enabled but no wallet is configured.',
  });
}

function stratumReport(): CapabilityReport {
  if (config.STRATUM?.ENABLED !== true) {
    return disabled('Stratum is switched off in this deployment.');
  }
  return ready({
    // Stratum has no HTTP routes of its own; it is a socket service, so this
    // stays false rather than claiming a route that does not exist.
    routesRegistered: false,
    dependencies: [
      {
        name: 'stratum-api',
        configured: Boolean(config.STRATUM.API),
        reachable: Boolean(config.STRATUM.API),
        detail: config.STRATUM.API ? null : 'Stratum is enabled but no API is configured.',
      },
    ],
    state: config.STRATUM.API ? 'ready' : 'degraded',
    degradedReason: config.STRATUM.API
      ? null
      : 'Stratum is enabled but no API endpoint is configured.',
  });
}

function liquidReport(routesRegistered: boolean): CapabilityReport {
  const network = String(config.MEMPOOL.NETWORK ?? '');
  if (network !== 'liquid' && network !== 'liquidtestnet') {
    return disabled('This deployment is not a Liquid explorer.');
  }
  return ready({
    routesRegistered,
    dependencies: [
      {
        name: 'liquid-assets',
        configured: true,
        reachable: routesRegistered,
        detail: routesRegistered ? null : 'The Liquid routes were not mounted.',
      },
    ],
    state: routesRegistered ? 'ready' : 'unavailable',
    degradedReason: routesRegistered
      ? null
      : 'This is a Liquid deployment but the Liquid routes were never mounted.',
  });
}

/**
 * Cluster, chunk, fee rate diagram and package simulation reporting.
 *
 * The reading routes are derived entirely from the mempool this process
 * keeps, so they have one dependency and no database. The package simulator
 * is the exception: it asks Bitcoin Core to decode and judge, so Core is
 * named as a dependency of that route rather than left unstated. Its
 * reachability is not probed here, because the reading routes are the ones
 * this state is about and a probe on every capability call would cost the
 * shared RPC budget on every call.
 *
 * An empty mempool is reported as `syncing` rather than `ready`, because a
 * page that renders no clusters at all has not proved it can render clusters.
 */
function mempoolIntelligenceReport(
  routesRegistered: boolean,
  mempoolSize: number,
): CapabilityReport {
  if (config.MEMPOOL.ENABLED !== true) {
    return disabled('The mempool is switched off in this deployment.');
  }
  return ready({
    routesRegistered,
    dependencies: [
      {
        name: 'mempool',
        configured: true,
        reachable: routesRegistered,
        detail: routesRegistered ? null : 'The cluster routes were not mounted.',
      },
      {
        name: 'bitcoin-rpc',
        configured: true,
        reachable: routesRegistered,
        detail: 'Needed by the package simulator only. The cluster, package and diagram routes answer without it.',
      },
    ],
    rowCount: mempoolSize,
    state: !routesRegistered ? 'unavailable' : mempoolSize === 0 ? 'syncing' : 'ready',
    degradedReason: !routesRegistered
      ? 'The mempool is enabled but the cluster routes were never mounted.'
      : mempoolSize === 0
        ? 'No unconfirmed transaction has been loaded yet, so no cluster exists to show.'
        : null,
  });
}

/**
 * Builds the optional half of the capability report. Every entry is present
 * in every deployment, so a feature never vanishes from the document; it
 * reports `disabled` with a reason instead.
 *
 * @asyncSafe
 */
export async function $optionalCapabilityReports(
  routesRegistered: (feature: string) => boolean,
  mempoolSize = 0,
): Promise<Record<OptionalFeature, CapabilityReport>> {
  // Awaited one at a time rather than in parallel: each probe already
  // catches its own failures, and running them in sequence keeps the promise
  // chain individually accountable for its own rejection.
  const lightning = await $lightningReport(routesRegistered('lightning'));
  const prices = await $pricesReport(routesRegistered('prices'));
  const accelerations = await $accelerationsReport(routesRegistered('accelerations'));
  return {
    lightning,
    prices,
    accelerations,
    wallets: walletsReport(routesRegistered('wallets')),
    stratum: stratumReport(),
    liquid: liquidReport(routesRegistered('liquid')),
    mempoolIntelligence: mempoolIntelligenceReport(
      routesRegistered('mempoolIntelligence'),
      mempoolSize,
    ),
  };
}
