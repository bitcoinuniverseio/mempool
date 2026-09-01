import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import type {
  AdminAttentionItem,
  AdminComponentReport,
  AdminHealthState,
  AdminResourceKind,
  AdminSnapshot,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import DB from '../../database';
import backendInfo from '../backend-info';
import blocks from '../blocks';
import capabilities, { CapabilityReport } from '../capabilities';
import feeApi from '../fee-api';
import loadingIndicators from '../loading-indicators';
import memPool from '../mempool';
import mempoolBlocks from '../mempool-blocks';
import priceUpdater from '../../tasks/price-updater';
import poolsUpdater from '../../tasks/pools-updater';
import redisCache from '../redis-cache';
import websocketHandler from '../websocket-handler';
import indexer from '../../indexer';
import bitcoinClient from '../bitcoin/bitcoin-client';
import {
  adminEnvelope,
  adminTimestamp,
  explorerNetwork,
  explorerRelease,
  optionalAdminTimestamp,
  releaseShaOrNull,
} from './admin-adapter.identity';
import { diskSnapshot, processSnapshot } from './admin-adapter.runtime';

const { foldAdminHealthStates } = adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

/** A mempool that has not been touched for this long is not being updated. */
const MEMPOOL_STALE_AFTER_SECONDS = 120;
/** Pool metadata is refreshed weekly; a month without one is a stall. */
const POOLS_STALE_AFTER_SECONDS = 30 * 24 * 60 * 60;
/** A price feed older than this is not a current price. */
const PRICE_STALE_AFTER_SECONDS = 3 * 60 * 60;

type Metrics = AdminComponentReport['metrics'];

function component(input: {
  id: string;
  kind: AdminResourceKind;
  name: string;
  state: AdminHealthState;
  reason?: string | null;
  lastSuccessAt?: string | null;
  probeLatencyMs?: number | null;
  chainTip?: number | null;
  indexedTip?: number | null;
  lagBlocks?: number | null;
  lagSeconds?: number | null;
  maxLagBlocks?: number | null;
  queueDepth?: number | null;
  oldestQueueAgeSeconds?: number | null;
  dependsOn?: string[];
  operations?: string[];
  metrics?: Metrics;
}): AdminComponentReport {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    state: input.state,
    reason: input.reason ?? null,
    network: explorerNetwork(),
    lastSuccessAt: input.lastSuccessAt ?? null,
    lastCheckedAt: adminTimestamp(),
    probeLatencyMs: input.probeLatencyMs ?? null,
    chainTip: input.chainTip ?? null,
    indexedTip: input.indexedTip ?? null,
    lagBlocks: input.lagBlocks ?? null,
    lagSeconds: input.lagSeconds ?? null,
    maxLagBlocks: input.maxLagBlocks ?? null,
    queueDepth: input.queueDepth ?? null,
    oldestQueueAgeSeconds: input.oldestQueueAgeSeconds ?? null,
    sourceReleaseSha: releaseShaOrNull(backendInfo.getBackendInfo().gitCommit),
    runbook: null,
    dependsOn: input.dependsOn ?? [],
    operations: input.operations ?? [],
    metrics: input.metrics ?? {},
  };
}

/**
 * Capability states and health words are close but not identical: the
 * capability model has no `unknown`, because a probe always produced an
 * answer, and the health vocabulary needs one for a source that never
 * answered at all.
 */
export function capabilityState(report: CapabilityReport): AdminHealthState {
  switch (report.state) {
    case 'ready':
      return 'healthy';
    case 'syncing':
      return 'syncing';
    case 'degraded':
      return 'degraded';
    case 'unavailable':
      return 'unavailable';
    case 'disabled':
      // A feature switched off on purpose is not a fault, and calling it one
      // sends an operator looking for a problem that does not exist.
      return report.enabled ? 'not_configured' : 'disabled_by_policy';
    default:
      return 'unknown';
  }
}

function secondsSince(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const at = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(at) ? null : Math.max(0, Math.round((Date.now() - at) / 1000));
}

