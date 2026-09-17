import { createHash } from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';
import config from '../../../config';
import { AuthenticatedOwner, IdentityError } from '../identity/developer-identity';
import { ownerStore } from '../identity/owner-store';
import { OwnerUsageLedger, ownerUsageLedger, OwnerUsageObservation, UsageLedgerCoverage } from '../identity/owner-usage-ledger';
import { parseSelect, QUERY_STUDIO_TABLES, QueryGrammarError, renderSelect } from './query-grammar';
import { QUERY_ENGINE_ENVIRONMENT_VARIABLE, QUERY_ENGINE_LIMITS, QueryEngine, QueryEngineError, queryEngineFromEnvironment } from './query-engine';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class QueryStudioEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503, public readonly reason: string | null = null) {
    super(message);
  }
}

/** A query the grammar refuses. The routes answer it with a 400. */
export class QueryPolicyError extends Error {
  constructor(message: string, public readonly position: number | null = null) {
    super('Security policy violation: ' + message);
  }
}

const queryEngineUnconfigured =
  `Query Studio results are unavailable. Query execution and the sandbox schema require the owned read-only analytics replica named by ${QUERY_ENGINE_ENVIRONMENT_VARIABLE}, which is not configured on this deployment.`;

export interface QueryExecutionResult {
  query_id: string;
  sql: string;
  executed_sql: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  execution_time_ms: number;
  truncated: boolean;
  next_cursor: string | null;
  source: { engine: string; table: string; network: string; deadline_ms: number; max_rows: number; result_bytes_limit: number };
  precision: string;
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

export interface QuerySchemaResult {
  network: string;
  source: string;
  observed_at: string;
  tables: TableSchemaInfo[];
  /** Allowlisted tables the replica does not currently carry. */
  missing_tables: string[];
  grammar: string;
}

export interface QueryHistoryEntry {
  query_id: string;
  owner_id: string;
  sql: string;
  executed_at: string;
  duration_ms: number;
  row_count: number;
  truncated: boolean;
}

export interface SavedQueryRecord {
  query_id: string;
  owner_id: string;
  title: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export interface DeveloperUsageResult {
  owner_id: string;
  network: string;
  state: 'observed' | 'no-observations';
  usage: Omit<OwnerUsageObservation, 'state' | 'owner_id'> | null;
  quota: { keys: Array<{ key_id: string; name: string; rate_limit_per_minute: number; last_used_at: string | null; revoked: boolean }>; source: string };
  coverage: UsageLedgerCoverage;
}

const SAVED_QUERY_LIMITS = { perOwner: 200, titleLength: 128, sqlLength: 16_384 } as const;
const HISTORY_LIMITS = { perOwner: 100, owners: 5_000 } as const;

const GRAMMAR_DESCRIPTION =
  'One SELECT over one readable table: columns or COUNT/SUM/AVG/MIN/MAX, WHERE with comparisons, IS NULL, IN, BETWEEN, LIKE, AND/OR/NOT, GROUP BY, ORDER BY, LIMIT and OFFSET. No joins, subqueries, comments, other functions, variables, writes or second statements.';

function cursorFor(sqlHash: string, offset: number): string {
  return Buffer.from(JSON.stringify({ h: sqlHash, o: offset }), 'utf8').toString('base64url');
}

function offsetFromCursor(cursor: unknown, sqlHash: string): number {
  if (cursor === undefined || cursor === null || cursor === '') { return 0; }
  if (typeof cursor !== 'string' || cursor.length > 256) { throw new QueryPolicyError('The cursor is not one this query issued.'); }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed?.h !== sqlHash || !Number.isSafeInteger(parsed?.o) || parsed.o < 0) { throw new Error('mismatch'); }
    return parsed.o;
  } catch {
    throw new QueryPolicyError('The cursor is not one this query issued.');
  }
}

/**
 * Query Studio.
 *
 * Execution parses the caller's SQL with the bounded grammar, renders the
 * statement itself and runs it on the read-only analytics engine with a
 * deadline, a row limit and a byte limit; the schema is discovered from the
 * same engine and intersected with the allowlist. Neither answers without
 * the engine. History is appended on every authenticated execution and read
 * back per owner. Saved queries are the owner's data, as before.
 */
export class QueryStudioService {
  private static instance: QueryStudioService;
  private queryHistory = new Map<string, QueryHistoryEntry[]>();
  private engineOverride: QueryEngine | null | undefined;

