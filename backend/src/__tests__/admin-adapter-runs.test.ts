/**
 * The durable run lifecycle against a small in-memory stand-in for the two
 * admin tables. The stand-in answers exactly the statements the store issues
 * and reproduces the one database behaviour the store relies on: a duplicate
 * primary key is an error, and an UPDATE reports how many rows it touched.
 */
const configState = { DATABASE: { ENABLED: true }, REDIS: { ENABLED: false } };
const clock = { now: Date.UTC(2026, 8, 17, 12, 0, 0) };

interface RunRow { [key: string]: any }
interface LockRow { lock_key: string; run_id: string; acquired_at: Date; expires_at: Date }

class DuplicateKey extends Error { code = 'ER_DUP_ENTRY'; errno = 1062; }

class FakeDb {
  runs = new Map<string, RunRow>();
  locks = new Map<string, LockRow>();
  failing: string | null = null;
  refuseReconcileUpdates = false;
  statements: string[] = [];

  private abandoned(row: RunRow, now: Date, cutoff: Date): boolean {
    const open = !['SUCCEEDED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW', 'ROLLED_BACK', 'ROLLBACK_FAILED'].includes(row.state);
    if (!open) return false;
    if (row.lease_expires_at !== null) return row.lease_expires_at.getTime() <= now.getTime();
    return row.state === 'QUEUED' && row.queued_at.getTime() <= cutoff.getTime();
  }

