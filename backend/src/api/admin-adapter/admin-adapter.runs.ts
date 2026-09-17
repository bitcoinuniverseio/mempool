import { randomUUID } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import type { AdminRun, AdminRunState } from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import DB from '../../database';
import logger from '../../logger';
import { adminTimestamp, optionalAdminTimestamp } from './admin-adapter.identity';

const { isAdminRunTerminal, isAdminRunTransitionAllowed, redactAdminPayload } =
  adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

/**
 * How long a run may go silent before it is abandoned.
 *
 * The catalog allows operations of up to 900 seconds, so the lease is not
 * sized to the operation. It is sized to the heartbeat: a live executor renews
 * it every HEARTBEAT_MS (well under LEASE_MS) for as long as its work runs, so
 * an abandoned run is noticed within LEASE_MS of the last heartbeat however
 * long the operation was allowed to take. A run inserted QUEUED gets the same
 * initial lease so a crash before the first transition is recovered too.
 */
export const LEASE_MS = 120_000;
/** How often a live executor renews its lease and lock. */
export const HEARTBEAT_MS = 30_000;
/** How long an advisory lock is held before another run may reclaim it. Renewed by the heartbeat. */
const LOCK_MS = 15 * 60_000;
/** How many expired runs one reconciliation pass handles per query. */
const RECONCILE_BATCH = 200;
/** How many batches one reconciliation pass may process before it reports what remains. */
const RECONCILE_MAX_BATCHES = 25;
/** States that are not terminal. Kept in one place so every query agrees. */
const OPEN_STATES_SQL = "state NOT IN ('SUCCEEDED','FAILED','CANCELLED','NEEDS_REVIEW','ROLLED_BACK','ROLLBACK_FAILED')";
/**
 * A run counts as abandoned when its lease expired, or, for rows written before
 * the initial lease existed, when it has sat QUEUED for longer than a lease.
 */
const ABANDONED_SQL = `${OPEN_STATES_SQL} AND ((lease_expires_at IS NOT NULL AND lease_expires_at <= ?) OR (lease_expires_at IS NULL AND state = 'QUEUED' AND queued_at <= ?))`;

export interface ReconcileResult {
  /** Runs moved to a terminal state by this pass. */
  reconciled: number;
  /** Runs with an expired lease still open after this pass; null when the count could not be read. */
  remaining: number | null;
  /** True only when every query answered and no expired run remains. */
  verified: boolean;
  /** The storage failure that stopped the pass, when one did. */
  error?: string;
}

export class AdminRunNotFound extends Error {}
export class AdminRunConflict extends Error {}

interface RunDocument {
  steps: AdminRun['steps'];
  logs: AdminRun['logs'];
  result: AdminRun['result'];
  verification: AdminRun['verification'];
  error: AdminRun['error'];
  rollback: AdminRun['rollback'];
  redactedInput: Record<string, unknown>;
  /** Persisted at creation from the catalog. Absent on older rows, which reads as false. */
  cancellable?: boolean;
}

function emptyDocument(redactedInput: Record<string, unknown> = {}): RunDocument {
  return {
    steps: [],
    logs: [],
    result: {},
    verification: { verified: false, evidence: [] },
    error: null,
    rollback: { supported: false, state: null },
    redactedInput,
    cancellable: false,
  };
}

function parseDocument(value: unknown): RunDocument {
  if (typeof value === 'string') {
    try {
      return { ...emptyDocument(), ...(JSON.parse(value) as RunDocument) };
    } catch {
      return emptyDocument();
    }
  }
  if (value && typeof value === 'object') {
    return { ...emptyDocument(), ...(value as RunDocument) };
  }
  return emptyDocument();
}

export function toRun(row: any): AdminRun {
  const document = parseDocument(row.document);
  return {
    runId: row.run_id,
    operationId: row.operation_id,
    operationVersion: row.operation_version,
    state: row.state as AdminRunState,
    target: row.target,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key ?? null,
    actor: row.actor,
    reason: row.reason ?? null,
    queuedAt: adminTimestamp(row.queued_at),
    startedAt: optionalAdminTimestamp(row.started_at),
    updatedAt: adminTimestamp(row.updated_at),
    finishedAt: optionalAdminTimestamp(row.finished_at),
    heartbeatAt: optionalAdminTimestamp(row.heartbeat_at),
    progressPercent: row.progress_percent === null ? null : Number(row.progress_percent),
    // Only what the catalog declared at creation, never inferred from the
    // absence of a cancel request. Older rows without the field read as false.
    cancellable: document.cancellable === true && Number(row.cancel_requested) === 0 && !isAdminRunTerminal(row.state),
    replayed: false,
    steps: document.steps,
    logs: document.logs,
    result: document.result,
    verification: document.verification,
    error: document.error,
    rollback: document.rollback,
  };
}

