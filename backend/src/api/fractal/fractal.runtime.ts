import { constants, promises as fs } from 'fs';
import { isAbsolute } from 'path';
import { createHash } from 'crypto';
import { createRequire } from 'module';
import { Cat20Projection, CatSqlPool, CatProjectionProfile } from './fractal.cat';
import { createFractalRpc, evidence, FractalNativeReader, FractalSourceProfile, object } from './fractal.native';
import { configureFractalSource } from './fractal.service';

export interface FractalRuntimeConfiguration {
  ENABLED: boolean;
  PROFILE_FILE: string;
  RPC_URL: string;
  COOKIE_PATH: string;
  CAT_CONNECTION_FILE: string;
  CURSOR_KEY_FILE: string;
}
interface ReadPool extends CatSqlPool { end(): Promise<void>; }
type PoolFactory = (configuration: Record<string, unknown>) => ReadPool;
let activePool: ReadPool | undefined;

/** @asyncUnsafe Selected-file errors propagate to startup or the bounded native observation. */
export async function readFractalFile(path: string, secret: boolean, maximum: number): Promise<Buffer> {
  evidence(isAbsolute(path), 'invalid-fractal-configuration');
  const before = await fs.lstat(path);
  evidence(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= maximum, 'invalid-fractal-configuration');
  if (secret && process.platform !== 'win32') {
    evidence((before.mode & 0o077) === 0 && before.uid === process.getuid?.(), 'invalid-fractal-configuration');
  }
  const file = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await file.stat();
    evidence(opened.dev === before.dev && opened.ino === before.ino && opened.size === before.size, 'invalid-fractal-configuration');
    const bytes = await file.readFile();
    const after = await file.stat();
    evidence(bytes.length <= maximum && after.size === opened.size && after.mtimeMs === opened.mtimeMs, 'invalid-fractal-configuration');
    return bytes;
  } finally { await file.close(); }
}

/** @asyncUnsafe Explicit configuration or role failures reject startup; no discovery or automatic scan. */
export async function startFractalRuntime(configuration: FractalRuntimeConfiguration, factory?: PoolFactory): Promise<void> {
  if (!configuration.ENABLED) { return; }
  evidence(!activePool, 'invalid-fractal-configuration');
  const profile = object(JSON.parse((await readFractalFile(configuration.PROFILE_FILE, false, 65536)).toString('utf8')));
  evidence(profile.schema === 'fractal-reader-profile-v1', 'invalid-fractal-configuration');
  const nativeProfile = object(profile.native) as unknown as FractalSourceProfile;
  const native = new FractalNativeReader(nativeProfile, createFractalRpc(configuration.RPC_URL,
    /** @asyncUnsafe Credential errors propagate to the bounded native observation. */ async () =>
      (await readFractalFile(configuration.COOKIE_PATH, true, 4096)).toString('utf8').trim()));
  const hasCat = Boolean(configuration.CAT_CONNECTION_FILE || configuration.CURSOR_KEY_FILE);
  if (!hasCat) { configureFractalSource(native); return; }
  evidence(Boolean(configuration.CAT_CONNECTION_FILE && configuration.CURSOR_KEY_FILE), 'invalid-fractal-configuration');
  const catProfile = object(profile.cat) as unknown as CatProjectionProfile;
  const selected = object(profile.selected);
  evidence(createHash('sha256').update(JSON.stringify(selected)).digest('hex') === catProfile.configurationSha256
    && selected.nativeConfigurationSha256 === nativeProfile.configurationSha256
    && selected.schemaSha256 === catProfile.schemaSha256 && selected.trackerSourceRevision === catProfile.sourceRevision
    && selected.rpcOrigin === configuration.RPC_URL, 'invalid-fractal-configuration');
  const connection = object(JSON.parse((await readFractalFile(configuration.CAT_CONNECTION_FILE, true, 65536)).toString('utf8')));
  evidence(connection.host === '127.0.0.1' && connection.host === selected.host && connection.port === selected.port
    && connection.database === selected.database && connection.user === selected.readerRole
    && connection.max === 1 && selected.maximumPoolSize === 1
    && connection.connectionTimeoutMillis === 5000 && selected.connectionTimeoutMillis === 5000
    && typeof connection.password === 'string' && connection.password.length > 0
    && !connection.connectionString && !connection.ssl, 'invalid-fractal-configuration');
  const key = await readFractalFile(configuration.CURSOR_KEY_FILE, true, 4096);
  evidence(key.length >= 32, 'invalid-fractal-configuration');
  const makePool = factory || ((options: Record<string, unknown>): ReadPool => {
    const driver = createRequire(__filename)('pg') as { Pool: new (configuration: Record<string, unknown>) => ReadPool };
    return new driver.Pool(options);
  });
  const pool = makePool({ host: connection.host, port: connection.port, database: connection.database,
    user: connection.user, password: connection.password, max: 1, connectionTimeoutMillis: 5000,
    query_timeout: 15000, idleTimeoutMillis: 10000, options: '-c search_path=public -c default_transaction_read_only=on' });
  try {
    const client = await pool.connect();
    try {
      const proof = await client.query({ text: `SELECT current_user AS role, current_database() AS database,
        current_schema() AS schema, current_setting('default_transaction_read_only') AS readonly,
        (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user) AS privileged,
        has_schema_privilege(current_user,'public','CREATE') OR EXISTS (
          SELECT 1 FROM pg_tables WHERE schemaname='public' AND
            has_table_privilege(current_user, quote_ident(schemaname)||'.'||quote_ident(tablename),
              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS writable,
        (SELECT bool_and(has_table_privilege(current_user,'public.'||name,'SELECT')) FROM
          unnest(ARRAY['block','token_info','token_mint','tx','tx_out','tx_out_archive']) AS name) AS readable`, query_timeout: 5000 });
      const value = object(proof.rows[0]);
      evidence(value.role === selected.readerRole && value.database === selected.database && value.schema === 'public'
        && value.readonly === 'on' && value.privileged === false && value.writable === false && value.readable === true, 'invalid-fractal-reader-role');
    } finally { client.release(); }
    configureFractalSource(native, new Cat20Projection(native, pool, catProfile, key));
    activePool = pool;
  } catch (error) { await pool.end(); throw error; }
}

/** @asyncUnsafe Pool shutdown failures propagate to the bounded server shutdown handler. */
export async function closeFractalRuntime(): Promise<void> {
  const pool = activePool; activePool = undefined;
  if (pool) { await pool.end(); }
}