  /** @asyncUnsafe test double */
  async query(sql: string, params: any[] = []): Promise<any> {
    this.statements.push(sql);
    if (this.failing !== null) {
      throw new Error(this.failing);
    }
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO admin_adapter_runs')) {
      const columns = s.slice(s.indexOf('(') + 1, s.indexOf(')')).split(',').map((c) => c.trim());
      const row: RunRow = {
        run_id: null, operation_id: null, operation_version: null, state: null, target: null, correlation_id: null,
        idempotency_key: null, actor: null, reason: null, queued_at: null, started_at: null, updated_at: null,
        finished_at: null, heartbeat_at: null, lease_expires_at: null, owner_token: null, progress_percent: null,
        cancel_requested: 0, document: null,
      };
      let index = 0;
      for (const column of columns) {
        if (column === 'cancel_requested') { row.cancel_requested = 0; continue; }
        row[column] = params[index++];
      }
      if (this.runs.has(row.run_id)) throw new DuplicateKey('dup');
      this.runs.set(row.run_id, row);
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT * FROM admin_adapter_runs WHERE run_id = ?')) {
      const row = this.runs.get(params[0]);
      return [row ? [{ ...row }] : []];
    }
    if (s.startsWith('SELECT * FROM admin_adapter_runs WHERE operation_id = ? AND idempotency_key = ?')) {
      const found = [...this.runs.values()].find((r) => r.operation_id === params[0] && r.idempotency_key === params[1]);
      return [found ? [{ ...found }] : []];
    }
    if (s.startsWith('SELECT document FROM admin_adapter_runs WHERE run_id = ?')) {
      const row = this.runs.get(params[0]);
      return [row ? [{ document: row.document }] : []];
    }
    if (s.startsWith('SELECT cancel_requested FROM admin_adapter_runs')) {
      const row = this.runs.get(params[0]);
      return [row ? [{ cancel_requested: row.cancel_requested }] : []];
    }
    if (s.startsWith('UPDATE admin_adapter_runs SET cancel_requested = 1')) {
      const row = this.runs.get(params[1]);
      if (row) { row.cancel_requested = 1; row.updated_at = params[0]; }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (s.startsWith('UPDATE admin_adapter_runs SET state = ?, updated_at = ?, started_at = COALESCE')) {
      const [state, updatedAt, startedAt, finishedAt, heartbeatAt, lease, progress, document, runId, expectedState, ownerToken] = params;
      const row = this.runs.get(runId);
      const guarded = s.includes('AND state = ? AND owner_token = ?');
      if (!row || (guarded && (row.state !== expectedState || row.owner_token !== ownerToken))) {
        return [{ affectedRows: 0 }];
      }
      Object.assign(row, {
        state, updated_at: updatedAt, started_at: row.started_at ?? startedAt, finished_at: finishedAt,
        heartbeat_at: heartbeatAt, lease_expires_at: lease, progress_percent: progress, document,
      });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('UPDATE admin_adapter_runs SET heartbeat_at = ?')) {
      const [heartbeatAt, updatedAt, lease, runId, ownerToken] = params;
      const row = this.runs.get(runId);
      if (!row || row.state !== 'RUNNING' || row.owner_token !== ownerToken) return [{ affectedRows: 0 }];
      Object.assign(row, { heartbeat_at: heartbeatAt, updated_at: updatedAt, lease_expires_at: lease });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT run_id, state FROM admin_adapter_runs WHERE')) {
      const [now, cutoff] = params;
      const limit = Number(/LIMIT (\d+)/.exec(s)?.[1] ?? 200);
      const rows = [...this.runs.values()].filter((r) => this.abandoned(r, now, cutoff)).slice(0, limit);
      return [rows.map((r) => ({ run_id: r.run_id, state: r.state }))];
    }
    if (s.startsWith('SELECT COUNT(*) AS remaining FROM admin_adapter_runs WHERE')) {
      const [now, cutoff] = params;
      return [[{ remaining: [...this.runs.values()].filter((r) => this.abandoned(r, now, cutoff)).length }]];
    }
    if (s.startsWith('UPDATE admin_adapter_runs SET state = ?, updated_at = ?, finished_at = ?, lease_expires_at = NULL, document = JSON_SET')) {
      const [state, updatedAt, finishedAt, errorClass, message, retryable, runId, now, cutoff] = params;
      const row = this.runs.get(runId);
      if (!row || this.refuseReconcileUpdates || !this.abandoned(row, now, cutoff)) return [{ affectedRows: 0 }];
      const document = JSON.parse(row.document);
      document.error = { class: errorClass, message, retryable };
      Object.assign(row, { state, updated_at: updatedAt, finished_at: finishedAt, lease_expires_at: null, document: JSON.stringify(document) });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('DELETE FROM admin_adapter_locks WHERE expires_at <= ?')) {
      for (const [key, lock] of this.locks) if (lock.expires_at.getTime() <= params[0].getTime()) this.locks.delete(key);
      return [{ affectedRows: 0 }];
    }
    if (s.startsWith('DELETE FROM admin_adapter_locks WHERE run_id = ?')) {
      for (const [key, lock] of this.locks) if (lock.run_id === params[0]) this.locks.delete(key);
      return [{ affectedRows: 0 }];
    }
    if (s.startsWith('INSERT INTO admin_adapter_locks')) {
      const [lockKey, runId, acquiredAt, expiresAt] = params;
      if (this.locks.has(lockKey)) throw new DuplicateKey('dup');
      this.locks.set(lockKey, { lock_key: lockKey, run_id: runId, acquired_at: acquiredAt, expires_at: expiresAt });
      return [{ affectedRows: 1 }];
    }
    if (s.startsWith('SELECT run_id FROM admin_adapter_locks WHERE lock_key = ?')) {
      const lock = this.locks.get(params[0]);
      return [lock ? [{ run_id: lock.run_id }] : []];
    }
    if (s.startsWith('UPDATE admin_adapter_locks SET expires_at = ? WHERE run_id = ?')) {
      let touched = 0;
      for (const lock of this.locks.values()) if (lock.run_id === params[1]) { lock.expires_at = params[0]; touched++; }
      return [{ affectedRows: touched }];
    }
    if (s.startsWith('SELECT * FROM admin_adapter_runs WHERE LOCATE') || s.startsWith('SELECT * FROM admin_adapter_runs ORDER BY queued_at')) {
      return [[...this.runs.values()].map((r) => ({ ...r }))];
    }
    throw new Error('FakeDb does not understand: ' + s);
  }
}

const db = new FakeDb();

jest.mock('../config', () => ({ __esModule: true, default: configState }));
jest.mock('../database', () => ({ __esModule: true, default: { query: (sql: string, params?: any[]) => db.query(sql, params) } }));
jest.mock('../api/backend-info', () => ({ __esModule: true, default: { getBackendInfo: () => ({}) } }));