/** Bitcoin Core: reachable, and how far into the chain it has actually got. */
/** @asyncSafe */
async function bitcoinCoreComponent(): Promise<AdminComponentReport> {
  const info = backendInfo.getBackendInfo();
  const sync = info.chainSync;
  const started = Date.now();
  let reachable = false;
  let detail: string | null = null;
  try {
    await bitcoinClient.getBlockCount();
    reachable = true;
  } catch (error) {
    detail = 'Bitcoin Core did not answer a block count request.';
  }
  const latency = Date.now() - started;

  if (!reachable) {
    return component({
      id: 'bitcoin-core',
      kind: 'node',
      name: 'Bitcoin Core',
      state: 'unavailable',
      reason: detail,
      probeLatencyMs: latency,
      operations: ['explorer.dependencies.recheck'],
      metrics: { coreVersion: info.coreVersion },
    });
  }
  if (!sync) {
    return component({
      id: 'bitcoin-core',
      kind: 'node',
      name: 'Bitcoin Core',
      state: 'unknown',
      reason: 'Bitcoin Core answered, but its sync state has not been read yet.',
      probeLatencyMs: latency,
      operations: ['explorer.dependencies.recheck'],
      metrics: { coreVersion: info.coreVersion },
    });
  }
  const behind = Math.max(0, sync.headers - sync.blocks);
  return component({
    id: 'bitcoin-core',
    kind: 'node',
    name: 'Bitcoin Core',
    state: sync.initialBlockDownload ? 'syncing' : behind > 2 ? 'syncing' : 'healthy',
    reason: sync.initialBlockDownload
      ? `Bitcoin Core is still in initial block download and has verified ${Math.round(sync.verificationProgress * 100)}% of the chain. Every height this explorer shows is behind the present.`
      : behind > 2
        ? `Bitcoin Core has ${behind} headers it has not yet validated into blocks.`
        : null,
    lastSuccessAt: optionalAdminTimestamp(sync.checkedAt),
    probeLatencyMs: latency,
    chainTip: sync.headers,
    indexedTip: sync.blocks,
    lagBlocks: behind,
    maxLagBlocks: 2,
    operations: ['explorer.dependencies.recheck'],
    metrics: {
      coreVersion: info.coreVersion,
      initialBlockDownload: sync.initialBlockDownload,
      verificationProgress: Number(sync.verificationProgress.toFixed(6)),
    },
  });
}

/** @asyncSafe */
async function databaseComponent(): Promise<AdminComponentReport> {
  if (config.DATABASE.ENABLED !== true) {
    return component({
      id: 'explorer-database',
      kind: 'database',
      name: 'Explorer database',
      state: 'disabled_by_policy',
      reason: 'The database is switched off in this deployment.',
    });
  }
  const started = Date.now();
  try {
    await DB.query('SELECT 1');
    return component({
      id: 'explorer-database',
      kind: 'database',
      name: 'Explorer database',
      state: 'healthy',
      lastSuccessAt: adminTimestamp(),
      probeLatencyMs: Date.now() - started,
      operations: ['explorer.dependencies.recheck'],
    });
  } catch {
    return component({
      id: 'explorer-database',
      kind: 'database',
      name: 'Explorer database',
      state: 'unavailable',
      reason: 'The database did not answer a connectivity probe.',
      probeLatencyMs: Date.now() - started,
      operations: ['explorer.dependencies.recheck'],
    });
  }
}

function redisComponent(): AdminComponentReport {
  if (config.REDIS.ENABLED !== true) {
    return component({
      id: 'explorer-redis',
      kind: 'dependency',
      name: 'Redis cache',
      state: 'disabled_by_policy',
      reason: 'Redis is switched off in this deployment.',
    });
  }
  const connected = (redisCache as unknown as { connected?: boolean }).connected === true;
  return component({
    id: 'explorer-redis',
    kind: 'dependency',
    name: 'Redis cache',
    state: connected ? 'healthy' : 'unavailable',
    reason: connected ? null : 'Redis is configured but the client is not connected.',
    lastSuccessAt: connected ? adminTimestamp() : null,
    operations: ['explorer.dependencies.recheck'],
  });
}

