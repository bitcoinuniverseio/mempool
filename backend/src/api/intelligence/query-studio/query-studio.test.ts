import { Application, Request, Response } from 'express';
import { EventEmitter } from 'events';
import queryStudioRoutes from './query-studio.routes';
import { QueryPolicyError, QueryStudioEvidenceError, queryStudioService } from './query-studio.service';
import { EngineRun, EngineTable, parseQueryEngineDsn, QueryEngine, QueryEngineError, QUERY_ENGINE_LIMITS } from './query-engine';
import { RenderedQuery } from './query-grammar';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';
import { ownerUsageLedger } from '../identity/owner-usage-ledger';

/** A fake analytics connection: records the statement it was handed and answers with fixture rows. */
class FakeEngine implements QueryEngine {
  public readonly source = 'mysql://readonly@fake/explorer';
  public statements: RenderedQuery[] = [];
  public tables: EngineTable[] = [
    { table_name: 'blocks', columns: [{ name: 'height', type: 'int(11) unsigned', nullable: false, is_primary_key: true }, { name: 'hash', type: 'varchar(65)', nullable: false, is_primary_key: false }, { name: 'total_output_amt', type: 'bigint unsigned', nullable: false, is_primary_key: false }], indexes: ['PRIMARY', 'pool_id'] },
    { table_name: 'pools', columns: [{ name: 'id', type: 'smallint unsigned', nullable: false, is_primary_key: true }, { name: 'name', type: 'varchar(50)', nullable: false, is_primary_key: false }], indexes: ['PRIMARY'] },
  ];
  constructor(private readonly answer: (query: RenderedQuery) => EngineRun | Promise<EngineRun>) {}
  /** @asyncSafe */
  public async describe(): Promise<EngineTable[]> { return this.tables; }
  /** @asyncUnsafe test double */
  public async run(query: RenderedQuery): Promise<EngineRun> { this.statements.push(query); return this.answer(query); }
}

const fixtureRows = [
  { height: 200000, hash: '00'.repeat(32), total_output_amt: '9223372036854775807' },
  { height: 199999, hash: '11'.repeat(32), total_output_amt: '12345678901234567890' },
];

async function owners(): Promise<{ analyst: AuthenticatedOwner; other: AuthenticatedOwner; analystKey: string }> {
  useOwnerStore(new MemoryOwnerStore());
  developerIdentity.resetForTests();
  ownerUsageLedger.resetForTests();
  const a = await developerIdentity.bootstrapOwner('analyst', '203.0.113.1');
  const b = await developerIdentity.bootstrapOwner('other', '203.0.113.2');
  return { analyst: (await developerIdentity.authenticateKey(a.secret_key))!, other: (await developerIdentity.authenticateKey(b.secret_key))!, analystKey: a.secret_key };
}