  private constructor(private readonly usageLedger: OwnerUsageLedger = ownerUsageLedger) {}

  public static getInstance(): QueryStudioService {
    if (!QueryStudioService.instance) {
      QueryStudioService.instance = new QueryStudioService();
    }
    return QueryStudioService.instance;
  }

  /** Test seam: an engine other than the one named by the environment. */
  public useEngine(engine: QueryEngine | null | undefined): void {
    this.engineOverride = engine;
    this.queryHistory.clear();
  }

  private engine(): QueryEngine {
    let engine: QueryEngine | null;
    try {
      engine = this.engineOverride !== undefined ? this.engineOverride : queryEngineFromEnvironment();
    } catch (e) {
      throw new QueryStudioEvidenceError('unavailable-query-engine', e instanceof Error ? e.message : String(e), 503, 'invalid-dsn');
    }
    if (!engine) {
      throw new QueryStudioEvidenceError('unavailable-query-engine', queryEngineUnconfigured, 503, 'unconfigured');
    }
    return engine;
  }

  private static translate(e: unknown): never {
    if (e instanceof QueryEngineError) {
      throw new QueryStudioEvidenceError('unavailable-query-engine', e.message, e.reason === 'deadline' ? 504 : 503, e.reason);
    }
    throw e;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSchema(): Promise<QuerySchemaResult> {
    const engine = this.engine();
    const allowed = Object.keys(QUERY_STUDIO_TABLES);
    let discovered;
    try {
      discovered = await engine.describe(allowed);
    } catch (e) {
      QueryStudioService.translate(e);
    }
    const present = new Set(discovered.map(table => table.table_name));
    return {
      network: config.MEMPOOL.NETWORK,
      source: engine.source,
      observed_at: new Date().toISOString(),
      tables: discovered.map(table => ({ ...table, description: QUERY_STUDIO_TABLES[table.table_name].description })),
      missing_tables: allowed.filter(name => !present.has(name)),
      grammar: GRAMMAR_DESCRIPTION,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async executeQuery(sql: string, maxRows: number = QUERY_ENGINE_LIMITS.defaultRows, cursor?: unknown, owner: AuthenticatedOwner | null = null): Promise<QueryExecutionResult> {
    let parsed;
    try {
      parsed = parseSelect(sql);
    } catch (e) {
      if (e instanceof QueryGrammarError) { throw new QueryPolicyError(e.message, e.position); }
      throw e;
    }
    if (!Number.isSafeInteger(maxRows) || maxRows < 1) { throw new QueryPolicyError('max_rows must be a positive integer.'); }
    const rowLimit = Math.min(maxRows, QUERY_ENGINE_LIMITS.maxRows);
    const sqlHash = createHash('sha256').update(sql).digest('hex').slice(0, 16);
    const offset = offsetFromCursor(cursor, sqlHash);
    const rendered = renderSelect(parsed, rowLimit, offset);
    const engine = this.engine();

    const startedAt = Date.now();
    let run;
    try {
      run = await engine.run(rendered, QUERY_ENGINE_LIMITS.statementDeadlineMs);
    } catch (e) {
      QueryStudioService.translate(e);
    }
    const durationMs = Date.now() - startedAt;

    // Row and byte limits: one row past the limit means more exist; bytes are
    // counted as the rows are serialised so a wide row set stops early.
    const rows: Array<Record<string, unknown>> = [];
    let bytes = 2;
    let truncated = run.rows.length > rowLimit;
    for (const row of run.rows.slice(0, rowLimit)) {
      bytes += Buffer.byteLength(JSON.stringify(row), 'utf8') + 1;
      if (bytes > QUERY_ENGINE_LIMITS.resultBytes) { truncated = true; break; }
      rows.push(row);
    }
    const queryId = EventEnvelopeValidator.generateUuidV7();
    if (owner) { this.appendHistory(owner.owner_id, { query_id: queryId, owner_id: owner.owner_id, sql, executed_at: new Date(startedAt).toISOString(), duration_ms: durationMs, row_count: rows.length, truncated }); }
    return {
      query_id: queryId,
      sql,
      executed_sql: rendered.sql,
      columns: run.columns,
      rows,
      row_count: rows.length,
      execution_time_ms: durationMs,
      truncated,
      next_cursor: truncated && rows.length > 0 ? cursorFor(sqlHash, offset + rows.length) : null,
      source: { engine: engine.source, table: rendered.table, network: config.MEMPOOL.NETWORK, deadline_ms: QUERY_ENGINE_LIMITS.statementDeadlineMs, max_rows: rowLimit, result_bytes_limit: QUERY_ENGINE_LIMITS.resultBytes },
      precision: 'BIGINT and DECIMAL values are returned as decimal strings; DOUBLE and FLOAT columns as IEEE numbers; timestamps as UTC strings.',
    };
  }

  private appendHistory(ownerId: string, entry: QueryHistoryEntry): void {
    let entries = this.queryHistory.get(ownerId);
    if (!entries) {
      if (this.queryHistory.size >= HISTORY_LIMITS.owners) {
        const oldest = this.queryHistory.keys().next().value;
        if (oldest !== undefined) { this.queryHistory.delete(oldest); }
      }
      entries = [];
    }
    this.queryHistory.delete(ownerId);
    this.queryHistory.set(ownerId, entries);
    entries.unshift(entry);
    if (entries.length > HISTORY_LIMITS.perOwner) { entries.length = HISTORY_LIMITS.perOwner; }
  }

  /** The owner's own executions, newest first. Unauthenticated executions are not retained. */
  public getHistory(owner: AuthenticatedOwner | null): QueryHistoryEntry[] {
    if (!owner) { return []; }
    return (this.queryHistory.get(owner.owner_id) ?? []).map(entry => ({ ...entry }));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getUsage(owner: AuthenticatedOwner): Promise<DeveloperUsageResult> {
    const keys = await ownerStore().listApiKeys(owner.owner_id, config.MEMPOOL.NETWORK);
    const observation = this.usageLedger.read(owner.owner_id);
    const { state, owner_id, ...usage } = observation as OwnerUsageObservation;
    void owner_id;
    return {
      owner_id: owner.owner_id,
      network: config.MEMPOOL.NETWORK,
      state,
      usage: state === 'observed' ? usage : null,
      quota: {
        keys: keys.map(key => ({ key_id: key.key_id, name: key.name, rate_limit_per_minute: key.rate_limit, last_used_at: key.last_used_at, revoked: key.revoked_at !== null })),
        source: 'Per-key rate limits and last-use timestamps from the durable owner store.',
      },
      coverage: this.usageLedger.coverage(),
    };
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
    const now = new Date().toISOString();
    const row = { query_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: config.MEMPOOL.NETWORK, title: title.trim(), sql_text: sql, created_at: now, updated_at: now };
    if (!await store.insertSavedQueryWithinQuota(row, SAVED_QUERY_LIMITS.perOwner)) throw new IdentityError('quota', 'Saved-query quota reached.', 409);
    return { query_id: row.query_id, owner_id: row.owner_id, title: row.title, sql: row.sql_text, created_at: row.created_at, updated_at: row.updated_at };
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async getSavedQueryPage(owner: AuthenticatedOwner, limit = 200, before?: string): Promise<{saved_queries: SavedQueryRecord[]; count:number; next_cursor:string|null; complete:boolean}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>200||before!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(before))throw new IdentityError('invalid_page','Use an integer limit from1 to200 and a valid saved-query cursor.',400);
    const rows=await ownerStore().listSavedQueries(owner.owner_id,config.MEMPOOL.NETWORK,limit+1,before);
    const selected=rows.slice(0,limit),more=rows.length>limit;
    return {saved_queries:selected.map(row=>({query_id:row.query_id,owner_id:row.owner_id,title:row.title,sql:row.sql_text,created_at:row.created_at,updated_at:row.updated_at})),count:selected.length,next_cursor:more?selected[selected.length-1].query_id:null,complete:!more};
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSavedQueries(owner: AuthenticatedOwner, limit = 200): Promise<SavedQueryRecord[]> {
    const rows = await ownerStore().listSavedQueries(owner.owner_id, config.MEMPOOL.NETWORK, Math.max(1, Math.min(200, limit)));
    return rows.map(row => ({ query_id: row.query_id, owner_id: row.owner_id, title: row.title, sql: row.sql_text, created_at: row.created_at, updated_at: row.updated_at }));
  }
}

export const queryStudioService = QueryStudioService.getInstance();