function mempoolComponent(): AdminComponentReport {
  if (config.MEMPOOL.ENABLED !== true) {
    return component({
      id: 'mempool-sync',
      kind: 'indexer',
      name: 'Mempool sync',
      state: 'disabled_by_policy',
      reason: 'Mempool tracking is switched off in this deployment.',
    });
  }
  const info = memPool.getMempoolInfo();
  const lastUpdate = memPool.getLastMempoolUpdateAt();
  const ageSeconds = lastUpdate === null ? null : Math.max(0, Math.round((Date.now() - lastUpdate) / 1000));
  const size = Object.keys(memPool.getMempool()).length;
  const stale = ageSeconds !== null && ageSeconds > MEMPOOL_STALE_AFTER_SECONDS;
  return component({
    id: 'mempool-sync',
    kind: 'indexer',
    name: 'Mempool sync',
    state: ageSeconds === null ? (size > 0 ? 'healthy' : 'unknown') : stale ? 'stale' : 'healthy',
    reason:
      ageSeconds === null
        ? size > 0
          ? null
          : 'The mempool is empty and no update time has been recorded yet, so nothing about its freshness can be proven.'
        : stale
          ? `The mempool has not been updated for ${ageSeconds} seconds.`
          : null,
    lagSeconds: ageSeconds,
    queueDepth: size,
    dependsOn: ['bitcoin-core'],
    operations: ['explorer.capabilities.refresh'],
    metrics: {
      transactionCount: size,
      reportedSize: typeof info?.size === 'number' ? info.size : null,
      reportedBytes: typeof info?.bytes === 'number' ? info.bytes : null,
      transactionsPerSecond: memPool.getTxPerSecond(),
      vBytesPerSecond: memPool.getVBytesPerSecond(),
    },
  });
}

function blockPipelineComponent(): AdminComponentReport {
  const height = blocks.getCurrentBlockHeight();
  const sync = backendInfo.getBackendInfo().chainSync;
  const chainTip = sync?.blocks ?? null;
  const lag = chainTip !== null && height > 0 ? Math.max(0, chainTip - height) : null;
  const indicators = loadingIndicators.getLoadingIndicators();
  const loading = Object.keys(indicators).length > 0;
  return component({
    id: 'block-pipeline',
    kind: 'indexer',
    name: 'Block pipeline',
    state:
      height <= 0
        ? 'unknown'
        : lag !== null && lag > 2
          ? 'syncing'
          : loading
            ? 'syncing'
            : 'healthy',
    reason:
      height <= 0
        ? 'No block has been processed yet, so the pipeline cannot be described.'
        : lag !== null && lag > 2
          ? `The newest processed block is ${lag} behind the node.`
          : loading
            ? `Work in progress: ${Object.keys(indicators).join(', ')}.`
            : null,
    chainTip,
    indexedTip: height > 0 ? height : null,
    lagBlocks: lag,
    maxLagBlocks: 2,
    dependsOn: ['bitcoin-core'],
    operations: ['explorer.capabilities.refresh'],
    metrics: { loadingIndicators: Object.keys(indicators) },
  });
}

function feeComponent(): AdminComponentReport {
  let recommended: Record<string, unknown> | null = null;
  try {
    recommended = feeApi.getRecommendedFee() as unknown as Record<string, unknown>;
  } catch {
    recommended = null;
  }
  const projected = mempoolBlocks.getMempoolBlocks();
  const usable =
    recommended !== null && typeof recommended.fastestFee === 'number' && recommended.fastestFee > 0;
  return component({
    id: 'fee-estimates',
    kind: 'service',
    name: 'Fee estimates',
    state: usable ? 'healthy' : 'degraded',
    reason: usable
      ? null
      : 'The fee estimator has not produced a usable recommendation, so the fee box on the site is not trustworthy right now.',
    queueDepth: Array.isArray(projected) ? projected.length : null,
    dependsOn: ['mempool-sync'],
    operations: ['explorer.capabilities.refresh'],
    metrics: {
      fastestFee: typeof recommended?.fastestFee === 'number' ? recommended.fastestFee : null,
      halfHourFee: typeof recommended?.halfHourFee === 'number' ? recommended.halfHourFee : null,
      hourFee: typeof recommended?.hourFee === 'number' ? recommended.hourFee : null,
      minimumFee: typeof recommended?.minimumFee === 'number' ? recommended.minimumFee : null,
      projectedBlocks: Array.isArray(projected) ? projected.length : 0,
    },
  });
}

