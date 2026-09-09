import config from '../../../config';
import DB from '../../../database';
import logger from '../../../logger';

/**
 * Durable records of every digest this deployment stamped.
 *
 * A stamp is a promise from a calendar that it will commit the digest to
 * Bitcoin later. The record keeps the proof the calendar returned, which
 * calendars answered, and what the upgrade and verification found afterwards,
 * so overview counts, anchors and batches are derived from things that
 * actually happened here and from nothing else.
 */
export type TimestampRecordStatus = 'pending' | 'anchored' | 'failed';

export interface TimestampCalendarContact {
  calendar_id: string;
  url: string;
  status: 'pending' | 'anchored' | 'unreachable';
  contacted_at: string;
  error?: string;
}

export interface TimestampRecord {
  record_id: string;
  digest_hex: string;
  algorithm: 'sha256';
  network: string;
  commitment_hex: string;
  proof_base64: string;
  status: TimestampRecordStatus;
  calendars: TimestampCalendarContact[];
  submitted_at: string;
  updated_at: string;
  last_upgrade_attempt_at?: string;
  anchor_block_height?: number;
  anchor_block_hash?: string;
  anchor_time_utc?: string;
  last_error?: string;
}

export interface TimestampRecordStats {
  total: number;
  anchored: number;
  pending: number;
  failed: number;
  stamped_24h: number;
  latest_anchor_height: number | null;
}

export interface TimestampRecordStore {
  readonly kind: 'mysql' | 'memory';
  insert(record: TimestampRecord): Promise<void>;
  update(record: TimestampRecord): Promise<void>;
  get(recordId: string): Promise<TimestampRecord | null>;
  findByDigest(digestHex: string, network: string): Promise<TimestampRecord[]>;
  recent(limit: number): Promise<TimestampRecord[]>;
  pendingForUpgrade(olderThan: string, limit: number): Promise<TimestampRecord[]>;
  anchored(limit: number): Promise<TimestampRecord[]>;
  stats(): Promise<TimestampRecordStats>;
}

const TABLE = 'universe_timestamp_records';

export class MysqlTimestampRecordStore implements TimestampRecordStore {
  public readonly kind = 'mysql' as const;

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insert(record: TimestampRecord): Promise<void> {
    await DB.query(
      `INSERT INTO ${TABLE} (record_id, digest_hex, network, commitment_hex, status, submitted_at, updated_at, anchor_block_height, document) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [record.record_id, record.digest_hex, record.network, record.commitment_hex, record.status, toDate(record.submitted_at), toDate(record.updated_at), record.anchor_block_height ?? null, JSON.stringify(record)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async update(record: TimestampRecord): Promise<void> {
    await DB.query(
      `UPDATE ${TABLE} SET status = ?, updated_at = ?, anchor_block_height = ?, document = ? WHERE record_id = ?`,
      [record.status, toDate(record.updated_at), record.anchor_block_height ?? null, JSON.stringify(record), record.record_id],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async get(recordId: string): Promise<TimestampRecord | null> {
    const [rows]: any[] = await DB.query(`SELECT document FROM ${TABLE} WHERE record_id = ? LIMIT 1`, [recordId]);
    return rows?.length ? parseDocument(rows[0].document) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findByDigest(digestHex: string, network: string): Promise<TimestampRecord[]> {
    const [rows]: any[] = await DB.query(`SELECT document FROM ${TABLE} WHERE digest_hex = ? AND network = ? ORDER BY submitted_at DESC LIMIT 50`, [digestHex, network]);
    return (rows ?? []).map((row: any) => parseDocument(row.document));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async recent(limit: number): Promise<TimestampRecord[]> {
    const [rows]: any[] = await DB.query(`SELECT document FROM ${TABLE} ORDER BY submitted_at DESC LIMIT ?`, [limit]);
    return (rows ?? []).map((row: any) => parseDocument(row.document));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async pendingForUpgrade(olderThan: string, limit: number): Promise<TimestampRecord[]> {
    const [rows]: any[] = await DB.query(`SELECT document FROM ${TABLE} WHERE status = 'pending' AND submitted_at <= ? ORDER BY updated_at ASC LIMIT ?`, [toDate(olderThan), limit]);
    return (rows ?? []).map((row: any) => parseDocument(row.document));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async anchored(limit: number): Promise<TimestampRecord[]> {
    const [rows]: any[] = await DB.query(`SELECT document FROM ${TABLE} WHERE status = 'anchored' ORDER BY anchor_block_height DESC, updated_at DESC LIMIT ?`, [limit]);
    return (rows ?? []).map((row: any) => parseDocument(row.document));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async stats(): Promise<TimestampRecordStats> {
    const [rows]: any[] = await DB.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'anchored') AS anchored,
              SUM(status = 'pending') AS pending,
              SUM(status = 'failed') AS failed,
              SUM(submitted_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)) AS stamped_24h,
              MAX(anchor_block_height) AS latest_anchor_height
         FROM ${TABLE}`,
    );
    const row = rows?.[0] ?? {};
    return {
      total: Number(row.total ?? 0), anchored: Number(row.anchored ?? 0), pending: Number(row.pending ?? 0), failed: Number(row.failed ?? 0),
      stamped_24h: Number(row.stamped_24h ?? 0), latest_anchor_height: row.latest_anchor_height === null || row.latest_anchor_height === undefined ? null : Number(row.latest_anchor_height),
    };
  }
}

