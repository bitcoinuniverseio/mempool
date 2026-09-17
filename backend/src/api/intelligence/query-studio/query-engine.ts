import { createPool, Pool, PoolConnection } from 'mysql2/promise';
import { QUERY_STUDIO_TABLES, RenderedQuery } from './query-grammar';

/**
 * The analytics connection behind Query Studio.
 *
 * It is a separate, small pool opened from UNIVERSE_QUERY_ENGINE_DSN, which
 * names a read-only account on the explorer database or a replica of it.
 * The application's write pool is never used here, so a query that the
 * grammar lets through still runs with the privileges of the read-only
 * account. Every statement carries a deadline; when it passes, the
 * connection is destroyed rather than returned, which is what makes the
 * server abandon the work instead of finishing it for nobody.
 */

export const QUERY_ENGINE_ENVIRONMENT_VARIABLE = 'UNIVERSE_QUERY_ENGINE_DSN';

export const QUERY_ENGINE_LIMITS = {
  connections: 2,
  statementDeadlineMs: 5_000,
  connectTimeoutMs: 3_000,
  maxRows: 1_000,
  defaultRows: 100,
  resultBytes: 1_048_576,
} as const;

export interface EngineColumn {
  name: string;
  type: string;
  nullable: boolean;
  is_primary_key: boolean;
}

export interface EngineTable {
  table_name: string;
  columns: EngineColumn[];
  indexes: string[];
}

export interface EngineRun {
  rows: Array<Record<string, unknown>>;
  columns: string[];
}

export interface QueryEngine {
  readonly source: string;
  describe(tables: string[]): Promise<EngineTable[]>;
  run(query: RenderedQuery, deadlineMs: number): Promise<EngineRun>;
}

export class QueryEngineError extends Error {
  constructor(public readonly reason: 'unconfigured' | 'invalid-dsn' | 'unreachable' | 'deadline' | 'failed', message: string) {
    super(message);
  }
}

export interface ParsedDsn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  socketPath: string | null;
}

/** mysql://user:password@host:port/database, or mysql://user:password@localhost/database?socket=/path for a unix socket. */
export function parseQueryEngineDsn(dsn: string): ParsedDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new QueryEngineError('invalid-dsn', 'UNIVERSE_QUERY_ENGINE_DSN is not a URL.');
  }
  if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
    throw new QueryEngineError('invalid-dsn', 'UNIVERSE_QUERY_ENGINE_DSN must use the mysql:// scheme.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database || database.includes('/')) {
    throw new QueryEngineError('invalid-dsn', 'UNIVERSE_QUERY_ENGINE_DSN must name exactly one database.');
  }
  if (!url.username) {
    throw new QueryEngineError('invalid-dsn', 'UNIVERSE_QUERY_ENGINE_DSN must name the read-only account.');
  }
  const socketPath = url.searchParams.get('socket');
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new QueryEngineError('invalid-dsn', 'UNIVERSE_QUERY_ENGINE_DSN has an invalid port.');
  }
  return {
    host: url.hostname || '127.0.0.1',
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    socketPath: socketPath || null,
  };
}

export class MysqlQueryEngine implements QueryEngine {
  private pool: Pool | null = null;
  public readonly source: string;

  constructor(private readonly dsn: ParsedDsn) {
    this.source = dsn.socketPath ? `mysql://${dsn.user}@[socket]/${dsn.database}` : `mysql://${dsn.user}@${dsn.host}:${dsn.port}/${dsn.database}`;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = createPool({
        ...(this.dsn.socketPath ? { socketPath: this.dsn.socketPath } : { host: this.dsn.host, port: this.dsn.port }),
        user: this.dsn.user,
        password: this.dsn.password,
        database: this.dsn.database,
        connectionLimit: QUERY_ENGINE_LIMITS.connections,
        connectTimeout: QUERY_ENGINE_LIMITS.connectTimeoutMs,
        // Exact values: BIGINT and DECIMAL arrive as strings, never rounded doubles.
        supportBigNumbers: true,
        bigNumberStrings: true,
        decimalNumbers: false,
        dateStrings: true,
        timezone: '+00:00',
        multipleStatements: false,
      });
    }
    return this.pool;
  }

  /** @asyncUnsafe The service turns a rejection into a typed unavailable state. */
  private async connection(): Promise<PoolConnection> {
    try {
      return await this.getPool().getConnection();
    } catch (e) {
      throw new QueryEngineError('unreachable', 'The analytics replica did not accept a connection: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  /** @asyncUnsafe The service turns a rejection into a typed unavailable state. */
  public async describe(tables: string[]): Promise<EngineTable[]> {
    const connection = await this.connection();
    try {
      const [columns] = await connection.query<any[]>(
        'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION',
        [tables],
      );
      const [indexes] = await connection.query<any[]>(
        'SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, INDEX_NAME',
        [tables],
      );
      const byTable = new Map<string, EngineTable>();
      for (const row of columns) {
        const name = String(row.TABLE_NAME);
        const allowed = QUERY_STUDIO_TABLES[name];
        if (!allowed || !allowed.columns.includes(String(row.COLUMN_NAME))) { continue; }
        const table = byTable.get(name) ?? { table_name: name, columns: [], indexes: [] };
        table.columns.push({
          name: String(row.COLUMN_NAME),
          type: String(row.COLUMN_TYPE),
          nullable: String(row.IS_NULLABLE).toUpperCase() === 'YES',
          is_primary_key: String(row.COLUMN_KEY).toUpperCase() === 'PRI',
        });
        byTable.set(name, table);
      }
      for (const row of indexes) {
        byTable.get(String(row.TABLE_NAME))?.indexes.push(String(row.INDEX_NAME));
      }
      return [...byTable.values()];
    } catch (e) {
      if (e instanceof QueryEngineError) { throw e; }
      throw new QueryEngineError('failed', 'Schema discovery failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      connection.release();
    }
  }

  /** @asyncUnsafe The service turns a rejection into a typed unavailable state. */
  public async run(query: RenderedQuery, deadlineMs: number): Promise<EngineRun> {
    const connection = await this.connection();
    let timer: NodeJS.Timeout | undefined;
    let expired = false;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        // Destroying the socket is what cancels the statement on the server.
        connection.destroy();
        reject(new QueryEngineError('deadline', `The query did not finish within ${deadlineMs} ms and was cancelled.`));
      }, deadlineMs);
    });
    try {
      const hinted = query.sql.replace(/^SELECT /, `SELECT /*+ MAX_EXECUTION_TIME(${deadlineMs}) */ `);
      const [rows] = await Promise.race([connection.query<any[]>(hinted, query.params), deadline]);
      return { rows: rows.map(row => ({ ...row })), columns: query.columns };
    } catch (e) {
      if (e instanceof QueryEngineError) { throw e; }
      throw new QueryEngineError('failed', 'The analytics replica rejected the query: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      if (timer) { clearTimeout(timer); }
      if (!expired) { connection.release(); }
    }
  }
}

let configured: QueryEngine | null | undefined;

/** The engine named by the environment, or null when nothing is configured. */
export function queryEngineFromEnvironment(environment: Record<string, string | undefined> = process.env): QueryEngine | null {
  if (configured !== undefined) { return configured; }
  const dsn = String(environment[QUERY_ENGINE_ENVIRONMENT_VARIABLE] ?? '').trim();
  configured = dsn ? new MysqlQueryEngine(parseQueryEngineDsn(dsn)) : null;
  return configured;
}

/** Test seam. */
export function useQueryEngine(engine: QueryEngine | null | undefined): void {
  configured = engine;
}