/**
 * Durable operation runs.
 *
 * The Control Center starts an operation here and polls for the outcome, so a
 * run has to survive a restart. A run whose lease expires without reaching a
 * terminal state becomes NEEDS_REVIEW, never a claimed success, because a
 * process that died mid-write cannot prove either outcome.
 *
 * Every method refuses rather than degrades when the database is switched off:
 * an operation whose record cannot be kept is an operation nobody can audit.
 */
class AdminAdapterRunStore {
  available(): boolean {
    return config.DATABASE.ENABLED === true;
  }

  private assertAvailable(): void {
    if (!this.available()) {
      throw new AdminRunConflict(
        'Operations need the explorer database to keep a durable record, and the database is switched off in this deployment.',
      );
    }
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  async create(input: {
    operationId: string;
    operationVersion: string;
    target: string;
    actor: string;
    reason: string | null;
    correlationId: string;
    idempotencyKey: string | null;
    cancellable: boolean;
    rollbackSupported: boolean;
    redactedInput: Record<string, unknown>;
  }): Promise<{ run: AdminRun; replayed: boolean; ownerToken: string | null }> {
    this.assertAvailable();
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.operationId, input.idempotencyKey);
      if (existing) {
        return { run: { ...existing, replayed: true }, replayed: true, ownerToken: null };
      }
    }
    const runId = randomUUID();
    const ownerToken = randomUUID();
    const now = new Date();
    const document = emptyDocument(
      redactAdminPayload(input.redactedInput) as Record<string, unknown>,
    );
    document.rollback = { supported: input.rollbackSupported, state: null };
    document.cancellable = input.cancellable === true;
    await DB.query(
      'INSERT INTO admin_adapter_runs (run_id, operation_id, operation_version, state, target, correlation_id, idempotency_key, actor, reason, queued_at, updated_at, lease_expires_at, owner_token, cancel_requested, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      [
        runId,
        input.operationId,
        input.operationVersion,
        'QUEUED',
        input.target,
        input.correlationId,
        input.idempotencyKey,
        input.actor,
        input.reason,
        now,
        now,
        new Date(now.getTime() + LEASE_MS),
        ownerToken,
        JSON.stringify(document),
      ],
    );
    const run = await this.get(runId);
    return { run, replayed: false, ownerToken };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  async get(runId: string): Promise<AdminRun> {
    this.assertAvailable();
    const [rows]: any[] = await DB.query('SELECT * FROM admin_adapter_runs WHERE run_id = ? LIMIT 1', [
      runId,
    ]);
    if (!rows[0]) {
      throw new AdminRunNotFound('No such operation run.');
    }
    return toRun(rows[0]);
  }

  /** @asyncUnsafe */
  private async findByIdempotencyKey(
    operationId: string,
    idempotencyKey: string,
  ): Promise<AdminRun | null> {
    const [rows]: any[] = await DB.query(
      'SELECT * FROM admin_adapter_runs WHERE operation_id = ? AND idempotency_key = ? LIMIT 1',
      [operationId, idempotencyKey],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  /**
   * Moves a run to its next state. With an owner token the update is a
   * compare-and-set on run id, the state just read and the token, so an
   * executor whose run was reconciled away underneath it gets a conflict
   * instead of overwriting the reviewer's record.
   *
   * @asyncUnsafe Callers turn a rejection into an exact HTTP answer.
   */
  async transition(
    runId: string,
    next: AdminRunState,
    patch: Partial<RunDocument> & { progressPercent?: number | null } = {},
    ownerToken?: string,
  ): Promise<AdminRun> {
    this.assertAvailable();
    const current = await this.get(runId);
    if (current.state !== next && !isAdminRunTransitionAllowed(current.state, next)) {
      throw new AdminRunConflict(`An operation run cannot move from ${current.state} to ${next}.`);
    }
    const [rows]: any[] = await DB.query('SELECT document FROM admin_adapter_runs WHERE run_id = ?', [
      runId,
    ]);
    const document = parseDocument(rows[0]?.document);
    if (patch.steps) { document.steps = patch.steps; }
    if (patch.logs) { document.logs = patch.logs; }
    if (patch.result) { document.result = patch.result; }
    if (patch.verification) { document.verification = patch.verification; }
    if (patch.error !== undefined) { document.error = patch.error; }
    if (patch.rollback) { document.rollback = patch.rollback; }

    const now = new Date();
    const terminal = isAdminRunTerminal(next);
    const guard = ownerToken === undefined ? '' : ' AND state = ? AND owner_token = ?';
    const [result]: any[] = await DB.query(
      `UPDATE admin_adapter_runs SET state = ?, updated_at = ?, started_at = COALESCE(started_at, ?), finished_at = ?, heartbeat_at = ?, lease_expires_at = ?, progress_percent = ?, document = ? WHERE run_id = ?${guard}`,
      [
        next,
        now,
        next === 'QUEUED' ? null : now,
        terminal ? now : null,
        now,
        terminal ? null : new Date(now.getTime() + LEASE_MS),
        patch.progressPercent === undefined ? current.progressPercent : patch.progressPercent,
        JSON.stringify(document),
        runId,
        ...(ownerToken === undefined ? [] : [current.state, ownerToken]),
      ],
    );
    if (ownerToken !== undefined && Number(result?.affectedRows ?? 0) !== 1) {
      throw new AdminRunConflict(
        `Run ${runId} changed underneath its executor (expected ${current.state}); its record was left as found.`,
      );
    }
    if (terminal) {
      await DB.query('DELETE FROM admin_adapter_locks WHERE run_id = ?', [runId]);
    }
    return this.get(runId);
  }

  /**
   * Renews the lease and lock of a RUNNING run, but only for the executor that
   * owns it. Returns false when the run is no longer RUNNING under this token,
   * which means a reconciler or another actor already took it over.
   *
   * @asyncUnsafe The heartbeat loop reports a rejection and keeps going.
   */
  async heartbeat(runId: string, ownerToken: string): Promise<boolean> {
    this.assertAvailable();
    const now = new Date();
    const [result]: any[] = await DB.query(
      "UPDATE admin_adapter_runs SET heartbeat_at = ?, updated_at = ?, lease_expires_at = ? WHERE run_id = ? AND state = 'RUNNING' AND owner_token = ?",
      [now, now, new Date(now.getTime() + LEASE_MS), runId, ownerToken],
    );
    if (Number(result?.affectedRows ?? 0) !== 1) {
      return false;
    }
    await DB.query('UPDATE admin_adapter_locks SET expires_at = ? WHERE run_id = ?', [
      new Date(now.getTime() + LOCK_MS),
      runId,
    ]);
    return true;
  }

  /**
   * Runs the operation while renewing its lease every HEARTBEAT_MS. The
   * rejection of the work itself is passed through untouched.
   *
   * @asyncUnsafe The caller turns a rejection of the work into a FAILED run.
   */
  async withHeartbeat<T>(runId: string, ownerToken: string, work: () => Promise<T>): Promise<T> {
    const timer = setInterval(() => {
      this.heartbeat(runId, ownerToken)
        .then((alive) => {
          if (!alive) {
            logger.warn(`[admin-adapter] Run ${runId} lost its lease while its operation was still running.`);
          }
        })
        .catch((e) => {
          logger.warn(`[admin-adapter] Run ${runId} could not renew its lease: ` + (e instanceof Error ? e.message : e));
        });
    }, HEARTBEAT_MS);
    timer.unref?.();
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  async requestCancel(runId: string): Promise<AdminRun> {
    const run = await this.get(runId);
    if (isAdminRunTerminal(run.state)) {
      throw new AdminRunConflict('This operation has already finished.');
    }
    if (!run.cancellable) {
      throw new AdminRunConflict('This operation does not support cancellation.');
    }
    await DB.query('UPDATE admin_adapter_runs SET cancel_requested = 1, updated_at = ? WHERE run_id = ?', [
      new Date(),
      runId,
    ]);
    return this.transition(runId, 'CANCEL_REQUESTED');
  }

  /** @asyncUnsafe */
  async cancelRequested(runId: string): Promise<boolean> {
    const [rows]: any[] = await DB.query(
      'SELECT cancel_requested FROM admin_adapter_runs WHERE run_id = ? LIMIT 1',
      [runId],
    );
    return Number(rows[0]?.cancel_requested ?? 0) === 1;
  }

  /** @asyncUnsafe A held lock is reported to the caller as a conflict. */
  async acquireLock(lockKey: string, runId: string): Promise<void> {
    this.assertAvailable();
    const now = new Date();
    await DB.query('DELETE FROM admin_adapter_locks WHERE expires_at <= ?', [now]);
    try {
      await DB.query(
        'INSERT INTO admin_adapter_locks (lock_key, run_id, acquired_at, expires_at) VALUES (?, ?, ?, ?)',
        [lockKey, runId, now, new Date(now.getTime() + LOCK_MS)],
      );
    } catch {
      const [rows]: any[] = await DB.query(
        'SELECT run_id FROM admin_adapter_locks WHERE lock_key = ? LIMIT 1',
        [lockKey],
      );
      throw new AdminRunConflict(
        `Another operation (${rows[0]?.run_id ?? 'unknown'}) is already working on this target. Wait for it to finish or cancel it first.`,
      );
    }
  }

  /**
   * Moves runs whose lease expired to a terminal state, in bounded batches.
   *
   * A run that never started (QUEUED or PRECHECK) becomes FAILED, the only
   * terminal state the contract allows from there; a run that was in flight
   * becomes NEEDS_REVIEW because nobody can prove what it did. Each update
   * re-checks the lease, so a run whose executor heartbeats between the read
   * and the write is left alone and keeps its lock.
   *
   * @asyncSafe Every storage failure is returned in the result, never thrown.
   */
  async reconcileAbandonedRuns(): Promise<ReconcileResult> {
    if (!this.available()) {
      return { reconciled: 0, remaining: null, verified: false, error: 'The explorer database is switched off.' };
    }
    let reconciled = 0;
    try {
      for (let batch = 0; batch < RECONCILE_MAX_BATCHES; batch++) {
        const now = new Date();
        const [rows]: any[] = await DB.query(
          `SELECT run_id, state FROM admin_adapter_runs WHERE ${ABANDONED_SQL} LIMIT ${RECONCILE_BATCH}`,
          [now, new Date(now.getTime() - LEASE_MS)],
        );
        if (!Array.isArray(rows) || rows.length === 0) {
          break;
        }
        let movedInBatch = 0;
        for (const row of rows) {
          const at = new Date();
          const neverStarted = row.state === 'QUEUED' || row.state === 'PRECHECK';
          const message = neverStarted
            ? 'The run was abandoned before its operation started; nothing was executed.'
            : 'The run went silent while its operation was in flight; the outcome is unknown.';
          const [result]: any[] = await DB.query(
            `UPDATE admin_adapter_runs SET state = ?, updated_at = ?, finished_at = ?, lease_expires_at = NULL, document = JSON_SET(document, '$.error', JSON_OBJECT('class', ?, 'message', ?, 'retryable', ?)) WHERE run_id = ? AND ${ABANDONED_SQL}`,
            [
              neverStarted ? 'FAILED' : 'NEEDS_REVIEW',
              at,
              at,
              neverStarted ? 'abandoned_before_start' : 'abandoned_in_flight',
              message,
              neverStarted,
              row.run_id,
              at,
              new Date(at.getTime() - LEASE_MS),
            ],
          );
          if (Number(result?.affectedRows ?? 0) === 1) {
            await DB.query('DELETE FROM admin_adapter_locks WHERE run_id = ?', [row.run_id]);
            movedInBatch++;
          }
        }
        reconciled += movedInBatch;
        if (rows.length < RECONCILE_BATCH) {
          break;
        }
        if (movedInBatch === 0) {
          // Every row in this batch was renewed under us; stop rather than spin.
          break;
        }
      }
      const now = new Date();
      const [countRows]: any[] = await DB.query(
        `SELECT COUNT(*) AS remaining FROM admin_adapter_runs WHERE ${ABANDONED_SQL}`,
        [now, new Date(now.getTime() - LEASE_MS)],
      );
      const remaining = Number(countRows?.[0]?.remaining ?? 0);
      if (reconciled > 0) {
        logger.warn(
          `[admin-adapter] Moved ${reconciled} abandoned operation runs to a terminal state after their lease expired${remaining > 0 ? `; ${remaining} remain` : ''}.`,
        );
      }
      return { reconciled, remaining, verified: remaining === 0 };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger.warn(`[admin-adapter] Could not reconcile abandoned runs after ${reconciled}: ` + error);
      return { reconciled, remaining: null, verified: false, error };
    }
  }

  /** @asyncUnsafe */
  async list(limit = 50, query = ''): Promise<AdminRun[]> {
    this.assertAvailable();
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const [rows]: any[] = await DB.query(
      "SELECT * FROM admin_adapter_runs WHERE LOCATE(?, LOWER(CONCAT_WS(' ', run_id, operation_id, target))) > 0 ORDER BY queued_at DESC LIMIT ?",
      [query.trim().toLowerCase().slice(0, 200), bounded],
    );
    return rows.map((row: any) => toRun(row));
  }

  /** Audit rows are derived from runs, so the two can never disagree. */
  /** @asyncUnsafe */
  async auditEntries(limit = 50, offset = 0): Promise<AdminRun[]> {
    this.assertAvailable();
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const boundedOffset = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
    const [rows]: any[] = await DB.query(
      'SELECT * FROM admin_adapter_runs ORDER BY queued_at DESC LIMIT ? OFFSET ?',
      [boundedLimit, boundedOffset],
    );
    return rows.map((row: any) => toRun(row));
  }
}

export default new AdminAdapterRunStore();