/**
 * Process-local records for a deployment without a database. Not durable,
 * and the overview says so through its `storage` field.
 */
export class MemoryTimestampRecordStore implements TimestampRecordStore {
  public readonly kind = 'memory' as const;
  private readonly records = new Map<string, TimestampRecord>();

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insert(record: TimestampRecord): Promise<void> { this.records.set(record.record_id, clone(record)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async update(record: TimestampRecord): Promise<void> {
    if (!this.records.has(record.record_id)) {throw new Error(`Timestamp record ${record.record_id} does not exist.`);}
    this.records.set(record.record_id, clone(record));
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async get(recordId: string): Promise<TimestampRecord | null> { const record = this.records.get(recordId); return record ? clone(record) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findByDigest(digestHex: string, network: string): Promise<TimestampRecord[]> {
    return this.sorted().filter(record => record.digest_hex === digestHex && record.network === network).slice(0, 50);
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async recent(limit: number): Promise<TimestampRecord[]> { return this.sorted().slice(0, limit); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async pendingForUpgrade(olderThan: string, limit: number): Promise<TimestampRecord[]> {
    return this.sorted().filter(record => record.status === 'pending' && record.submitted_at <= olderThan).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async anchored(limit: number): Promise<TimestampRecord[]> {
    return this.sorted().filter(record => record.status === 'anchored').sort((a, b) => (b.anchor_block_height ?? 0) - (a.anchor_block_height ?? 0)).slice(0, limit);
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async stats(): Promise<TimestampRecordStats> {
    const all = [...this.records.values()];
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const heights = all.filter(record => record.anchor_block_height !== undefined).map(record => record.anchor_block_height as number);
    return {
      total: all.length, anchored: all.filter(r => r.status === 'anchored').length, pending: all.filter(r => r.status === 'pending').length,
      failed: all.filter(r => r.status === 'failed').length, stamped_24h: all.filter(r => r.submitted_at >= dayAgo).length,
      latest_anchor_height: heights.length ? Math.max(...heights) : null,
    };
  }
  private sorted(): TimestampRecord[] { return [...this.records.values()].map(clone).sort((a, b) => b.submitted_at.localeCompare(a.submitted_at)); }
}

export function defaultTimestampRecordStore(): TimestampRecordStore {
  if (config.DATABASE.ENABLED === true) {return new MysqlTimestampRecordStore();}
  logger.warn('OpenTimestamps records are kept in memory because config.DATABASE.ENABLED is false; they do not survive a restart.');
  return new MemoryTimestampRecordStore();
}

function toDate(iso: string): Date { return new Date(iso); }
function clone(record: TimestampRecord): TimestampRecord { return JSON.parse(JSON.stringify(record)); }
function parseDocument(document: unknown): TimestampRecord {
  if (typeof document === 'string') {return JSON.parse(document);}
  if (Buffer.isBuffer(document)) {return JSON.parse(document.toString('utf8'));}
  return document as TimestampRecord;
}