function websocketComponent(): AdminComponentReport {
  const clients = websocketHandler.getNumClients();
  return component({
    id: 'websocket',
    kind: 'service',
    name: 'WebSocket stream',
    state: 'healthy',
    lastSuccessAt: adminTimestamp(),
    metrics: { clients },
  });
}

function poolsComponent(): AdminComponentReport {
  const lastRun = (poolsUpdater as unknown as { lastRun?: number }).lastRun ?? 0;
  const sha = (poolsUpdater as unknown as { currentSha?: string | null }).currentSha ?? null;
  const ageSeconds = lastRun > 0 ? Math.max(0, Math.round((Date.now() - lastRun) / 1000)) : null;
  return component({
    id: 'mining-pool-metadata',
    kind: 'dependency',
    name: 'Mining pool metadata',
    state:
      sha === null
        ? 'unknown'
        : ageSeconds !== null && ageSeconds > POOLS_STALE_AFTER_SECONDS
          ? 'stale'
          : 'healthy',
    reason:
      sha === null
        ? 'No pool metadata revision has been recorded, so block attribution cannot be trusted.'
        : ageSeconds !== null && ageSeconds > POOLS_STALE_AFTER_SECONDS
          ? `Pool metadata has not been refreshed for ${Math.round(ageSeconds / 86_400)} days.`
          : null,
    lastSuccessAt: lastRun > 0 ? adminTimestamp(new Date(lastRun)) : null,
    lagSeconds: ageSeconds,
    operations: ['explorer.pools.refresh'],
    metrics: { revision: sha },
  });
}

function priceComponent(): AdminComponentReport {
  if (config.FIAT_PRICE.ENABLED !== true) {
    return component({
      id: 'price-feed',
      kind: 'dependency',
      name: 'Price feed',
      state: 'disabled_by_policy',
      reason: 'Fiat prices are switched off in this deployment.',
    });
  }
  const latest = priceUpdater.getLatestPrices() as unknown as { time?: number; USD?: number };
  const ageSeconds = typeof latest?.time === 'number' ? secondsSince(latest.time * 1000) : null;
  const hasPrice = typeof latest?.USD === 'number' && latest.USD > 0;
  return component({
    id: 'price-feed',
    kind: 'dependency',
    name: 'Price feed',
    state: !hasPrice
      ? 'unavailable'
      : ageSeconds !== null && ageSeconds > PRICE_STALE_AFTER_SECONDS
        ? 'stale'
        : 'healthy',
    reason: !hasPrice
      ? 'No usable price has been stored, so fiat values on the site are not current.'
      : ageSeconds !== null && ageSeconds > PRICE_STALE_AFTER_SECONDS
        ? `The newest price is ${Math.round(ageSeconds / 3_600)} hours old.`
        : null,
    lastSuccessAt: typeof latest?.time === 'number' ? adminTimestamp(new Date(latest.time * 1000)) : null,
    lagSeconds: ageSeconds,
    operations: ['explorer.prices.refresh'],
    metrics: { usd: typeof latest?.USD === 'number' ? latest.USD : null },
  });
}

function indexerComponent(): AdminComponentReport {
  const running = indexer.indexerIsRunning();
  return component({
    id: 'block-indexer',
    kind: 'indexer',
    name: 'Block indexer',
    state: config.DATABASE.ENABLED !== true ? 'disabled_by_policy' : running ? 'syncing' : 'healthy',
    reason:
      config.DATABASE.ENABLED !== true
        ? 'Block indexing needs the database, which is switched off in this deployment.'
        : running
          ? 'An indexing task is running now.'
          : null,
    dependsOn: ['explorer-database', 'bitcoin-core'],
    operations: ['explorer.capabilities.refresh'],
    metrics: { running },
  });
}

