import DB from '../../../database';
import { NodeBootstrapJob, NodeBootstrapVerification } from './bootstrap.models';

/**
 * Durable, network-scoped records of verification runs and operator jobs.
 * Rows carry the backend's own network; a caller never chooses it. The JSON
 * document is the record; the columns exist for the reads and the claims.
 */
export interface BootstrapStore {
  readonly kind: 'mysql' | 'memory';
  insertVerification(record: NodeBootstrapVerification): Promise<void>;
  updateVerification(record: NodeBootstrapVerification): Promise<void>;
  getVerification(verificationId: string, network: string): Promise<NodeBootstrapVerification | null>;
  /** Newest run for a snapshot, whatever its state. */
  latestVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null>;
  /** A run that is still pending or verifying, so a duplicate request reuses it. */
  activeVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null>;
  /** Inserts, or returns the job already stored under the same idempotency key. */
  insertJob(job: NodeBootstrapJob): Promise<{ job: NodeBootstrapJob; created: boolean }>;
  getJob(jobId: string, network: string): Promise<NodeBootstrapJob | null>;
  /** A job still queued or running for this node, so two disruptive jobs never overlap. */
  activeJob(network: string, nodeId: string): Promise<NodeBootstrapJob | null>;
  /** Atomically leases the oldest queued job, or a running one whose lease lapsed. */
  claimJob(network: string, owner: string, nowIso: string, leaseMs: number): Promise<NodeBootstrapJob | null>;
  /** Writes the document only while this owner still holds the lease. */
  updateJob(job: NodeBootstrapJob, owner: string): Promise<boolean>;
}

export const VERIFICATIONS_TABLE = 'universe_bootstrap_verifications';
export const JOBS_TABLE = 'universe_bootstrap_jobs';

function toDate(iso: string): Date {
  return new Date(iso);
}
function parseDocument<T>(document: unknown): T {
  if (typeof document === 'string') {
    return JSON.parse(document);
  }
  if (Buffer.isBuffer(document)) {
    return JSON.parse(document.toString('utf8'));
  }
  return document as T;
}