import runStore, { AdminRunConflict, HEARTBEAT_MS, LEASE_MS, toRun } from '../api/admin-adapter/admin-adapter.runs';

function creation(overrides: Record<string, any> = {}) {
  return {
    operationId: 'explorer.capabilities.refresh',
    operationVersion: '1',
    target: 'explorer/test/capabilities',
    actor: 'test',
    reason: null,
    correlationId: 'corr',
    idempotencyKey: null,
    cancellable: false,
    rollbackSupported: false,
    redactedInput: {},
    ...overrides,
  };
}

describe('admin adapter durable runs', () => {
  beforeEach(() => {
    db.runs.clear();
    db.locks.clear();
    db.failing = null;
    db.refuseReconcileUpdates = false;
    db.statements = [];
    jest.useFakeTimers({ now: clock.now });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a non-cancellable operation as non-cancellable and refuses to cancel it', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const { run, ownerToken } = await runStore.create(creation());
    expect(run.cancellable).toBe(false);
    expect(ownerToken).toMatch(/^[0-9a-f-]{36}$/);
    expect((await runStore.get(run.runId)).cancellable).toBe(false);
    await runStore.transition(run.runId, 'PRECHECK', {}, ownerToken as string);
    const running = await runStore.transition(run.runId, 'RUNNING', {}, ownerToken as string);
    expect(running.cancellable).toBe(false);
    await expect(runStore.requestCancel(run.runId)).rejects.toThrow(/does not support cancellation/);
    const after = await runStore.get(run.runId);
    expect(after.state).toBe('RUNNING');
    expect(db.runs.get(run.runId)?.cancel_requested).toBe(0);
    expect(await runStore.cancelRequested(run.runId)).toBe(false);
    // The lists read the same persisted truth.
    expect((await runStore.list())[0].cancellable).toBe(false);
    expect((await runStore.auditEntries())[0].cancellable).toBe(false);
  });

  it('reads an older row without the persisted flag as not cancellable', () => {
    const row = {
      run_id: 'legacy', operation_id: 'explorer.capabilities.refresh', operation_version: '1', state: 'RUNNING',
      target: 'explorer/test/capabilities', correlation_id: 'c', actor: 'a', cancel_requested: 0,
      queued_at: new Date(clock.now), updated_at: new Date(clock.now), progress_percent: 10, document: '{}',
    };
    expect(toRun(row).cancellable).toBe(false);
    expect(toRun({ ...row, document: JSON.stringify({ cancellable: true }) }).cancellable).toBe(true);
  });

  it('gives a new run an initial lease and recovers it as FAILED when that lease expires', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const { run, ownerToken } = await runStore.create(creation());
    await runStore.acquireLock('explorer:test', run.runId);
    const row = db.runs.get(run.runId) as RunRow;
    expect(row.lease_expires_at.getTime()).toBe(clock.now + LEASE_MS);
    expect(row.owner_token).toBe(ownerToken);

    // Nothing to do while the lease is live.
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 0, remaining: 0, verified: true });
    expect(db.locks.size).toBe(1);

    jest.setSystemTime(clock.now + LEASE_MS + 1);
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 1, remaining: 0, verified: true });
    const recovered = await runStore.get(run.runId);
    expect(recovered.state).toBe('FAILED');
    expect(recovered.error).toEqual({ class: 'abandoned_before_start', message: expect.stringContaining('nothing was executed'), retryable: true });
    expect(db.locks.size).toBe(0);
  });

  it('recovers a QUEUED row written before initial leases existed', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const { run } = await runStore.create(creation());
    const row = db.runs.get(run.runId) as RunRow;
    row.lease_expires_at = null;
    row.owner_token = null;
    row.queued_at = new Date(clock.now - LEASE_MS - 1);
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 1, remaining: 0, verified: true });
    expect((await runStore.get(run.runId)).state).toBe('FAILED');
  });

  it('records a lock conflict as a terminal, inspectable failure', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const first = await runStore.create(creation());
    await runStore.acquireLock('explorer:test:target', first.run.runId);
    const second = await runStore.create(creation());
    await expect(runStore.acquireLock('explorer:test:target', second.run.runId)).rejects.toThrow(AdminRunConflict);
    const failed = await runStore.transition(second.run.runId, 'FAILED', {
      error: { class: 'lock_conflict', message: 'held by ' + first.run.runId, retryable: true },
    }, second.ownerToken as string);
    expect(failed.state).toBe('FAILED');
    expect(failed.error?.class).toBe('lock_conflict');
    expect(failed.finishedAt).not.toBeNull();
    // The holder keeps its lock.
    expect(db.locks.get('explorer:test:target')?.run_id).toBe(first.run.runId);
  });

  it('refuses a transition from an executor whose run was taken over', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const { run, ownerToken } = await runStore.create(creation());
    await runStore.transition(run.runId, 'PRECHECK', {}, ownerToken as string);
    await runStore.transition(run.runId, 'RUNNING', {}, ownerToken as string);
    (db.runs.get(run.runId) as RunRow).owner_token = 'someone-else';
    await expect(runStore.transition(run.runId, 'VERIFYING', {}, ownerToken as string)).rejects.toThrow(/changed underneath/);
    expect((await runStore.get(run.runId)).state).toBe('RUNNING');
  });

  it('keeps a long run RUNNING and locked while its heartbeat continues', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    const { run, ownerToken } = await runStore.create(creation());
    await runStore.acquireLock('explorer:long', run.runId);
    await runStore.transition(run.runId, 'PRECHECK', {}, ownerToken as string);
    await runStore.transition(run.runId, 'RUNNING', {}, ownerToken as string);

    let finish: () => void = () => undefined;
    const work = new Promise<string>((resolve) => { finish = () => resolve('done'); });
    const running = runStore.withHeartbeat(run.runId, ownerToken as string, () => work);

    const durationMs = 150_000;
    for (let elapsed = 0; elapsed < durationMs; elapsed += HEARTBEAT_MS) {
      jest.advanceTimersByTime(HEARTBEAT_MS);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      // A reconciler passing at any point sees a live lease and leaves the run alone.
      expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 0, remaining: 0, verified: true });
      const row = db.runs.get(run.runId) as RunRow;
      expect(row.state).toBe('RUNNING');
      expect(row.lease_expires_at.getTime()).toBeGreaterThan(Date.now());
      expect(db.locks.get('explorer:long')?.run_id).toBe(run.runId);
    }
    finish();
    expect(await running).toBe('done');
    expect(jest.getTimerCount()).toBe(0);
    expect((db.runs.get(run.runId) as RunRow).heartbeat_at.getTime()).toBeGreaterThan(clock.now + durationMs - HEARTBEAT_MS - 1);

    // Once the executor stops heartbeating, the lease runs out and recovery moves it to review.
    jest.setSystemTime(Date.now() + LEASE_MS + 1);
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 1, remaining: 0, verified: true });
    const reviewed = await runStore.get(run.runId);
    expect(reviewed.state).toBe('NEEDS_REVIEW');
    expect(reviewed.error?.class).toBe('abandoned_in_flight');
    expect(db.locks.size).toBe(0);
  });

  it('drains a backlog larger than one batch and reports remaining truthfully', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    for (let i = 0; i < 201; i++) {
      await runStore.create(creation({ correlationId: `c${i}` }));
    }
    jest.setSystemTime(clock.now + LEASE_MS + 1);
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 201, remaining: 0, verified: true });

    for (let i = 0; i < 3; i++) {
      await runStore.create(creation({ correlationId: `late${i}` }));
    }
    jest.setSystemTime(Date.now() + LEASE_MS + 1);
    db.refuseReconcileUpdates = true;
    expect(await runStore.reconcileAbandonedRuns()).toEqual({ reconciled: 0, remaining: 3, verified: false });
  });

  it('surfaces a storage failure instead of claiming everything was reconciled', /** @asyncUnsafe Jest owns the test promise. */ async () => {
    await runStore.create(creation());
    jest.setSystemTime(clock.now + LEASE_MS + 1);
    db.failing = 'isolated unavailable database fixture';
    const outcome = await runStore.reconcileAbandonedRuns();
    expect(outcome).toEqual({ reconciled: 0, remaining: null, verified: false, error: 'isolated unavailable database fixture' });
  });
});