describe('Query Studio connector', () => {
  afterEach(() => { queryStudioService.useEngine(undefined); });

  it('reports the unconfigured engine with its reason and never an empty result', async () => {
    queryStudioService.useEngine(null);
    for (const read of [() => queryStudioService.getSchema(), () => queryStudioService.executeQuery('SELECT height FROM blocks')]) {
      await expect(read()).rejects.toMatchObject({ code: 'unavailable-query-engine', reason: 'unconfigured', status: 503 });
      await expect(read()).rejects.toBeInstanceOf(QueryStudioEvidenceError);
    }
    expect(queryStudioService.getHistory(null)).toEqual([]);
  });

  it('rejects writes, stacked statements, comments and oversized queries before touching the engine', async () => {
    const engine = new FakeEngine(() => ({ rows: [], columns: [] }));
    queryStudioService.useEngine(engine);
    for (const sql of ['DROP TABLE blocks', 'DELETE FROM blocks WHERE 1=1', 'UPDATE blocks SET fees = 0', 'SELECT * FROM blocks; DROP TABLE blocks', 'SELECT height FROM blocks -- x', 'SELECT * FROM intelligence_api_keys', 'SELECT height FROM blocks WHERE ' + 'height = 1 OR '.repeat(600) + 'height = 2']) {
      await expect(queryStudioService.executeQuery(sql)).rejects.toBeInstanceOf(QueryPolicyError);
      await expect(queryStudioService.executeQuery(sql)).rejects.toThrow(/Security policy violation/);
    }
    await expect(queryStudioService.executeQuery('SELECT height FROM blocks', 0)).rejects.toThrow(/max_rows/);
    expect(engine.statements).toEqual([]);
  });

  it('runs a parsed SELECT on the engine, keeps exact integers and appends owner-scoped history', async () => {
    const { analyst, other } = await owners();
    const engine = new FakeEngine(() => ({ rows: fixtureRows, columns: ['height', 'hash', 'total_output_amt'] }));
    queryStudioService.useEngine(engine);
    const sql = "SELECT height, hash, total_output_amt FROM blocks WHERE hash <> 'DROP TABLE blocks' ORDER BY height DESC LIMIT 2";
    const result = await queryStudioService.executeQuery(sql, 100, undefined, analyst);
    expect(engine.statements).toEqual([{
      sql: 'SELECT `height` AS `height`, `hash` AS `hash`, `total_output_amt` AS `total_output_amt` FROM `blocks` WHERE `hash` <> ? ORDER BY `height` DESC LIMIT 3',
      params: ['DROP TABLE blocks'], table: 'blocks', columns: ['height', 'hash', 'total_output_amt'],
    }]);
    expect(result.rows).toEqual(fixtureRows);
    expect(result.rows[1].total_output_amt).toBe('12345678901234567890');
    expect(result.row_count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.next_cursor).toBeNull();
    expect(result.source).toMatchObject({ engine: engine.source, table: 'blocks', deadline_ms: QUERY_ENGINE_LIMITS.statementDeadlineMs });

    const history = queryStudioService.getHistory(analyst);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ query_id: result.query_id, owner_id: analyst.owner_id, sql, row_count: 2, truncated: false });
    expect(queryStudioService.getHistory(other)).toEqual([]);
    expect(queryStudioService.getHistory(null)).toEqual([]);
  });

  it('marks truncation when the engine returns more than the row budget and issues a cursor bound to the query', async () => {
    const engine = new FakeEngine(query => ({ rows: Array.from({ length: 3 }, (_, i) => ({ height: i })), columns: query.columns }));
    queryStudioService.useEngine(engine);
    const first = await queryStudioService.executeQuery('SELECT height FROM blocks', 2);
    expect(first.truncated).toBe(true);
    expect(first.row_count).toBe(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await queryStudioService.executeQuery('SELECT height FROM blocks', 2, first.next_cursor);
    expect(engine.statements[1].sql).toContain('LIMIT 3 OFFSET 2');
    expect(second.row_count).toBe(2);
    await expect(queryStudioService.executeQuery('SELECT hash FROM blocks', 2, first.next_cursor)).rejects.toThrow(/cursor/);
  });

  it('stops at the byte budget', async () => {
    const wide = 'x'.repeat(400_000);
    const engine = new FakeEngine(() => ({ rows: [{ hash: wide }, { hash: wide }, { hash: wide }], columns: ['hash'] }));
    queryStudioService.useEngine(engine);
    const result = await queryStudioService.executeQuery('SELECT hash FROM blocks', 10);
    expect(result.row_count).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('maps engine faults to typed unavailable states', async () => {
    queryStudioService.useEngine(new FakeEngine(() => { throw new QueryEngineError('deadline', 'cancelled'); }));
    await expect(queryStudioService.executeQuery('SELECT height FROM blocks')).rejects.toMatchObject({ code: 'unavailable-query-engine', reason: 'deadline', status: 504 });
    queryStudioService.useEngine(new FakeEngine(() => { throw new QueryEngineError('unreachable', 'refused'); }));
    await expect(queryStudioService.executeQuery('SELECT height FROM blocks')).rejects.toMatchObject({ reason: 'unreachable', status: 503 });
  });

  it('discovers the schema from the engine, intersected with the allowlist', async () => {
    const engine = new FakeEngine(() => ({ rows: [], columns: [] }));
    queryStudioService.useEngine(engine);
    const schema = await queryStudioService.getSchema();
    expect(schema.tables.map(table => table.table_name)).toEqual(['blocks', 'pools']);
    expect(schema.tables[0].description).toMatch(/indexed block/);
    expect(schema.tables[0].columns[2]).toEqual({ name: 'total_output_amt', type: 'bigint unsigned', nullable: false, is_primary_key: false });
    expect(schema.missing_tables).toEqual(['hashrates', 'difficulty_adjustments', 'prices', 'statistics', 'blocks_audits']);
    expect(schema.source).toBe(engine.source);
  });

  it('parses the DSN into a read-only pool configuration and refuses malformed ones', () => {
    expect(parseQueryEngineDsn('mysql://ro:s3cret@10.0.0.5:3307/mempool')).toEqual({ host: '10.0.0.5', port: 3307, user: 'ro', password: 's3cret', database: 'mempool', socketPath: null });
    expect(parseQueryEngineDsn('mysql://ro@localhost/mempool?socket=/run/mysqld/mysqld.sock').socketPath).toBe('/run/mysqld/mysqld.sock');
    for (const bad of ['not a url', 'postgres://ro@h/db', 'mysql://ro@h/', 'mysql://h/db', 'mysql://ro@h:99999/db']) {
      expect(() => parseQueryEngineDsn(bad)).toThrow(QueryEngineError);
    }
  });

  it('keeps saved queries per authenticated owner, durably and bounded', async () => {
    const { analyst, other } = await owners();
    expect(await queryStudioService.getSavedQueries(analyst)).toEqual([]);
    const title = 'High fee blocks';
    const sql = 'SELECT height, fees FROM blocks ORDER BY fees DESC LIMIT 50';
    const saved = await queryStudioService.saveQuery(analyst, title, sql);
    expect(saved.owner_id).toBe(analyst.owner_id);
    expect((await queryStudioService.getSavedQueries(analyst)).map((q) => q.query_id)).toEqual([saved.query_id]);
    expect(await queryStudioService.getSavedQueries(other)).toEqual([]);
    await expect(queryStudioService.saveQuery(analyst, '', sql)).rejects.toMatchObject({ code: 'invalid_title' });
    await expect(queryStudioService.saveQuery(analyst, 'x', 's'.repeat(20000))).rejects.toMatchObject({ code: 'invalid_sql' });
  });

  it('blocks SSRF attempts in developer webhook registration', async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    // Resolver seam only; no outbound request. Documentation networks are blocked.
    developerIdentity.resolver = async () => [{ address: '8.8.8.8', family: 4 }];
    const key = await developerIdentity.bootstrapOwner('dev', '203.0.113.3');
    const owner = (await developerIdentity.authenticateKey(key.secret_key))!;
    await expect(developerIdentity.registerWebhook(owner, 'http://169.254.169.254/latest/meta-data/', ['mempool.evaluated'])).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(developerIdentity.registerWebhook(owner, 'https://localhost:8080/callback', ['mempool.evaluated'])).rejects.toMatchObject({ code: 'invalid_url' });
    const validHook = await developerIdentity.registerWebhook(owner, 'https://api.externalpartner.org/webhooks/mempool', ['mempool.evaluated']);
    expect(validHook.webhook_id).toBeDefined();
    expect(validHook.signing_secret).toHaveLength(64);
    expect(JSON.stringify(await developerIdentity.listWebhooks(owner))).not.toMatch(/secret/);
  });
});

