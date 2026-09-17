import config from '../../../config';
import logger from '../../../logger';
import { PRIVATE_RELAY_ENDPOINTS_ENV, parsePrivateRelayEndpoints } from './private-relay.config';
import { MysqlPrivateRelayStore } from './private-relay.store';
import { SocksPrivateRelayTransport } from './private-relay.transport';
import { PrivateRelayEndpointSet, PrivateRelayStore } from './private-relay.types';
import { PrivateRelayWorker } from './private-relay.worker';

/**
 * The process-wide private relay wiring: the parsed endpoint set, the durable
 * store (only when the database is enabled), and the worker. The service reads
 * it lazily so tests can install a runtime with fakes; index.ts starts the
 * worker once the HTTP surface is up.
 */
export interface PrivateRelayRuntime {
  network: string;
  endpoints: PrivateRelayEndpointSet;
  /** null when config.DATABASE.ENABLED is false: the feature is unavailable, not in-memory. */
  store: PrivateRelayStore | null;
  worker: PrivateRelayWorker | null;
  coreVersion: () => string;
}

let runtime: PrivateRelayRuntime | null = null;

export function getPrivateRelayRuntime(): PrivateRelayRuntime {
  if (!runtime) runtime = buildRuntime();
  return runtime;
}

/** Tests install a runtime built on fakes; null restores the lazy default. */
export function setPrivateRelayRuntime(override: PrivateRelayRuntime | null): void {
  runtime = override;
}

/** Called from index.ts once the backend is serving. Safe to call when nothing is configured. */
export function startPrivateRelayWorker(): void {
  const current = getPrivateRelayRuntime();
  if (!current.worker) {
    const why = !current.store ? 'the database is disabled' : current.endpoints.unconfigured ? PRIVATE_RELAY_ENDPOINTS_ENV + ' is not set' : 'no declared endpoint is usable';
    logger.info('private relay worker not started: ' + why);
    return;
  }
  current.worker.start();
  logger.info(`private relay worker started for ${current.network} with ${current.endpoints.endpoints.length} endpoint(s)`);
}

function buildRuntime(): PrivateRelayRuntime {
  const network = config.MEMPOOL.NETWORK;
  const endpoints = parsePrivateRelayEndpoints(process.env[PRIVATE_RELAY_ENDPOINTS_ENV], network);
  for (const issue of endpoints.issues) {
    logger.warn(`private relay endpoint ${issue.id} ignored: ${issue.reason}`);
  }
  const store = config.DATABASE.ENABLED === true ? new MysqlPrivateRelayStore() : null;
  const worker = store && endpoints.endpoints.length
    ? new PrivateRelayWorker({
      store,
      transport: new SocksPrivateRelayTransport(),
      endpoints: endpoints.endpoints,
      network,
      confirmation: lookupConfirmation,
    })
    : null;
  return { network, endpoints, store, worker, coreVersion: readCoreVersion };
}

/** @asyncUnsafe The worker treats a rejection as "not observed yet". */
async function lookupConfirmation(txid: string): Promise<{ confirmed: boolean; block_height?: number } | null> {
  const bitcoinApi = (await import('../../bitcoin/bitcoin-api-factory')).default;
  const tx = await bitcoinApi.$getRawTransaction(txid);
  if (!tx?.status) return null;
  return { confirmed: tx.status.confirmed === true, block_height: tx.status.block_height };
}

function readCoreVersion(): string {
  try {
    // Loaded lazily: backend-info opens the Core RPC client on import.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const backendInfo = require('../../backend-info').default;
    return String(backendInfo.getBackendInfo()?.coreVersion ?? '?');
  } catch {
    return '?';
  }
}