export class MysqlBootstrapStore implements BootstrapStore {
  public readonly kind = 'mysql' as const;

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertVerification(record: NodeBootstrapVerification): Promise<void> {
    await DB.query(
      `INSERT INTO ${VERIFICATIONS_TABLE} (verification_id, snapshot_id, network, state, created_at, updated_at, document) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.verification_id, record.snapshot_id, record.network, record.state, toDate(record.requested_at), toDate(record.requested_at), JSON.stringify(record)]
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateVerification(record: NodeBootstrapVerification): Promise<void> {
    await DB.query(
      `UPDATE ${VERIFICATIONS_TABLE} SET state = ?, updated_at = ?, document = ? WHERE verification_id = ? AND network = ?`,
      [record.state, new Date(), JSON.stringify(record), record.verification_id, record.network]
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getVerification(verificationId: string, network: string): Promise<NodeBootstrapVerification | null> {
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${VERIFICATIONS_TABLE} WHERE verification_id = ? AND network = ? LIMIT 1`,
      [verificationId, network]
    );
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async latestVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null> {
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${VERIFICATIONS_TABLE} WHERE snapshot_id = ? AND network = ? ORDER BY created_at DESC LIMIT 1`,
      [snapshotId, network]
    );
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async activeVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null> {
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${VERIFICATIONS_TABLE} WHERE snapshot_id = ? AND network = ? AND state IN ('pending', 'verifying') ORDER BY created_at DESC LIMIT 1`,
      [snapshotId, network]
    );
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertJob(job: NodeBootstrapJob): Promise<{ job: NodeBootstrapJob; created: boolean }> {
    const [result]: any[] = await DB.query(
      `INSERT IGNORE INTO ${JOBS_TABLE} (job_id, network, node_id, job_type, idempotency_key, state, lease_owner, lease_expires_at, created_at, updated_at, document) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
      [job.job_id, job.network, job.node_id, job.job_type, job.idempotency_key, job.state, toDate(job.created_at), toDate(job.updated_at), JSON.stringify(job)]
    );
    if (Number(result?.affectedRows ?? 0) > 0) {
      return { job, created: true };
    }
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${JOBS_TABLE} WHERE network = ? AND idempotency_key = ? LIMIT 1`,
      [job.network, job.idempotency_key]
    );
    if (!rows?.length) {
      throw new Error('The job store neither inserted nor found the idempotent job.');
    }
    return { job: parseDocument(rows[0].document), created: false };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getJob(jobId: string, network: string): Promise<NodeBootstrapJob | null> {
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${JOBS_TABLE} WHERE job_id = ? AND network = ? LIMIT 1`,
      [jobId, network]
    );
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async activeJob(network: string, nodeId: string): Promise<NodeBootstrapJob | null> {
    const [rows]: any[] = await DB.query(
      `SELECT document FROM ${JOBS_TABLE} WHERE network = ? AND node_id = ? AND state IN ('queued', 'running') ORDER BY created_at ASC LIMIT 1`,
      [network, nodeId]
    );
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe The worker logs and retries on the next poll. */
  public async claimJob(network: string, owner: string, nowIso: string, leaseMs: number): Promise<NodeBootstrapJob | null> {
    const now = toDate(nowIso);
    const [rows]: any[] = await DB.query(
      `SELECT job_id FROM ${JOBS_TABLE} WHERE network = ? AND (state = 'queued' OR (state = 'running' AND lease_expires_at < ?)) ORDER BY created_at ASC LIMIT 1`,
      [network, now]
    );
    if (!rows?.length) {
      return null;
    }
    const jobId = rows[0].job_id;
    const expires = new Date(now.getTime() + leaseMs);
    const [result]: any[] = await DB.query(
      `UPDATE ${JOBS_TABLE} SET state = 'running', lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE job_id = ? AND network = ? AND (state = 'queued' OR (state = 'running' AND lease_expires_at < ?))`,
      [owner, expires, now, jobId, network, now]
    );
    if (Number(result?.affectedRows ?? 0) === 0) {
      return null;
    }
    const job = await this.getJob(jobId, network);
    if (!job) {
      return null;
    }
    job.state = 'running';
    job.status = 'running';
    job.lease = { owner, expires_at: expires.toISOString() };
    return job;
  }

  /** @asyncUnsafe The worker logs and retries on the next poll. */
  public async updateJob(job: NodeBootstrapJob, owner: string): Promise<boolean> {
    const [result]: any[] = await DB.query(
      `UPDATE ${JOBS_TABLE} SET state = ?, lease_owner = ?, lease_expires_at = ?, updated_at = ?, document = ? WHERE job_id = ? AND network = ? AND lease_owner = ?`,
      [job.state, job.lease?.owner ?? null, job.lease ? toDate(job.lease.expires_at) : null, toDate(job.updated_at), JSON.stringify(job), job.job_id, job.network, owner]
    );
    return Number(result?.affectedRows ?? 0) > 0;
  }
}

/** Test double with the same claim and lease semantics; never used in production. */
export class MemoryBootstrapStore implements BootstrapStore {
  public readonly kind = 'memory' as const;
  public readonly verifications = new Map<string, NodeBootstrapVerification>();
  public readonly jobs = new Map<string, NodeBootstrapJob>();
  private clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }
  async insertVerification(record: NodeBootstrapVerification): Promise<void> {
    this.verifications.set(record.verification_id, this.clone(record));
  }
  async updateVerification(record: NodeBootstrapVerification): Promise<void> {
    this.verifications.set(record.verification_id, this.clone(record));
  }
  async getVerification(id: string, network: string): Promise<NodeBootstrapVerification | null> {
    const found = this.verifications.get(id);
    return found && found.network === network ? this.clone(found) : null;
  }
  async latestVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null> {
    const all = [...this.verifications.values()].filter((v) => v.snapshot_id === snapshotId && v.network === network);
    all.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
    return all.length ? this.clone(all[0]) : null;
  }
  async activeVerification(snapshotId: string, network: string): Promise<NodeBootstrapVerification | null> {
    const found = [...this.verifications.values()].find(
      (v) => v.snapshot_id === snapshotId && v.network === network && (v.state === 'pending' || v.state === 'verifying')
    );
    return found ? this.clone(found) : null;
  }
  async insertJob(job: NodeBootstrapJob): Promise<{ job: NodeBootstrapJob; created: boolean }> {
    const existing = [...this.jobs.values()].find((j) => j.network === job.network && j.idempotency_key === job.idempotency_key);
    if (existing) {
      return { job: this.clone(existing), created: false };
    }
    this.jobs.set(job.job_id, this.clone(job));
    return { job, created: true };
  }
  async getJob(jobId: string, network: string): Promise<NodeBootstrapJob | null> {
    const found = this.jobs.get(jobId);
    return found && found.network === network ? this.clone(found) : null;
  }
  async activeJob(network: string, nodeId: string): Promise<NodeBootstrapJob | null> {
    const found = [...this.jobs.values()].find(
      (j) => j.network === network && j.node_id === nodeId && (j.state === 'queued' || j.state === 'running')
    );
    return found ? this.clone(found) : null;
  }
  async claimJob(network: string, owner: string, nowIso: string, leaseMs: number): Promise<NodeBootstrapJob | null> {
    const candidates = [...this.jobs.values()]
      .filter((j) => j.network === network && (j.state === 'queued' || (j.state === 'running' && !!j.lease && j.lease.expires_at < nowIso)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!candidates.length) {
      return null;
    }
    const job = candidates[0];
    job.state = 'running';
    job.status = 'running';
    job.lease = { owner, expires_at: new Date(Date.parse(nowIso) + leaseMs).toISOString() };
    job.updated_at = nowIso;
    return this.clone(job);
  }
  async updateJob(job: NodeBootstrapJob, owner: string): Promise<boolean> {
    const current = this.jobs.get(job.job_id);
    if (!current || current.lease?.owner !== owner) {
      return false;
    }
    this.jobs.set(job.job_id, this.clone(job));
    return true;
  }
}