describe('Developer usage metrics', () => {
  it('answers no-observations for an owner the ledger has not seen, and only that owner\'s counts afterwards', async () => {
    const { analyst, other } = await owners();
    const before = await queryStudioService.getUsage(analyst);
    expect(before.state).toBe('no-observations');
    expect(before.usage).toBeNull();
    expect(before.quota.keys).toHaveLength(1);
    expect(before.quota.keys[0].rate_limit_per_minute).toBe(1000);
    expect(before.coverage.persistence).toBe('process-memory-only');

    ownerUsageLedger.record(analyst.owner_id, analyst.key_id, 200, 12);
    ownerUsageLedger.record(analyst.owner_id, analyst.key_id, 429, 3);
    ownerUsageLedger.record(other.owner_id, other.key_id, 200, 50);
    const after = await queryStudioService.getUsage(analyst);
    expect(after.state).toBe('observed');
    expect(after.usage).toMatchObject({ requests_total: 2, responses_2xx: 1, responses_4xx: 1, rate_limited: 1, latency_ms: { max: 12, samples: 2 } });
    expect(after.usage?.keys).toEqual([expect.objectContaining({ key_id: analyst.key_id, requests: 2 })]);
    const foreign = await queryStudioService.getUsage(other);
    expect(foreign.usage?.requests_total).toBe(1);
  });
});

