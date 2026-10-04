import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { FractalEvidenceError } from './fractal.errors';
import { FractalNativeReader, FractalObservation, FractalCheckpoint, evidence, hash, height } from './fractal.native';
import { Cat20Holder, Cat20Token, Cat20Page, Cat20PageRequest } from './fractal.types';

/** Structural pg interface: wiring must supply a separately scoped read-only role. */
export interface CatSqlConnection {
  query(query: { text: string; values?: unknown[]; query_timeout: number }): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
export interface CatSqlPool { connect(): Promise<CatSqlConnection>; }
export interface CatProjectionProfile {
  sourceRevision: '8d5aeee7484bacc33d0014b44503c0b59d39aaff';
  schemaSha256: string;
  configurationSha256: string;
}
interface Cursor {
  v: 1; scope: string; height: number; hash: string; after: string; limit: number; expires: number;
  source: string; schema: string; configuration: string; nativeConfiguration: string;
}
export function tokenInput(value: string): void {
  evidence(/^[0-9a-f]{64}_(0|[1-9][0-9]{0,9})$/.test(value) && Number(value.split('_')[1]) <= 0xffffffff, 'invalid-cat20-input', 400);
}
function exact(value: unknown): string {
  evidence(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'invalid-cat20-amount');
  return value;
}
function count(value: unknown): number {
  const result = Number(exact(value)); evidence(Number.isSafeInteger(result), 'oversized-cat20-count'); return result;
}

// At H, creations after H are absent; a spend after H does not consume its input at H.
// A spend reference without its native tx row is an incomplete nontransactional write,
// never a license to call the output unspent. The separate rejection query fences this.
export const CAT_UNSPENT_AT_HEIGHT = `o.block_height <= $1 AND (o.spend_txid IS NULL OR s.block_height > $1)`;
export const CAT_BALANCES_AT_HEIGHT = `SELECT o.owner_pkh, SUM(o.token_amount)::text AS balance
  FROM (SELECT txid,output_index,block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out UNION ALL SELECT txid,output_index,block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out_archive) o LEFT JOIN tx s ON s.txid=o.spend_txid
  WHERE ${CAT_UNSPENT_AT_HEIGHT} AND o.xonly_pubkey=$2 AND o.token_amount IS NOT NULL
  GROUP BY o.owner_pkh`;

export const CAT_SCHEMA_SQL = `SELECT json_build_object(
  'columns', (SELECT json_agg(c ORDER BY c.table_name,c.ordinal_position) FROM
    (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name IN ('block','token_info','token_mint','tx','tx_out','tx_out_archive')) c),
  'constraints', (SELECT json_agg(c ORDER BY c.table_name,c.name) FROM
    (SELECT r.relname AS table_name, c.conname AS name, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname=current_schema() AND r.relname IN ('block','token_info','token_mint','tx','tx_out','tx_out_archive')) c),
  'indexes', (SELECT json_agg(i ORDER BY i.tablename,i.indexname) FROM
    (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema()
      AND tablename IN ('block','token_info','token_mint','tx','tx_out','tx_out_archive')) i)) AS schema`;
export function catSchemaDigest(schema: unknown): string {
  evidence(schema !== null && typeof schema === 'object', 'invalid-cat20-schema');
  const value = schema as Record<string, unknown>;
  evidence(Array.isArray(value.columns) && value.columns.length > 0 && Array.isArray(value.constraints) && Array.isArray(value.indexes), 'invalid-cat20-schema');
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

/** Reads native 8d5 schema; never alters writer state or pretends cached HTTP is complete. */
export class Cat20Projection {
  constructor(private readonly native: FractalNativeReader, private readonly pool: CatSqlPool,
    public readonly profile: CatProjectionProfile, private readonly cursorKey: Buffer) {
    evidence(profile.sourceRevision === '8d5aeee7484bacc33d0014b44503c0b59d39aaff'
      && /^[0-9a-f]{64}$/.test(profile.schemaSha256) && /^[0-9a-f]{64}$/.test(profile.configurationSha256)
      && cursorKey.length >= 32, 'invalid-cat20-configuration');
  }

  private cursor(request: Cat20PageRequest, scope: string): { limit: number; cursor?: Cursor } {
    const limit = request.limit ?? 100;
    evidence(Number.isInteger(limit) && limit > 0 && limit <= 500, 'invalid-cat20-input', 400);
    if (request.cursor === undefined) { return { limit }; }
    evidence(typeof request.cursor === 'string' && request.cursor.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(request.cursor), 'invalid-cat20-cursor', 400);
    const [payload, signature] = request.cursor.split('.');
    const expected = createHmac('sha256', this.cursorKey).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    evidence(actual.length === expected.length && timingSafeEqual(actual, expected), 'invalid-cat20-cursor', 400);
    let cursor: Cursor;
    try { cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
    catch { throw new FractalEvidenceError('invalid-cat20-cursor', 'The authenticated CAT cursor could not be decoded.', 400); }
    evidence(cursor.v === 1 && cursor.scope === scope && cursor.limit === limit && cursor.expires > Date.now()
      && cursor.source === this.profile.sourceRevision && cursor.schema === this.profile.schemaSha256
      && cursor.configuration === this.profile.configurationSha256 && cursor.nativeConfiguration === this.native.profile.configurationSha256
      && Number.isSafeInteger(cursor.height) && cursor.height >= 0 && /^[0-9a-f]{64}$/.test(cursor.hash)
      && typeof cursor.after === 'string', 'stale-cat20-cursor', 409);
    if (scope === 'tokens') { tokenInput(cursor.after); }
    else { evidence(/^[0-9a-f]{40}$/.test(cursor.after), 'invalid-cat20-cursor', 400); }
    return { limit, cursor };
  }
  private encode(scope: string, checkpoint: FractalCheckpoint, after: string, limit: number, expires?: number): string {
    const cursor: Cursor = { v: 1, scope, ...checkpoint, after, limit, expires: expires ?? Date.now() + 600000,
      source: this.profile.sourceRevision, schema: this.profile.schemaSha256, configuration: this.profile.configurationSha256,
      nativeConfiguration: this.native.profile.configurationSha256 };
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return payload + '.' + createHmac('sha256', this.cursorKey).update(payload).digest('base64url');
  }
  /** @asyncUnsafe Native/SQL failures propagate to the HTTP boundary after rollback. */
  private async snapshot<T>(cursor: Cursor | undefined,
    read: (query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>, checkpoint: FractalCheckpoint, observation: FractalObservation, signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.native.attempt(/** @asyncUnsafe Connection failures propagate to the native/HTTP boundary. */ async (signal, observation) => {
      evidence(observation.ready, 'cat20-node-not-ready');
      let connection: CatSqlConnection;
      try { connection = await this.pool.connect(); }
      catch { throw new FractalEvidenceError(signal.aborted ? 'cat20-source-timeout' : 'unavailable-cat20-indexer', 'The native CAT read connection is unavailable.', signal.aborted ? 504 : 503); }
      let begun = false;
      /** @asyncUnsafe SQL failures propagate to snapshot rollback. */
      const query = async (text: string, values: unknown[] = []): Promise<Record<string, unknown>[]> => {
        evidence(!signal.aborted, 'cat20-source-timeout', 504);
        const result = await connection.query({ text, values, query_timeout: 5000 });
        evidence(!signal.aborted, 'cat20-source-timeout', 504);
        return result.rows;
      };
      try {
        await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true;
        await query('SET LOCAL search_path TO public');
        await query(`SET LOCAL statement_timeout = '5000ms'`);
        const schema = await query(CAT_SCHEMA_SQL);
        evidence(schema.length === 1 && catSchemaDigest(schema[0].schema) === this.profile.schemaSha256, 'cat20-schema-changed');
        const rows = await query('SELECT height, hash FROM block ORDER BY height DESC, hash ASC LIMIT 2');
        evidence(rows.length > 0 && (rows.length === 1 || rows[0].height !== rows[1].height), 'cat20-ambiguous-checkpoint');
        const latest = { height: height(rows[0].height), hash: hash(rows[0].hash) };
        evidence(latest.height === observation.checkpoint.height && latest.hash === observation.checkpoint.hash, 'cat20-checkpoint-lag');
        const checkpoint = cursor ? { height: cursor.height, hash: cursor.hash } : latest;
        evidence(checkpoint.height <= latest.height, 'stale-cat20-cursor', 409);
        const stored = await query('SELECT hash FROM block WHERE height=$1', [checkpoint.height]);
        evidence(stored.length === 1 && stored[0].hash === checkpoint.hash
          && await this.native.call('getblockhash', [checkpoint.height], signal) === checkpoint.hash, 'cat20-checkpoint-changed', 409);
        const result = await read(query, checkpoint, observation, signal);
        evidence(await this.native.call('getblockhash', [checkpoint.height], signal) === checkpoint.hash, 'cat20-checkpoint-changed', 409);
        await query('COMMIT'); begun = false;
        return result;
      } catch (error) {
        if (error instanceof FractalEvidenceError) { throw error; }
        throw new FractalEvidenceError('unavailable-cat20-indexer', 'The native CAT projection could not be completed.');
      } finally {
        let destroy = false;
        try { if (begun) { await connection.query({ text: 'ROLLBACK', query_timeout: 5000 }); } }
        catch { destroy = true; }
        finally { connection.release(destroy); }
      }
    });
  }
  /** @asyncUnsafe Reject incomplete native writes at the caller boundary. */
  private async balance(query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>, checkpoint: FractalCheckpoint, pubkey: string): Promise<void> {
    const incomplete = await query(`SELECT 1 FROM (SELECT txid,output_index,block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out UNION ALL SELECT txid,output_index,block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out_archive) o LEFT JOIN tx s ON s.txid=o.spend_txid
      WHERE o.block_height <= $1 AND o.xonly_pubkey=$2 AND o.spend_txid IS NOT NULL AND s.txid IS NULL LIMIT 1`, [checkpoint.height, pubkey]);
    evidence(incomplete.length === 0, 'cat20-incomplete-spend');
    const invalid = await query(`SELECT 1 FROM (SELECT block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out UNION ALL SELECT block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out_archive) o LEFT JOIN tx s ON s.txid=o.spend_txid
      WHERE ${CAT_UNSPENT_AT_HEIGHT} AND o.xonly_pubkey=$2 AND o.token_amount IS NOT NULL
      AND (o.owner_pkh IS NULL OR o.owner_pkh !~ '^[0-9a-f]{40}$' OR o.token_amount < 0) LIMIT 1`, [checkpoint.height, pubkey]);
    evidence(invalid.length === 0, 'invalid-cat20-holder');
  }
  /** @asyncUnsafe A bounded page is aggregated in bulk, avoiding per-token query growth. */
  private async supplies(rows: Record<string, unknown>[], query: (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>, checkpoint: FractalCheckpoint): Promise<Map<string, { supply: string; holders: number }>> {
    const keys = [...new Set(rows.flatMap(row => row.first_mint_height !== null && height(row.first_mint_height) <= checkpoint.height ? [hash(row.token_pubkey)] : []))];
    const result = new Map<string, { supply: string; holders: number }>();
    if (keys.length === 0) { return result; }
    const outputs = '(SELECT block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out UNION ALL SELECT block_height,owner_pkh,xonly_pubkey,token_amount,spend_txid FROM tx_out_archive)';
    const incomplete = await query(`SELECT 1 FROM ${outputs} o LEFT JOIN tx s ON s.txid=o.spend_txid
      WHERE o.block_height <= $1 AND o.xonly_pubkey=ANY($2::varchar[]) AND o.spend_txid IS NOT NULL AND s.txid IS NULL LIMIT 1`, [checkpoint.height, keys]);
    evidence(incomplete.length === 0, 'cat20-incomplete-spend');
    const grouped = `SELECT o.xonly_pubkey AS pubkey,o.owner_pkh,SUM(o.token_amount) AS balance
      FROM ${outputs} o LEFT JOIN tx s ON s.txid=o.spend_txid
      WHERE ${CAT_UNSPENT_AT_HEIGHT} AND o.xonly_pubkey=ANY($2::varchar[]) AND o.token_amount IS NOT NULL GROUP BY o.xonly_pubkey,o.owner_pkh`;
    const invalid = await query(`SELECT 1 FROM ${outputs} o LEFT JOIN tx s ON s.txid=o.spend_txid
      WHERE ${CAT_UNSPENT_AT_HEIGHT} AND o.xonly_pubkey=ANY($2::varchar[]) AND o.token_amount IS NOT NULL
      AND (o.owner_pkh IS NULL OR o.owner_pkh !~ '^[0-9a-f]{40}$' OR o.token_amount < 0) LIMIT 1`, [checkpoint.height, keys]);
    evidence(invalid.length === 0, 'invalid-cat20-holder');
    const totals = await query(`SELECT pubkey,COALESCE(SUM(balance),0)::text AS supply,COUNT(*)::text AS holders FROM (${grouped}) b GROUP BY pubkey`, [checkpoint.height, keys]);
    for (const total of totals) { result.set(hash(total.pubkey), { supply: exact(total.supply), holders: count(total.holders) }); }
    return result;
  }
  private mapToken(row: Record<string, unknown>, supplies: Map<string, { supply: string; holders: number }>, checkpoint: FractalCheckpoint): Cat20Token {
    evidence(typeof row.token_id === 'string'); tokenInput(row.token_id);
    evidence(typeof row.name === 'string' && typeof row.symbol === 'string' && typeof row.decimals === 'number' && row.decimals >= 0 && Number.isSafeInteger(row.decimals)
      && typeof row.minter_pubkey === 'string' && /^[0-9a-f]{64}$/.test(row.minter_pubkey), 'invalid-cat20-token');
    const pubkey = row.first_mint_height !== null && height(row.first_mint_height) <= checkpoint.height ? hash(row.token_pubkey) : null;
    const { supply, holders } = pubkey === null ? { supply: '0', holders: 0 } : supplies.get(pubkey) ?? { supply: '0', holders: 0 };
    return { schema: 'cat20-token-v1', tokenId: row.token_id, name: row.name, symbol: row.symbol, decimals: row.decimals,
      maxSupplyAtomic: null, mintLimitAtomic: null, circulatingSupplyAtomic: supply, deployTxid: hash(row.reveal_txid), deployHeight: height(row.reveal_height),
      minterAddress: null, minterPubKey: row.minter_pubkey, minterType: null, holderCount: holders, transferCount: null, state: null,
      unavailable: ['minter-address-not-observed', 'contract-supply-limits-not-validated', 'transfer-count-not-indexed', 'minter-type-and-state-not-validated'] };
  }
  public async tokens(request: Cat20PageRequest = {}): Promise<Cat20Page<Cat20Token>> {
    const { limit, cursor } = this.cursor(request, 'tokens');
    return this.snapshot(cursor, /** @asyncUnsafe Errors propagate to snapshot rollback. */ async (query, checkpoint, observation) => {
      const params = [checkpoint.height, cursor?.after ?? '', limit + 1];
      const rows = await query('SELECT * FROM token_info WHERE decimals >= 0 AND reveal_height <= $1 AND token_id > $2 COLLATE "C" ORDER BY token_id COLLATE "C" ASC LIMIT $3', params);
      const totals = await query('SELECT COUNT(*)::text AS total FROM token_info WHERE decimals >= 0 AND reveal_height <= $1', [checkpoint.height]);
      const supplies = await this.supplies(rows.slice(0, limit), query, checkpoint);
      const items = rows.slice(0, limit).map(row => this.mapToken(row, supplies, checkpoint));
      return { schema: 'cat20-page-v1', observation, checkpoint, trackerSourceRevision: this.profile.sourceRevision, items, total: count(totals[0].total),
        nextCursor: rows.length > limit ? this.encode('tokens', checkpoint, items[items.length - 1].tokenId, limit, cursor?.expires) : null };
    });
  }
  public async token(tokenId: string): Promise<unknown> {
    tokenInput(tokenId);
    return this.snapshot(undefined, /** @asyncUnsafe Errors propagate to snapshot rollback. */ async (query, checkpoint, observation) => {
      const rows = await query('SELECT * FROM token_info WHERE token_id=$1 AND decimals >= 0 AND reveal_height <= $2', [tokenId, checkpoint.height]);
      return rows.length === 0 ? null : { ...this.mapToken(rows[0], await this.supplies(rows, query, checkpoint), checkpoint), observation, checkpoint, trackerSourceRevision: this.profile.sourceRevision };
    });
  }
  public async holders(tokenId: string, request: Cat20PageRequest = {}): Promise<Cat20Page<Cat20Holder>> {
    tokenInput(tokenId);
    const scope = 'holders:' + tokenId;
    const { limit, cursor } = this.cursor(request, scope);
    return this.snapshot(cursor, /** @asyncUnsafe Errors propagate to snapshot rollback. */ async (query, checkpoint, observation) => {
      const tokens = await query('SELECT * FROM token_info WHERE token_id=$1 AND decimals >= 0 AND reveal_height <= $2', [tokenId, checkpoint.height]);
      evidence(tokens.length === 1, 'cat20-token-not-found', 404);
      const token = tokens[0];
      const pubkey = token.first_mint_height !== null && height(token.first_mint_height) <= checkpoint.height ? hash(token.token_pubkey) : null;
      if (pubkey === null) { return { schema: 'cat20-page-v1', observation, checkpoint, trackerSourceRevision: this.profile.sourceRevision, items: [], total: 0, nextCursor: null }; }
      hash(pubkey); await this.balance(query, checkpoint, pubkey);
      const rows = await query(`SELECT * FROM (${CAT_BALANCES_AT_HEIGHT}) b WHERE owner_pkh > $3 COLLATE "C" ORDER BY owner_pkh COLLATE "C" ASC LIMIT $4`, [checkpoint.height, pubkey, cursor?.after ?? '', limit + 1]);
      const totals = await query(`SELECT COUNT(*)::text AS total FROM (${CAT_BALANCES_AT_HEIGHT}) b`, [checkpoint.height, pubkey]);
      const items = rows.slice(0, limit).map(row => {
        evidence(typeof row.owner_pkh === 'string' && /^[0-9a-f]{40}$/.test(row.owner_pkh), 'invalid-cat20-holder');
        return { ownerPubKeyHash: row.owner_pkh, address: null, balanceAtomic: exact(row.balance), percentage: null };
      });
      return { schema: 'cat20-page-v1', observation, checkpoint, trackerSourceRevision: this.profile.sourceRevision, items, total: count(totals[0].total),
        nextCursor: rows.length > limit ? this.encode(scope, checkpoint, items[items.length - 1].ownerPubKeyHash, limit, cursor?.expires) : null };
    });
  }
}
