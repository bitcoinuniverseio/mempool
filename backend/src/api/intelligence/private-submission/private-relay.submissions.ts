import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { PRIVATE_RELAY_ENDPOINTS_ENV, endpointsForTransport, transportForMethod } from './private-relay.config';
import { PrivateRelayRuntime, getPrivateRelayRuntime } from './private-relay.runtime';
import {
  PrivateRelayStore,
  PrivateRelaySubmissionRow,
  PrivateSubmissionAuthorizationError,
  PrivateSubmissionNotFoundError,
} from './private-relay.types';
import { validatePrivateRelayTransaction } from './private-relay.validation';
import { PrivateBroadcastRecord, PrivateRelayOverview, SubmissionCapabilities } from './private-submission.models';
import { SubmissionInputError } from './submission-input';

/**
 * The service-facing operations behind the five private submission routes.
 *
 * Each one reads the runtime (store, endpoints, worker) and either answers
 * from durable state or throws a typed error the routes map to a status:
 * `durable-store-unavailable` when there is no database, `unavailable-relay`
 * when no owned endpoint serves the requested transport, `unauthorized` when
 * the owner token does not match, `not-found` for an unknown id.
 */
export class PrivateRelayUnavailableError extends Error {
  constructor(public readonly code: 'durable-store-unavailable' | 'unavailable-relay', message: string) {
    super(message);
  }
}

const QUEUE_LIMIT = 1000;

function requireStore(runtime: PrivateRelayRuntime): PrivateRelayStore {
  if (!runtime.store) {
    throw new PrivateRelayUnavailableError(
      'durable-store-unavailable',
      'Private submission needs the durable submission store, and config.DATABASE.ENABLED is false on this deployment.',
    );
  }
  return runtime.store;
}

function relayReason(runtime: PrivateRelayRuntime): string | null {
  if (runtime.endpoints.unconfigured) return PRIVATE_RELAY_ENDPOINTS_ENV + ' is not set';
  if (!runtime.endpoints.endpoints.length) return 'every declared endpoint was rejected';
  return null;
}

/** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
export async function privateRelayOverview(runtime: PrivateRelayRuntime = getPrivateRelayRuntime()): Promise<PrivateRelayOverview> {
  const store = requireStore(runtime);
  const worker = runtime.worker?.status() ?? null;
  const depth = await store.queueDepth(runtime.network);
  return {
    network: runtime.network,
    relay: {
      configured: runtime.endpoints.endpoints.length > 0,
      reason: relayReason(runtime),
      endpoints: runtime.endpoints.endpoints.map(endpoint => ({
        id: endpoint.id,
        transport: endpoint.transport,
        submit_host: new URL(endpoint.submitUrl).hostname,
        proxy_reachable: worker?.proxy_reachable[endpoint.id] ?? null,
      })),
      rejected_endpoints: runtime.endpoints.issues.map(issue => ({ id: issue.id, reason: issue.reason })),
    },
    queue: depth,
    worker: {
      running: worker?.running ?? false,
      last_tick_at: worker?.last_tick_at ?? null,
      last_error: worker?.last_error ?? null,
      last_relay: worker?.last_relay ?? null,
    },
  };
}

/** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
export async function privateRelayCapabilities(runtime: PrivateRelayRuntime = getPrivateRelayRuntime()): Promise<SubmissionCapabilities> {
  const store = requireStore(runtime);
  const worker = runtime.worker?.status() ?? null;
  const depth = await store.queueDepth(runtime.network);
  const tor = endpointsForTransport(runtime.endpoints.endpoints, 'tor');
  const i2p = endpointsForTransport(runtime.endpoints.endpoints, 'i2p');
  const anyReachable = (ids: string[]): boolean => ids.some(id => worker?.proxy_reachable[id] === true);
  return {
    public_p2p_enabled: false,
    privatebroadcast_tor_enabled: tor.length > 0,
    privatebroadcast_i2p_enabled: i2p.length > 0,
    core_version: runtime.coreVersion(),
    tor_active: (worker?.running ?? false) && anyReachable(tor.map(endpoint => endpoint.id)),
    i2p_active: (worker?.running ?? false) && anyReachable(i2p.map(endpoint => endpoint.id)),
    queue_limit: QUEUE_LIMIT,
    current_queue_count: depth.queued + depth.relaying,
  };
}

/** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
export async function submitPrivateRelay(
  submission: { raw_tx: string; method: string },
  runtime: PrivateRelayRuntime = getPrivateRelayRuntime(),
): Promise<PrivateBroadcastRecord> {
  const store = requireStore(runtime);
  const transport = transportForMethod(submission.method);
  if (!transport) {
    throw new SubmissionInputError('This route serves privatebroadcast_tor, privatebroadcast_i2p and configured_private_relay only.');
  }
  const reason = relayReason(runtime);
  if (reason) {
    throw new PrivateRelayUnavailableError('unavailable-relay', `Private broadcast is unavailable: ${reason}.`);
  }
  if (!endpointsForTransport(runtime.endpoints.endpoints, transport).length) {
    throw new PrivateRelayUnavailableError('unavailable-relay', `Private broadcast over ${transport} is unavailable: no owned ${transport} endpoint is configured.`);
  }
  const validated = validatePrivateRelayTransaction(submission.raw_tx);

  const depth = await store.queueDepth(runtime.network);
  if (depth.queued + depth.relaying >= QUEUE_LIMIT) {
    throw new PrivateRelayUnavailableError('unavailable-relay', `The private relay queue is full (${QUEUE_LIMIT}).`);
  }

  const ownerToken = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const { row, created } = await store.insertOrExisting({
    submission_id: randomUUID(),
    network: runtime.network,
    txid: validated.txid,
    raw_tx: validated.raw_tx,
    method: submission.method,
    state: 'queued',
    relay_endpoint_id: null,
    attempts: 0,
    lease_until: null,
    lease_owner: null,
    owner_token_hash: hashToken(ownerToken),
    created_at: now,
    updated_at: now,
    relayed_at: null,
    confirmed_block_height: null,
    last_error: null,
  });
  const record = toRecord(row);
  if (created) record.owner_token = ownerToken;
  else record.duplicate = true;
  return record;
}

/** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
export async function readPrivateRelaySubmission(
  submissionId: string,
  ownerToken: string | undefined,
  runtime: PrivateRelayRuntime = getPrivateRelayRuntime(),
): Promise<PrivateBroadcastRecord> {
  const store = requireStore(runtime);
  const row = await authorizedRow(store, submissionId, ownerToken);
  return toRecord(row);
}

/** @asyncUnsafe The route turns a rejection into an exact HTTP answer. */
export async function abortPrivateRelaySubmission(
  submissionId: string,
  ownerToken: string | undefined,
  runtime: PrivateRelayRuntime = getPrivateRelayRuntime(),
): Promise<{ success: boolean; status: string }> {
  const store = requireStore(runtime);
  const row = await authorizedRow(store, submissionId, ownerToken);
  if (row.state === 'cancelled') return { success: true, status: 'cancelled' };
  if (row.state === 'queued') {
    const cancelled = await store.cancelIfQueued(row.submission_id, new Date().toISOString());
    if (cancelled) return { success: true, status: 'cancelled' };
  }
  // The relay has started or finished: nothing here can take that back, and
  // the answer must not suggest otherwise.
  return { success: false, status: 'abort-too-late' };
}

/** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
async function authorizedRow(store: PrivateRelayStore, submissionId: string, ownerToken: string | undefined): Promise<PrivateRelaySubmissionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) throw new PrivateSubmissionNotFoundError();
  const row = await store.getById(submissionId);
  if (!row) throw new PrivateSubmissionNotFoundError();
  if (typeof ownerToken !== 'string' || !/^[0-9a-f]{64}$/i.test(ownerToken)) throw new PrivateSubmissionAuthorizationError();
  const presented = Buffer.from(hashToken(ownerToken), 'hex');
  const stored = Buffer.from(row.owner_token_hash, 'hex');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) throw new PrivateSubmissionAuthorizationError();
  return row;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token.toLowerCase(), 'utf8').digest('hex');
}

/** Readback never carries the raw transaction, the token hash or the lease. */
function toRecord(row: PrivateRelaySubmissionRow): PrivateBroadcastRecord {
  const record: PrivateBroadcastRecord = {
    submission_token: row.submission_id,
    txid: row.txid,
    method: row.method as PrivateBroadcastRecord['method'],
    network: row.network,
    queued_at_utc: row.created_at,
    updated_at_utc: row.updated_at,
    status: row.state,
    retry_count: row.attempts,
    can_abort: row.state === 'queued',
  };
  if (row.last_error) record.last_error = row.last_error;
  if (row.relay_endpoint_id) record.relay_endpoint_id = row.relay_endpoint_id;
  if (row.relayed_at) record.relayed_at_utc = row.relayed_at;
  if (row.confirmed_block_height !== null) record.confirmed_block_height = row.confirmed_block_height;
  return record;
}
