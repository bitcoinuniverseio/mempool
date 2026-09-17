import { randomUUID } from 'crypto';
import logger from '../../../logger';
import { endpointsForTransport, transportForMethod } from './private-relay.config';
import {
  ConfirmationLookup,
  PrivateRelayEndpoint,
  PrivateRelayLastOutcome,
  PrivateRelayStore,
  PrivateRelaySubmissionRow,
  PrivateRelayTransportAdapter,
  PrivateRelayWorkerStatus,
} from './private-relay.types';

/**
 * The leased relay worker.
 *
 * Each tick claims at most one queued row (or one `relaying` row whose lease a
 * crashed worker left behind), hands it to the transport for one endpoint of
 * the requested kind, and settles the row from the outcome. A retryable
 * failure returns the row to `queued` with a backoff lease so the next claim
 * waits; a node rejection or exhausted attempts ends in `rejected`. Submitted
 * rows are then polled against the owned node on a bounded cadence until they
 * confirm or the tracking window closes.
 *
 * Log lines carry submission ids and outcome kinds only. Raw transactions and
 * owner tokens never reach the logger.
 */
export interface PrivateRelayWorkerOptions {
  store: PrivateRelayStore;
  transport: PrivateRelayTransportAdapter;
  endpoints: PrivateRelayEndpoint[];
  network: string;
  confirmation: ConfirmationLookup;
  now?: () => number;
  workerId?: string;
  maxAttempts?: number;
  leaseMs?: number;
  retryBackoffMs?: number;
  trackingIntervalMs?: number;
  trackingWindowMs?: number;
  probeIntervalMs?: number;
}

export class PrivateRelayWorker {
  public readonly workerId: string;
  private readonly store: PrivateRelayStore;
  private readonly transport: PrivateRelayTransportAdapter;
  private readonly endpoints: PrivateRelayEndpoint[];
  private readonly network: string;
  private readonly confirmation: ConfirmationLookup;
  private readonly now: () => number;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly retryBackoffMs: number;
  private readonly trackingIntervalMs: number;
  private readonly trackingWindowMs: number;
  private readonly probeIntervalMs: number;

  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickAt: string | null = null;
  private lastError: string | null = null;
  private lastRelay: PrivateRelayLastOutcome | null = null;
  private proxyReachable: Record<string, boolean | null> = {};
  private lastProbeAt = 0;
  private roundRobin = 0;

  constructor(options: PrivateRelayWorkerOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.endpoints = options.endpoints;
    this.network = options.network;
    this.confirmation = options.confirmation;
    this.now = options.now ?? (() => Date.now());
    this.workerId = options.workerId ?? randomUUID();
    this.maxAttempts = options.maxAttempts ?? 5;
    this.leaseMs = options.leaseMs ?? 120_000;
    this.retryBackoffMs = options.retryBackoffMs ?? 60_000;
    this.trackingIntervalMs = options.trackingIntervalMs ?? 60_000;
    this.trackingWindowMs = options.trackingWindowMs ?? 24 * 3600_000;
    this.probeIntervalMs = options.probeIntervalMs ?? 5 * 60_000;
    for (const endpoint of this.endpoints) this.proxyReachable[endpoint.id] = null;
  }

  public start(intervalMs = 2_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(error => logger.warn('private relay worker: ' + describe(error)));
    }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  public status(): PrivateRelayWorkerStatus {
    return {
      running: this.timer !== null,
      worker_id: this.workerId,
      last_tick_at: this.lastTickAt,
      last_error: this.lastError,
      last_relay: this.lastRelay ? { ...this.lastRelay } : null,
      proxy_reachable: { ...this.proxyReachable },
    };
  }

