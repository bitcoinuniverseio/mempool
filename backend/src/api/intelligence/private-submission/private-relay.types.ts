/**
 * Types shared by the private relay store, transport, worker and service.
 *
 * A private submission is a raw transaction the caller signed elsewhere and
 * asked this deployment to hand to an owned Tor or I2P relay endpoint. Nothing
 * here signs, nothing here falls back to a third-party broadcaster, and the
 * only place a raw transaction is kept is the durable row the worker retries
 * from.
 */
export type PrivateRelayTransport = 'tor' | 'i2p';

export type PrivateRelayState =
  | 'queued'
  | 'relaying'
  | 'submitted'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'abort-too-late';

/** One owned relay endpoint, as declared in UNIVERSE_PRIVATE_RELAY_ENDPOINTS. */
export interface PrivateRelayEndpoint {
  id: string;
  transport: PrivateRelayTransport;
  /** The owned SOCKS proxy in front of the Tor or I2P daemon, e.g. socks5h://127.0.0.1:9050. */
  proxy: string;
  /** The owned onion or i2p HTTP endpoint that accepts a raw hex transaction POST. */
  submitUrl: string;
  network: string;
  timeoutMs: number;
}

/** An endpoint entry that was declared but cannot be used, with the reason. */
export interface PrivateRelayEndpointIssue {
  id: string;
  reason: string;
}

export interface PrivateRelayEndpointSet {
  endpoints: PrivateRelayEndpoint[];
  issues: PrivateRelayEndpointIssue[];
  /** Set when the environment variable is absent or empty. */
  unconfigured: boolean;
}

/** A durable submission row. raw_tx never leaves the store except to the transport. */
export interface PrivateRelaySubmissionRow {
  submission_id: string;
  network: string;
  txid: string;
  raw_tx: string;
  method: string;
  state: PrivateRelayState;
  relay_endpoint_id: string | null;
  attempts: number;
  lease_until: string | null;
  lease_owner: string | null;
  owner_token_hash: string;
  created_at: string;
  updated_at: string;
  relayed_at: string | null;
  confirmed_block_height: number | null;
  last_error: string | null;
}

export interface PrivateRelayQueueDepth {
  queued: number;
  relaying: number;
  submitted: number;
  confirmed: number;
  rejected: number;
  cancelled: number;
}

/**
 * The durable store. Every mutation that decides between two outcomes (claim,
 * cancel, settle) is a compare-and-set on the row so two workers, or a worker
 * and an abort, cannot both win.
 */
export interface PrivateRelayStore {
  /** Inserts the row, or returns the existing row for the same network and txid. */
  insertOrExisting(row: PrivateRelaySubmissionRow): Promise<{ row: PrivateRelaySubmissionRow; created: boolean }>;
  getById(submissionId: string): Promise<PrivateRelaySubmissionRow | null>;
  /**
   * Claims one row whose lease has expired (or was never taken) in the given
   * states. Returns null when nothing is claimable.
   */
  claimNext(args: {
    network: string;
    states: PrivateRelayState[];
    workerId: string;
    nowIso: string;
    leaseUntilIso: string;
    maxAttempts: number;
  }): Promise<PrivateRelaySubmissionRow | null>;
  /**
   * Moves a row the worker holds to its next state. Returns false when the
   * row is no longer held by this worker in the expected state.
   */
  settle(args: {
    submissionId: string;
    workerId: string;
    fromState: PrivateRelayState;
    toState: PrivateRelayState;
    nowIso: string;
    leaseUntilIso: string | null;
    relayEndpointId?: string | null;
    relayedAtIso?: string | null;
    confirmedBlockHeight?: number | null;
    lastError?: string | null;
  }): Promise<boolean>;
  /**
   * Advances a `submitted` row after a confirmation check. The compare is on
   * updated_at so two trackers cannot both apply a result to the same read.
   */
  advanceTracking(args: {
    submissionId: string;
    expectedUpdatedAtIso: string;
    toState: 'submitted' | 'confirmed';
    nowIso: string;
    leaseUntilIso: string | null;
    confirmedBlockHeight?: number | null;
    lastError?: string | null;
  }): Promise<boolean>;
  /** queued -> cancelled, only while nothing has started relaying it. */
  cancelIfQueued(submissionId: string, nowIso: string): Promise<boolean>;
  /** Rows in `submitted` whose next confirmation check is due. */
  dueForTracking(network: string, nowIso: string, limit: number): Promise<PrivateRelaySubmissionRow[]>;
  queueDepth(network: string): Promise<PrivateRelayQueueDepth>;
}

export type PrivateRelayOutcome =
  | { kind: 'submitted'; txid: string; httpStatus: number }
  | { kind: 'rejected'; reason: string; httpStatus: number }
  | { kind: 'unreachable'; reason: string };

/** Sends a raw transaction through one endpoint. Never throws for relay outcomes. */
export interface PrivateRelayTransportAdapter {
  submit(endpoint: PrivateRelayEndpoint, rawTx: string, expectedTxid: string): Promise<PrivateRelayOutcome>;
  /** True when the endpoint's SOCKS proxy accepts a TCP connection. Does not open a circuit. */
  probeProxy(endpoint: PrivateRelayEndpoint): Promise<boolean>;
}

export interface PrivateRelayLastOutcome {
  endpoint_id: string;
  transport: PrivateRelayTransport;
  outcome: PrivateRelayOutcome['kind'];
  at: string;
}

export interface PrivateRelayWorkerStatus {
  running: boolean;
  worker_id: string;
  last_tick_at: string | null;
  last_error: string | null;
  last_relay: PrivateRelayLastOutcome | null;
  proxy_reachable: Record<string, boolean | null>;
}

export interface ConfirmationLookup {
  (txid: string): Promise<{ confirmed: boolean; block_height?: number } | null>;
}

/** The presented owner token does not match the record. The routes answer 403. */
export class PrivateSubmissionAuthorizationError extends Error {
  public readonly code = 'unauthorized';
  constructor(message = 'The owner token does not authorize this submission.') {
    super(message);
  }
}

/** No record carries this submission id. The routes answer 404. */
export class PrivateSubmissionNotFoundError extends Error {
  public readonly code = 'not-found';
  constructor(message = 'No private submission carries this id.') {
    super(message);
  }
}
