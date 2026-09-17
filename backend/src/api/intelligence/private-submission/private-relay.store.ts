import DB from '../../../database';
import {
  PrivateRelayQueueDepth,
  PrivateRelayState,
  PrivateRelayStore,
  PrivateRelaySubmissionRow,
} from './private-relay.types';

/**
 * The durable submission queue in MySQL.
 *
 * Rows are keyed by (network, txid) so a second submission of the same
 * transaction finds the first. Every state change that competes with another
 * actor is a single UPDATE whose WHERE clause names the state (and, for a held
 * row, the worker holding it), and the caller reads affectedRows to learn
 * whether it won. There is no in-memory variant: without a database the
 * feature reports itself unavailable.
 */
export const PRIVATE_RELAY_TABLE = 'intelligence_private_relay_submissions';

const COLUMNS = [
  'submission_id', 'network', 'txid', 'raw_tx', 'method', 'state', 'relay_endpoint_id', 'attempts',
  'lease_until', 'lease_owner', 'owner_token_hash', 'created_at', 'updated_at', 'relayed_at',
  'confirmed_block_height', 'last_error',
].join(', ');

export class MysqlPrivateRelayStore implements PrivateRelayStore {
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertOrExisting(row: PrivateRelaySubmissionRow): Promise<{ row: PrivateRelaySubmissionRow; created: boolean }> {
    try {
      await DB.query(
        `INSERT INTO ${PRIVATE_RELAY_TABLE} (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.submission_id, row.network, row.txid, row.raw_tx, row.method, row.state, row.relay_endpoint_id, row.attempts,
          toDate(row.lease_until), row.lease_owner, row.owner_token_hash, toDate(row.created_at), toDate(row.updated_at),
          toDate(row.relayed_at), row.confirmed_block_height, row.last_error,
        ],
        'silent',
      );
      return { row, created: true };
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ER_DUP_ENTRY') throw error;
      const [rows]: any[] = await DB.query(
        `SELECT ${COLUMNS} FROM ${PRIVATE_RELAY_TABLE} WHERE network = ? AND txid = ? LIMIT 1`,
        [row.network, row.txid],
      );
      if (!rows?.length) throw error;
      return { row: fromRow(rows[0]), created: false };
    }
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getById(submissionId: string): Promise<PrivateRelaySubmissionRow | null> {
    const [rows]: any[] = await DB.query(
      `SELECT ${COLUMNS} FROM ${PRIVATE_RELAY_TABLE} WHERE submission_id = ? LIMIT 1`,
      [submissionId],
    );
    return rows?.length ? fromRow(rows[0]) : null;
  }

  /** @asyncUnsafe The worker logs a rejection and tries again on its next tick. */
  public async claimNext(args: {
    network: string;
    states: PrivateRelayState[];
    workerId: string;
    nowIso: string;
    leaseUntilIso: string;
    maxAttempts: number;
  }): Promise<PrivateRelaySubmissionRow | null> {
    const placeholders = args.states.map(() => '?').join(', ');
    const [candidates]: any[] = await DB.query(
      `SELECT ${COLUMNS} FROM ${PRIVATE_RELAY_TABLE}
        WHERE network = ? AND state IN (${placeholders}) AND attempts <= ?
          AND (lease_until IS NULL OR lease_until <= ?)
        ORDER BY created_at ASC LIMIT 5`,
      [args.network, ...args.states, args.maxAttempts, toDate(args.nowIso)],
    );
    for (const candidate of candidates ?? []) {
      const row = fromRow(candidate);
      const [result]: any[] = await DB.query(
        `UPDATE ${PRIVATE_RELAY_TABLE}
            SET state = 'relaying', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
          WHERE submission_id = ? AND state = ? AND updated_at = ? AND (lease_until IS NULL OR lease_until <= ?)`,
        [args.workerId, toDate(args.leaseUntilIso), toDate(args.nowIso), row.submission_id, row.state, toDate(row.updated_at), toDate(args.nowIso)],
      );
      if (Number(result?.affectedRows ?? 0) === 1) {
        return {
          ...row,
          state: 'relaying',
          lease_owner: args.workerId,
          lease_until: args.leaseUntilIso,
          attempts: row.attempts + 1,
          updated_at: args.nowIso,
        };
      }
    }
    return null;
  }

  /** @asyncUnsafe The worker logs a rejection and tries again on its next tick. */
  public async settle(args: {
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
  }): Promise<boolean> {
    const sets: string[] = ['state = ?', 'lease_until = ?', 'lease_owner = NULL', 'updated_at = ?'];
    const params: unknown[] = [args.toState, toDate(args.leaseUntilIso), toDate(args.nowIso)];
    if (args.relayEndpointId !== undefined) { sets.push('relay_endpoint_id = ?'); params.push(args.relayEndpointId); }
    if (args.relayedAtIso !== undefined) { sets.push('relayed_at = ?'); params.push(toDate(args.relayedAtIso)); }
    if (args.confirmedBlockHeight !== undefined) { sets.push('confirmed_block_height = ?'); params.push(args.confirmedBlockHeight); }
    if (args.lastError !== undefined) { sets.push('last_error = ?'); params.push(args.lastError); }
    params.push(args.submissionId, args.fromState, args.workerId);
    const [result]: any[] = await DB.query(
      `UPDATE ${PRIVATE_RELAY_TABLE} SET ${sets.join(', ')} WHERE submission_id = ? AND state = ? AND lease_owner = ?`,
      params,
    );
    return Number(result?.affectedRows ?? 0) === 1;
  }

  /** @asyncUnsafe The worker logs a rejection and tries again on its next tick. */
  public async advanceTracking(args: {
    submissionId: string;
    expectedUpdatedAtIso: string;
    toState: 'submitted' | 'confirmed';
    nowIso: string;
    leaseUntilIso: string | null;
    confirmedBlockHeight?: number | null;
    lastError?: string | null;
  }): Promise<boolean> {
    const sets: string[] = ['state = ?', 'lease_until = ?', 'updated_at = ?'];
    const params: unknown[] = [args.toState, toDate(args.leaseUntilIso), toDate(args.nowIso)];
    if (args.confirmedBlockHeight !== undefined) { sets.push('confirmed_block_height = ?'); params.push(args.confirmedBlockHeight); }
    if (args.lastError !== undefined) { sets.push('last_error = ?'); params.push(args.lastError); }
    params.push(args.submissionId, toDate(args.expectedUpdatedAtIso));
    const [result]: any[] = await DB.query(
      `UPDATE ${PRIVATE_RELAY_TABLE} SET ${sets.join(', ')} WHERE submission_id = ? AND state = 'submitted' AND updated_at = ?`,
      params,
    );
    return Number(result?.affectedRows ?? 0) === 1;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async cancelIfQueued(submissionId: string, nowIso: string): Promise<boolean> {
    const [result]: any[] = await DB.query(
      `UPDATE ${PRIVATE_RELAY_TABLE} SET state = 'cancelled', lease_until = NULL, lease_owner = NULL, updated_at = ?
        WHERE submission_id = ? AND state = 'queued'`,
      [toDate(nowIso), submissionId],
    );
    return Number(result?.affectedRows ?? 0) === 1;
  }

  /** @asyncUnsafe The worker logs a rejection and tries again on its next tick. */
  public async dueForTracking(network: string, nowIso: string, limit: number): Promise<PrivateRelaySubmissionRow[]> {
    const [rows]: any[] = await DB.query(
      `SELECT ${COLUMNS} FROM ${PRIVATE_RELAY_TABLE}
        WHERE network = ? AND state = 'submitted' AND lease_until IS NOT NULL AND lease_until <= ?
        ORDER BY lease_until ASC LIMIT ?`,
      [network, toDate(nowIso), limit],
    );
    return (rows ?? []).map(fromRow);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async queueDepth(network: string): Promise<PrivateRelayQueueDepth> {
    const [rows]: any[] = await DB.query(
      `SELECT state, COUNT(*) AS n FROM ${PRIVATE_RELAY_TABLE} WHERE network = ? GROUP BY state`,
      [network],
    );
    const depth: PrivateRelayQueueDepth = { queued: 0, relaying: 0, submitted: 0, confirmed: 0, rejected: 0, cancelled: 0 };
    for (const row of rows ?? []) {
      if (row.state in depth) depth[row.state as keyof PrivateRelayQueueDepth] = Number(row.n ?? 0);
    }
    return depth;
  }
}

function toDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fromRow(row: any): PrivateRelaySubmissionRow {
  return {
    submission_id: String(row.submission_id),
    network: String(row.network),
    txid: String(row.txid),
    raw_tx: String(row.raw_tx),
    method: String(row.method),
    state: String(row.state) as PrivateRelayState,
    relay_endpoint_id: row.relay_endpoint_id === null || row.relay_endpoint_id === undefined ? null : String(row.relay_endpoint_id),
    attempts: Number(row.attempts ?? 0),
    lease_until: toIso(row.lease_until),
    lease_owner: row.lease_owner === null || row.lease_owner === undefined ? null : String(row.lease_owner),
    owner_token_hash: String(row.owner_token_hash),
    created_at: toIso(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toIso(row.updated_at) ?? new Date(0).toISOString(),
    relayed_at: toIso(row.relayed_at),
    confirmed_block_height: row.confirmed_block_height === null || row.confirmed_block_height === undefined ? null : Number(row.confirmed_block_height),
    last_error: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
  };
}