  /**
   * One pass: probe proxies when due, relay one claimable row, then advance
   * the submitted rows whose confirmation check is due.
   * @asyncUnsafe The interval handler logs a rejection; tests await it directly.
   */
  public async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.lastTickAt = new Date(this.now()).toISOString();
      await this.probeProxies();
      await this.relayOne();
      await this.trackSubmitted();
      this.lastError = null;
    } catch (error) {
      this.lastError = describe(error);
      throw error;
    } finally {
      this.ticking = false;
    }
  }

  /** @asyncUnsafe Probe failures are recorded in proxy_reachable, never thrown. */
  public async probeProxies(force = false): Promise<void> {
    if (!force && this.now() - this.lastProbeAt < this.probeIntervalMs) return;
    this.lastProbeAt = this.now();
    for (const endpoint of this.endpoints) {
      try {
        this.proxyReachable[endpoint.id] = await this.transport.probeProxy(endpoint);
      } catch {
        this.proxyReachable[endpoint.id] = false;
      }
    }
  }

  /** @asyncUnsafe Store rejections surface through tick(). */
  private async relayOne(): Promise<void> {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const row = await this.store.claimNext({
      network: this.network,
      states: ['queued', 'relaying'],
      workerId: this.workerId,
      nowIso,
      leaseUntilIso: new Date(nowMs + this.leaseMs).toISOString(),
      maxAttempts: this.maxAttempts,
    });
    if (!row) return;

    const endpoint = this.pickEndpoint(row);
    if (!endpoint) {
      await this.settleRejected(row, 'no-endpoint-for-method');
      return;
    }

    const outcome = await this.transport.submit(endpoint, row.raw_tx, row.txid);
    const settledAt = new Date(this.now()).toISOString();
    this.lastRelay = { endpoint_id: endpoint.id, transport: endpoint.transport, outcome: outcome.kind, at: settledAt };
    logger.info(`private relay: submission ${row.submission_id} via ${endpoint.id} -> ${outcome.kind} (attempt ${row.attempts})`);

    if (outcome.kind === 'submitted') {
      await this.store.settle({
        submissionId: row.submission_id, workerId: this.workerId, fromState: 'relaying', toState: 'submitted',
        nowIso: settledAt, leaseUntilIso: new Date(this.now() + this.trackingIntervalMs).toISOString(),
        relayEndpointId: endpoint.id, relayedAtIso: settledAt, lastError: null,
      });
      return;
    }
    if (outcome.kind === 'rejected') {
      await this.settleRejected(row, outcome.reason, endpoint.id);
      return;
    }
    if (row.attempts >= this.maxAttempts) {
      await this.settleRejected(row, 'relay-attempts-exhausted: ' + outcome.reason, endpoint.id);
      return;
    }
    await this.store.settle({
      submissionId: row.submission_id, workerId: this.workerId, fromState: 'relaying', toState: 'queued',
      nowIso: settledAt, leaseUntilIso: new Date(this.now() + this.retryBackoffMs).toISOString(),
      relayEndpointId: endpoint.id, lastError: outcome.reason,
    });
  }

  /** @asyncUnsafe Store rejections surface through tick(). */
  private async settleRejected(row: PrivateRelaySubmissionRow, reason: string, endpointId?: string): Promise<void> {
    await this.store.settle({
      submissionId: row.submission_id, workerId: this.workerId, fromState: 'relaying', toState: 'rejected',
      nowIso: new Date(this.now()).toISOString(), leaseUntilIso: null,
      relayEndpointId: endpointId ?? row.relay_endpoint_id, lastError: reason.slice(0, 500),
    });
  }

  private pickEndpoint(row: PrivateRelaySubmissionRow): PrivateRelayEndpoint | null {
    const transport = transportForMethod(row.method);
    if (!transport) return null;
    const candidates = endpointsForTransport(this.endpoints, transport);
    if (!candidates.length) return null;
    const reachable = candidates.filter(endpoint => this.proxyReachable[endpoint.id] !== false);
    const pool = reachable.length ? reachable : candidates;
    return pool[this.roundRobin++ % pool.length];
  }

  /** @asyncUnsafe Store rejections surface through tick(); node lookups are caught per row. */
  private async trackSubmitted(): Promise<void> {
    const nowMs = this.now();
    const due = await this.store.dueForTracking(this.network, new Date(nowMs).toISOString(), 20);
    for (const row of due) {
      let status: { confirmed: boolean; block_height?: number } | null = null;
      try {
        status = await this.confirmation(row.txid);
      } catch {
        status = null;
      }
      const checkedAt = new Date(this.now()).toISOString();
      if (status?.confirmed) {
        await this.store.advanceTracking({
          submissionId: row.submission_id, expectedUpdatedAtIso: row.updated_at, toState: 'confirmed',
          nowIso: checkedAt, leaseUntilIso: null, confirmedBlockHeight: status.block_height ?? null, lastError: null,
        });
        continue;
      }
      const relayedAtMs = row.relayed_at ? new Date(row.relayed_at).getTime() : nowMs;
      const windowClosed = nowMs - relayedAtMs > this.trackingWindowMs;
      await this.store.advanceTracking({
        submissionId: row.submission_id, expectedUpdatedAtIso: row.updated_at, toState: 'submitted',
        nowIso: checkedAt, leaseUntilIso: windowClosed ? null : new Date(this.now() + this.trackingIntervalMs).toISOString(),
        lastError: windowClosed ? 'confirmation-tracking-window-closed' : undefined,
      });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
