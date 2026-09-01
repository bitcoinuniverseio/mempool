import { randomUUID } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import type { AdminRun, AdminRunState } from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import DB from '../../database';
import logger from '../../logger';
import { adminTimestamp, optionalAdminTimestamp } from './admin-adapter.identity';

const { isAdminRunTerminal, isAdminRunTransitionAllowed, redactAdminPayload } =
  adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

/** How long a running operation may go silent before it is abandoned. */
const LEASE_MS = 120_000;
/** How long an advisory lock is held before another run may reclaim it. */
const LOCK_MS = 15 * 60_000;

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

function toRun(row: any): AdminRun {
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
    cancellable: Number(row.cancel_requested) === 0 && !isAdminRunTerminal(row.state),
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
  }): Promise<{ run: AdminRun; replayed: boolean }> {
    this.assertAvailable();
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(input.operationId, input.idempotencyKey);
      if (existing) {
        return { run: { ...existing, replayed: true }, replayed: true };
      }
    }
    const runId = randomUUID();
    const now = new Date();
    const document = emptyDocument(
      redactAdminPayload(input.redactedInput) as Record<string, unknown>,
    );
    document.rollback = { supported: input.rollbackSupported, state: null };
    await DB.query(
      'INSERT INTO admin_adapter_runs (run_id, operation_id, operation_version, state, target, correlation_id, idempotency_key, actor, reason, queued_at, updated_at, cancel_requested, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
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
        JSON.stringify(document),
      ],
    );
    const run = await this.get(runId);
    return { run: { ...run, cancellable: input.cancellable }, replayed: false };
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

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  async transition(
    runId: string,
    next: AdminRunState,
    patch: Partial<RunDocument> & { progressPercent?: number | null } = {},
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
    await DB.query(
      'UPDATE admin_adapter_runs SET state = ?, updated_at = ?, started_at = COALESCE(started_at, ?), finished_at = ?, heartbeat_at = ?, lease_expires_at = ?, progress_percent = ?, document = ? WHERE run_id = ?',
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
      ],
    );
    if (terminal) {
      await DB.query('DELETE FROM admin_adapter_locks WHERE run_id = ?', [runId]);
    }
    return this.get(runId);
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

  /** @asyncSafe */
  async reconcileAbandonedRuns(): Promise<number> {
    if (!this.available()) {
      return 0;
    }
    try {
      const [rows]: any[] = await DB.query(
        "SELECT run_id FROM admin_adapter_runs WHERE lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND state NOT IN ('SUCCEEDED','FAILED','CANCELLED','NEEDS_REVIEW','ROLLED_BACK','ROLLBACK_FAILED') LIMIT 200",
        [new Date()],
      );
      for (const row of rows) {
        await DB.query(
          "UPDATE admin_adapter_runs SET state = 'NEEDS_REVIEW', updated_at = ?, finished_at = ?, lease_expires_at = NULL WHERE run_id = ?",
          [new Date(), new Date(), row.run_id],
        );
        await DB.query('DELETE FROM admin_adapter_locks WHERE run_id = ?', [row.run_id]);
      }
      if (rows.length > 0) {
        logger.warn(
          `[admin-adapter] Moved ${rows.length} abandoned operation runs to NEEDS_REVIEW after their lease expired.`,
        );
      }
      return rows.length;
    } catch (e) {
      logger.debug('[admin-adapter] Could not reconcile abandoned runs: ' + (e instanceof Error ? e.message : e));
      return 0;
    }
  }

  /** @asyncUnsafe */
  async list(limit = 50): Promise<AdminRun[]> {
    if (!this.available()) {
      return [];
    }
    const bounded = Math.max(1, Math.min(200, limit));
    const [rows]: any[] = await DB.query(
      'SELECT * FROM admin_adapter_runs ORDER BY queued_at DESC LIMIT ?',
      [bounded],
    );
    return rows.map((row: any) => toRun(row));
  }

  /** Audit rows are derived from runs, so the two can never disagree. */
  /** @asyncUnsafe */
  async auditEntries(limit = 50, offset = 0): Promise<AdminRun[]> {
    if (!this.available()) {
      return [];
    }
    const boundedLimit = Math.max(1, Math.min(200, limit));
    const boundedOffset = Math.max(0, offset);
    const [rows]: any[] = await DB.query(
      'SELECT * FROM admin_adapter_runs ORDER BY queued_at DESC LIMIT ? OFFSET ?',
      [boundedLimit, boundedOffset],
    );
    return rows.map((row: any) => toRun(row));
  }
}

export default new AdminAdapterRunStore();
