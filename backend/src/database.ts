import * as fs from 'fs';
import path from 'path';
import config from './config';
import { createPool, Pool, PoolConnection } from 'mysql2/promise';
import logger, { LogLevel } from './logger';
import { FieldPacket, OkPacket, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/typings/mysql';
import { execSync } from 'child_process';
import { TaskDrain } from './api/task-drain';

 class DB {
  constructor() {
    if (config.DATABASE.SOCKET !== '') {
      this.poolConfig.socketPath = config.DATABASE.SOCKET;
    } else {
      this.poolConfig.host = config.DATABASE.HOST;
    }
  }
  private pool: Pool | null = null;
  private readonly work = new TaskDrain();
  private completionRefusal: 'driver-completion-lost' | 'commit-failed' | 'rollback-failed' | null = null;

  /** Wait for driver completion, even when a caller's hard timeout fired first. */
  public async drain(): Promise<void> {
    await this.work.drain();
    if (this.completionRefusal) throw new Error(`Database shutdown completion refused: ${this.completionRefusal}`);
  }

  /** @asyncUnsafe Caller retains the exact driver error; shutdown retains lost proof. */
  private async observeDriver<T>(operation: Promise<T>): Promise<T> {
    try { return await operation; } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if ((error as { fatal?: unknown })?.fatal === true ||
          ['PROTOCOL_SEQUENCE_TIMEOUT', 'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(code))) {
        this.completionRefusal = 'driver-completion-lost';
      }
      throw error;
    }
  }
  private poolConfig: PoolOptions = {
    port: config.DATABASE.PORT,
    database: config.DATABASE.DATABASE,
    user: config.DATABASE.USERNAME,
    password: config.DATABASE.PASSWORD,
    connectionLimit: config.DATABASE.POOL_SIZE,
    supportBigNumbers: true,
    // Repository code parses JSON columns at its API boundaries. Keep the
    // driver response stable across MySQL and MariaDB extended metadata.
    jsonStrings: true,
    timezone: '+00:00',
  };

  /** @asyncUnsafe */
  private checkDBFlag() {
    if (config.DATABASE.ENABLED === false) {
      const stack = new Error().stack;
      logger.err(`Trying to use DB feature but config.DATABASE.ENABLED is set to false, please open an issue.\nStack trace: ${stack}}`);
    }
  }

  /** @asyncUnsafe */
  public async query<T extends RowDataPacket[][] | RowDataPacket[] | OkPacket |
    OkPacket[] | ResultSetHeader>(query, params?, errorLogLevel: LogLevel | 'silent' = 'debug', connection?: PoolConnection): Promise<[T, FieldPacket[]]>
  {
    this.checkDBFlag();
    let hardTimeout;
    if (query?.timeout != null) {
      hardTimeout = Math.floor(query.timeout * 1.1);
    } else {
      hardTimeout = config.DATABASE.TIMEOUT;
    }
    if (hardTimeout > 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`DB query failed to return, reject or time out within ${hardTimeout / 1000}s - ${query?.sql?.slice(0, 160) || (typeof(query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}`));
        }, hardTimeout);

        // Use a specific connection if provided, otherwise delegate to the pool
        const connectionPromise = connection ? Promise.resolve(connection) : this.getPool();
        this.work.track(connectionPromise.then((pool: PoolConnection | Pool) => {
          return this.observeDriver(pool.query(query, params) as Promise<[T, FieldPacket[]]>);
        })).then(result => {
          resolve(result);
        }).catch(error => {
          if (errorLogLevel !== 'silent') {
            logger[errorLogLevel](`database query "${query?.sql?.slice(0, 160) || (typeof(query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}" failed!`);
          }
          reject(error);
        }).finally(() => {
          clearTimeout(timer);
        });
      });
    } else {
      try {
        // Register acquisition before awaiting it. Drain must observe a query
        // whose connection has not arrived yet as well as the driver call.
        const connectionPromise = connection ? Promise.resolve(connection) : this.getPool();
        return await this.work.track(connectionPromise.then(pool => this.observeDriver(pool.query(query, params) as Promise<[T, FieldPacket[]]>)));
      } catch (e) {
        if (errorLogLevel !== 'silent') {
          logger[errorLogLevel](`database query "${query?.sql?.slice(0, 160) || (typeof(query) === 'string' || query instanceof String ? query?.slice(0, 160) : 'unknown query')}" failed!`);
        }
        throw e;
      }
    }
  }

  /** @asyncSafe */
  private async $rollbackAtomic(connection: PoolConnection): Promise<void> {
    try {
      await connection.rollback();
      await connection.release();
    } catch (e) {
      this.completionRefusal = 'rollback-failed';
      logger.warn('Failed to rollback incomplete db transaction: ' + (e instanceof Error ? e.message : e));
    }
  }

  /** @asyncSafe */
  public $atomicQuery<T extends RowDataPacket[][] | RowDataPacket[] | OkPacket |
    OkPacket[] | ResultSetHeader>(queries: { query, params }[], errorLogLevel: LogLevel | 'silent' = 'debug'): Promise<[T, FieldPacket[]][]>
  {
    return this.work.track(this.executeAtomicQuery<T>(queries, errorLogLevel));
  }

  /** @asyncSafe */
  private async executeAtomicQuery<T extends RowDataPacket[][] | RowDataPacket[] | OkPacket |
    OkPacket[] | ResultSetHeader>(queries: { query, params }[], errorLogLevel: LogLevel | 'silent'): Promise<[T, FieldPacket[]][]>
  {
    const pool = await this.getPool();
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const results: [T, FieldPacket[]][]  = [];
      for (const query of queries) {
        const result = await this.query(query.query, query.params, errorLogLevel, connection) as [T, FieldPacket[]];
        results.push(result);
      }

      try { await connection.commit(); } catch (error) { this.completionRefusal = 'commit-failed'; throw error; }

      return results;
    } catch (e) {
      logger.warn('Could not complete db transaction, rolling back: ' + (e instanceof Error ? e.message : e));
      if (connection) {
        await this.$rollbackAtomic(connection);
      }
      throw e;
    } finally {
      if (connection) {
        connection.release();
      }
    }
  }


  /** @asyncUnsafe Runs conditional work on one connection; rollback then rethrow to caller. */
  public $transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    return this.work.track(this.executeTransaction(work));
  }

  /** @asyncUnsafe Rollback completes before the caller observes failure. */
  private async executeTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await (await this.getPool()).getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      try { await connection.commit(); } catch (error) { this.completionRefusal = 'commit-failed'; throw error; }
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { this.completionRefusal = 'rollback-failed'; connection.destroy(); }
      throw error;
    } finally {
      connection.release();
    }
  }

  /** @asyncSafe */
  public async checkDbConnection() {
    this.checkDBFlag();
    try {
      await this.query('SELECT ?', [1]);
      logger.info('Database connection established.');
    } catch (e) {
      logger.err('Could not connect to database: ' + (e instanceof Error ? e.message : e));
      process.exit(1);
    }
  }

  public getPidLock(): boolean {
    const filePath = path.join(config.DATABASE.PID_DIR || __dirname, `/mempool-${config.DATABASE.DATABASE}.pid`);
    this.enforcePidLock(filePath);
    fs.writeFileSync(filePath, `${process.pid}`);
    return true;
  }

  private enforcePidLock(filePath: string): void {
    if (fs.existsSync(filePath)) {
      const pid = parseInt(fs.readFileSync(filePath, 'utf-8'));
      if (pid === process.pid) {
        logger.warn('PID file already exists for this process');
        return;
      }

      let cmd;
      try {
        cmd = execSync(`ps -p ${pid} -o args=`);
      } catch (e) {
        logger.warn(`Stale PID file at ${filePath}, but no process running on that PID ${pid}`);
        return;
      }

      if (cmd && cmd.toString()?.includes('node')) {
        const msg = `Another mempool nodejs process is already running on PID ${pid}`;
        logger.err(msg);
        throw new Error(msg);
      } else {
        logger.warn(`Stale PID file at ${filePath}, but the PID ${pid} does not belong to a running mempool instance`);
      }
    }
  }

  public releasePidLock(): void {
    const filePath = path.join(config.DATABASE.PID_DIR || __dirname, `/mempool-${config.DATABASE.DATABASE}.pid`);
    if (fs.existsSync(filePath)) {
      const pid = parseInt(fs.readFileSync(filePath, 'utf-8'));
      // only release our own pid file
      if (pid === process.pid) {
        fs.unlinkSync(filePath);
      }
    }
  }

  /** @asyncSafe */
  private async getPool(): Promise<Pool> {
    if (this.pool === null) {
      this.pool = createPool(this.poolConfig);
      this.pool.on('connection', function (newConnection: PoolConnection) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- callback API, not a promise despite types
        newConnection.query(`SET time_zone='+00:00'`);
      });
    }
    return this.pool;
  }

  /**
   * Close the database connection pool
   * This should only be called when the application is shutting down
   * or at the end of test suites
   * @asyncUnsafe Pool close failure keeps the signal owner's diagnostic hold.
   */
  public async close(): Promise<void> {
    if (this.pool !== null) {
      try {
        await this.pool.end();
      } catch (e) {
        logger.err(`Exception in close. Reason: ${(e instanceof Error ? e.message : e)}`);
        throw e;
      }
      this.pool = null;
      logger.debug('Database connection pool closed');
    }
  }
}

export default new DB();