function capabilityComponent(feature: string, report: CapabilityReport): AdminComponentReport {
  const state = capabilityState(report);
  return component({
    id: `capability-${feature}`,
    kind: feature === 'addressLookup' ? 'indexer' : 'service',
    name: capabilityLabel(feature),
    state,
    reason:
      report.degradedReason ??
      (report.enabled && !report.routesRegistered
        ? 'The feature is enabled in configuration but its routes were never mounted, so nothing can answer it.'
        : null),
    lastSuccessAt: report.lastSuccessfulUpdate,
    lagSeconds: report.lagSeconds,
    chainTip: report.bitcoinCoreTip ?? null,
    indexedTip: report.indexedTip ?? null,
    lagBlocks: report.lagBlocks ?? null,
    maxLagBlocks: report.maxLagBlocks ?? null,
    operations: ['explorer.capabilities.refresh'],
    metrics: {
      enabled: report.enabled,
      routesRegistered: report.routesRegistered,
      rowCount: report.rowCount,
      backendKind: report.backendKind ?? null,
      coverageFrom: report.coverage?.from ?? null,
      coverageTo: report.coverage?.to ?? null,
      dependencies: report.dependencies.map(
        (dependency) =>
          `${dependency.name}: ${dependency.configured ? 'configured' : 'not configured'}, ${dependency.reachable ? 'reachable' : 'unreachable'}`,
      ),
      sourceRelease: report.sourceRelease ?? null,
    },
  });
}

export function capabilityLabel(feature: string): string {
  switch (feature) {
    case 'statistics':
      return 'Mempool statistics';
    case 'mining':
      return 'Mining and hashrate';
    case 'addressLookup':
      return 'Address and UTXO lookup';
    case 'lightning':
      return 'Lightning network';
    case 'prices':
      return 'Fiat prices';
    case 'accelerations':
      return 'Accelerations';
    case 'wallets':
      return 'Hosted wallet services';
    case 'stratum':
      return 'Stratum';
    case 'liquid':
      return 'Liquid';
    default:
      return feature;
  }
}

/**
 * The whole Explorer, described once, in the shared vocabulary. Every value
 * comes from something this process actually measured or read.
 */
/** @asyncUnsafe The route handler turns a rejection into an exact answer. */
export async function buildExplorerSnapshot(): Promise<AdminSnapshot> {
  const [core, database, capabilityReport, disk] = await Promise.all([
    bitcoinCoreComponent(),
    databaseComponent(),
    capabilities.$report(),
    diskSnapshot(),
  ]);

  const dependencies = [core, database, redisComponent(), poolsComponent(), priceComponent()];
  const indexers = [
    mempoolComponent(),
    blockPipelineComponent(),
    indexerComponent(),
    ...Object.entries(capabilityReport.features)
      .filter(([feature]) => feature === 'addressLookup')
      .map(([feature, report]) => capabilityComponent(feature, report)),
  ];
  const services = [
    feeComponent(),
    websocketComponent(),
    ...Object.entries(capabilityReport.features)
      .filter(([feature]) => feature !== 'addressLookup')
      .map(([feature, report]) => capabilityComponent(feature, report)),
  ];

  const runtime = processSnapshot();
  const everything = [...services, ...dependencies, ...indexers];
  const worst = foldAdminHealthStates(everything.map((entry) => entry.state));
  const failing = everything.filter((entry) => entry.state === worst);

  return {
    ...adminEnvelope(),
    network: explorerNetwork(),
    release: explorerRelease(),
    health: {
      state: worst,
      summary:
        worst === 'healthy'
          ? `All ${everything.length} reported Explorer components are answering normally.`
          : `${failing.length} of ${everything.length} Explorer components are ${worst.replace(/_/g, ' ')}: ${failing.slice(0, 3).map((entry) => entry.name).join(', ')}.`,
      reason: worst === 'healthy' ? null : failing.find((entry) => entry.reason)?.reason ?? null,
    },
    components: services,
    dependencies,
    indexers,
    queues: [],
    workers: [],
    counters: {
      mempoolTransactions: Object.keys(memPool.getMempool()).length,
      blockHeight: blocks.getCurrentBlockHeight(),
      websocketClients: websocketHandler.getNumClients(),
      uptimeSeconds: runtime.uptimeSeconds,
      cpuCount: runtime.cpuCount,
      loadAverage1m: runtime.loadAverage1m,
      memoryUsedPercent: runtime.memoryUsedPercent,
      heapUsedBytes: runtime.heapUsedBytes,
      heapLimitBytes: runtime.heapLimitBytes,
      heapUsedPercent: runtime.heapUsedPercent,
      eventLoopLagMs: runtime.eventLoopLagMs,
      requestsInWindow: runtime.requestsInWindow,
      requestWindowSeconds: runtime.windowSeconds,
      latencyP50Ms: runtime.latencyP50Ms,
      latencyP95Ms: runtime.latencyP95Ms,
      errorRate: runtime.errorRate,
      diskTotalBytes: disk?.totalBytes ?? null,
      diskFreeBytes: disk?.freeBytes ?? null,
      diskUsedPercent: disk?.usedPercent ?? null,
      nodeVersion: runtime.nodeVersion,
    },
    attention: explorerAttention(everything, runtime, disk),
  };
}