describe('Query Studio HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, ...fns: Handler[]) => { gets.set(path, fns[fns.length - 1]); return app; }),
      post: jest.fn((path: string, ...fns: Handler[]) => { posts.set(path, fns[fns.length - 1]); return app; }),
      delete: jest.fn(() => app),
    };
    queryStudioRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  function response(locals: Record<string, unknown> = {}) {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, locals, status: jest.fn(), json: jest.fn(), send: jest.fn() });
    res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
    return res;
  }

  afterEach(() => { queryStudioService.useEngine(undefined); });

  it('answers schema and execute with a 503 naming the unconfigured engine', async () => {
    queryStudioService.useEngine(null);
    const { gets, posts } = mount();
    const res = response();
    await gets.get('/api/v1/intelligence/query/schema')!({ query: {}, headers: {} } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0]).toMatchObject({ stage: 'unavailable-query-engine', reason: 'unconfigured' });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('tables');

    const exec = response();
    await posts.get('/api/v1/intelligence/query/execute')!({ body: { sql: 'SELECT height FROM blocks' }, headers: {} } as unknown as Request, exec as unknown as Response);
    expect(exec.status).toHaveBeenCalledWith(503);
    expect(exec.json.mock.calls[0][0]).not.toHaveProperty('rows');
  });

  it('answers a grammar rejection with a 400 and a fixture query with rows, recording history for the key holder', async () => {
    const { analystKey, analyst } = await owners();
    queryStudioService.useEngine(new FakeEngine(() => ({ rows: fixtureRows, columns: ['height', 'hash', 'total_output_amt'] })));
    const { gets, posts } = mount();
    const execute = posts.get('/api/v1/intelligence/query/execute')!;

    const bad = response();
    await execute({ body: { sql: 'DROP TABLE blocks' }, headers: {} } as unknown as Request, bad as unknown as Response);
    expect(bad.status).toHaveBeenCalledWith(400);
    expect(bad.json.mock.calls[0][0]).toMatchObject({ stage: 'rejected-by-grammar' });

    const ok = response();
    await execute({ body: { sql: 'SELECT height, hash, total_output_amt FROM blocks LIMIT 2' }, headers: { authorization: 'Bearer ' + analystKey } } as unknown as Request, ok as unknown as Response);
    expect(ok.status).not.toHaveBeenCalledWith(503);
    expect(ok.json.mock.calls[0][0]).toMatchObject({ row_count: 2, rows: fixtureRows });

    const history = response();
    await gets.get('/api/v1/intelligence/query/history')!({ headers: { authorization: 'Bearer ' + analystKey } } as unknown as Request, history as unknown as Response);
    expect(history.json.mock.calls[0][0]).toMatchObject({ count: 1, scope: 'owner' });
    expect(history.json.mock.calls[0][0].history[0].owner_id).toBe(analyst.owner_id);

    const anonymous = response();
    await gets.get('/api/v1/intelligence/query/history')!({ headers: {} } as unknown as Request, anonymous as unknown as Response);
    expect(anonymous.json.mock.calls[0][0]).toMatchObject({ count: 0 });

    const wrongKey = response();
    await execute({ body: { sql: 'SELECT height FROM blocks' }, headers: { authorization: 'Bearer uip_live_nope' } } as unknown as Request, wrongKey as unknown as Response);
    expect(wrongKey.status).toHaveBeenCalledWith(401);
  });

  it('answers usage for the authenticated owner only and 401 without one', async () => {
    const { analyst } = await owners();
    const { gets } = mount();
    const usage = gets.get('/api/v1/intelligence/developer/usage')!;
    const unauthenticated = response();
    await usage({ query: {}, headers: {} } as unknown as Request, unauthenticated as unknown as Response);
    expect(unauthenticated.status).toHaveBeenCalledWith(401);
    const res = response({ owner: analyst });
    await usage({ query: {}, headers: {} } as unknown as Request, res as unknown as Response);
    expect(res.json.mock.calls[0][0]).toMatchObject({ owner_id: analyst.owner_id, state: 'no-observations' });
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('requests_total');
  });
});
