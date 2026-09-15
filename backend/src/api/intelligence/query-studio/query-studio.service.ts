import { EventEnvelopeValidator } from '../events/event-envelope';
import config from '../../../config';
import { AuthenticatedOwner, IdentityError } from '../identity/developer-identity';
import { ownerStore } from '../identity/owner-store';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class QueryStudioEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const queryEngineUnavailable =
  'Query Studio results are unavailable. Query execution and the sandbox schema require the owned read-only analytics replica (UNIVERSE_QUERY_ENGINE_DSN) fed by the owned mempool and relay sensor tables, which is not connected on this deployment.';

export const usageMetricsUnavailable =
  'Developer usage metrics are unavailable. Request counts, quota and latency require the owned API gateway metrics store (UNIVERSE_API_GATEWAY_METRICS_ORIGIN), which is not connected on this deployment.';

export interface QueryExecutionResult {
  query_id: string;
  sql: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  execution_time_ms: number;
  truncated: boolean;
}

export interface TableColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  is_primary_key: boolean;
}

export interface TableSchemaInfo {
  table_name: string;
  description: string;
  columns: TableColumnSchema[];
  indexes: string[];
}

export interface SavedQueryRecord {
  query_id: string;
  owner_id: string;
  title: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

const SAVED_QUERY_LIMITS = { perOwner: 200, titleLength: 128, sqlLength: 16_384 } as const;

/**
 * Query Studio.
 *
 * Execution used to answer every SELECT with the same two invented rows, and
 * the schema described a sandbox that was never connected. Both now report
 * the analytics replica they would need. The SQL policy check stays because
 * it is a check on the caller's input, and saved queries and history stay
 * because they hold what callers submitted, minus the seeded example.
 */
export class QueryStudioService {
  private static instance: QueryStudioService;
  private queryHistory: Array<{ query_id: string; sql: string; executed_at: string; duration_ms: number }> = [];

  private constructor() {}

  public static getInstance(): QueryStudioService {
    if (!QueryStudioService.instance) {
      QueryStudioService.instance = new QueryStudioService();
    }
    return QueryStudioService.instance;
  }

  public getSchema(): TableSchemaInfo[] {
    throw new QueryStudioEvidenceError('unavailable-query-engine', queryEngineUnavailable);
  }

  public executeQuery(sql: string, maxRows = 100): QueryExecutionResult {
    void maxRows;
    const trimmed = sql.trim();

    // Strict validation: Only SELECT permitted
    const forbiddenKeywords = ['drop', 'delete', 'update', 'insert', 'alter', 'truncate', 'grant', 'revoke', 'create', 'execute', 'exec'];
    const normalized = trimmed.toLowerCase();

    if (!normalized.startsWith('select')) {
      throw new Error('Security policy violation: Only SELECT queries are permitted in Query Studio.');
    }

    if (trimmed.includes(';')) {
      const parts = trimmed.split(';').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        throw new Error('Security policy violation: Multiple statements are not permitted.');
      }
    }

    for (const kw of forbiddenKeywords) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      if (regex.test(normalized)) {
        throw new Error(`Security policy violation: Disallowed keyword '${kw}' detected.`);
      }
    }

    // The policy above is a check on the caller's SQL; the rows would come from
    // the analytics replica, and no replica is connected.
    throw new QueryStudioEvidenceError('unavailable-query-engine', queryEngineUnavailable);
  }

  public getHistory(): Array<{ query_id: string; sql: string; executed_at: string; duration_ms: number }> {
    return this.queryHistory;
  }

  /** @asyncUnsafe Saved queries are the owner's data: durable, owner and network scoped, bounded. */
  public async saveQuery(owner: AuthenticatedOwner, title: unknown, sql: unknown): Promise<SavedQueryRecord> {
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > SAVED_QUERY_LIMITS.titleLength) {
      throw new IdentityError('invalid_title', `title must be 1 to ${SAVED_QUERY_LIMITS.titleLength} characters`, 400);
    }
    if (typeof sql !== 'string' || sql.trim().length === 0 || sql.length > SAVED_QUERY_LIMITS.sqlLength) {
      throw new IdentityError('invalid_sql', `sql must be 1 to ${SAVED_QUERY_LIMITS.sqlLength} characters`, 400);
    }
    const store = ownerStore();
    if ((await store.countSavedQueries(owner.owner_id, config.MEMPOOL.NETWORK)) >= SAVED_QUERY_LIMITS.perOwner) {
      throw new IdentityError('quota', `an owner may keep at most ${SAVED_QUERY_LIMITS.perOwner} saved queries`, 409);
    }
    const now = new Date().toISOString();
    const row = { query_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: config.MEMPOOL.NETWORK, title: title.trim(), sql_text: sql, created_at: now, updated_at: now };
    await store.insertSavedQuery(row);
    return { query_id: row.query_id, owner_id: row.owner_id, title: row.title, sql: row.sql_text, created_at: row.created_at, updated_at: row.updated_at };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSavedQueries(owner: AuthenticatedOwner, limit = 100): Promise<SavedQueryRecord[]> {
    const rows = await ownerStore().listSavedQueries(owner.owner_id, config.MEMPOOL.NETWORK, Math.max(1, Math.min(200, limit)));
    return rows.map(row => ({ query_id: row.query_id, owner_id: row.owner_id, title: row.title, sql: row.sql_text, created_at: row.created_at, updated_at: row.updated_at }));
  }
}

export const queryStudioService = QueryStudioService.getInstance();