export function explorerAttention(
  components: AdminComponentReport[],
  runtime: ReturnType<typeof processSnapshot>,
  disk: Awaited<ReturnType<typeof diskSnapshot>>,
): AdminAttentionItem[] {
  const items: AdminAttentionItem[] = [];
  for (const entry of components) {
    if (entry.state === 'healthy' || entry.state === 'disabled_by_policy') {
      continue;
    }
    items.push({
      id: `explorer-${entry.id}`,
      severity:
        entry.state === 'unavailable' ? 'critical' : entry.state === 'degraded' ? 'major' : 'minor',
      title: `${entry.name} is ${entry.state.replace(/_/g, ' ')}`,
      detail:
        entry.reason ??
        `The Explorer reports ${entry.name} as ${entry.state.replace(/_/g, ' ')} without a stated reason.`,
      resourceKind: entry.kind,
      resourceId: entry.id,
      suggestedOperationId: entry.operations[0] ?? null,
      since: entry.lastSuccessAt,
      userImpact:
        entry.lagBlocks && entry.lagBlocks > 0
          ? `Anything newer than ${entry.lagBlocks} blocks ago is not visible on the site yet.`
          : null,
    });
  }
  if (runtime.heapUsedPercent >= 90) {
    items.push({
      id: 'explorer-heap',
      severity: 'critical',
      title: 'The process is close to its heap limit',
      detail: `Heap use is ${runtime.heapUsedPercent}% of the ${Math.round(runtime.heapLimitBytes / 1_048_576)} MiB limit. The process will be killed rather than slow down when it runs out.`,
      resourceKind: 'service',
      resourceId: 'explorer-api',
      suggestedOperationId: null,
      since: null,
      userImpact: 'A restart would drop every open WebSocket stream.',
    });
  }
  if (runtime.eventLoopLagMs >= 1_000) {
    items.push({
      id: 'explorer-event-loop',
      severity: 'major',
      title: 'The event loop is blocked',
      detail: `Timers are firing ${runtime.eventLoopLagMs} ms late, so every request is queued behind whatever is holding the loop.`,
      resourceKind: 'service',
      resourceId: 'explorer-api',
      suggestedOperationId: null,
      since: null,
      userImpact: 'Pages and the WebSocket stream feel frozen while this lasts.',
    });
  }
  if (disk && disk.usedPercent >= 90) {
    items.push({
      id: 'explorer-disk',
      severity: 'critical',
      title: 'The data disk is nearly full',
      detail: `${disk.usedPercent}% of ${Math.round(disk.totalBytes / 1_073_741_824)} GiB is used at ${disk.path}. Indexing stops when it fills.`,
      resourceKind: 'service',
      resourceId: 'explorer-api',
      suggestedOperationId: null,
      since: null,
      userImpact: 'New blocks stop being indexed once writes start failing.',
    });
  }
  return items.slice(0, 100);
}
