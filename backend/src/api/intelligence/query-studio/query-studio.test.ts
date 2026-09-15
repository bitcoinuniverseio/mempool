import { Application, Request, Response } from 'express';
import queryStudioRoutes from './query-studio.routes';
import { QueryStudioEvidenceError, queryStudioService } from './query-studio.service';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';

/**
 * These assertions replace a suite that asserted the constants the service used
 * to return: two invented mempool rows for any SELECT, a schema for a sandbox
 * that was never connected, and a seeded saved query owned by 'dev-admin'.
 * Passing those proved the constants were present, not that any query ran.
 */
describe('Product 9: Developer Data Platform and Query Studio', () => {
  const unavailable = (code: string) => expect.objectContaining({ code, status: 503 });

  it('reports the missing analytics replica rather than a schema for an unconnected sandbox', () => {
    expect(() => queryStudioService.getSchema()).toThrow(unavailable('unavailable-query-engine'));
  });

  it('reports the missing analytics replica rather than invented rows for a policy-compliant SELECT', () => {
    const sql = 'SELECT txid, fee_sats, vsize, feerate FROM mempool_transactions WHERE feerate > 10 LIMIT 10';
    expect(() => queryStudioService.executeQuery(sql)).toThrow(unavailable('unavailable-query-engine'));
    expect(queryStudioService.getHistory()).toEqual([]);
  });

  it('still rejects non-SELECT queries and dangerous SQL keywords before naming a source', () => {
    expect(() => {
      queryStudioService.executeQuery('DROP TABLE mempool_transactions');
    }).toThrow(/Security policy violation/);

    expect(() => {
      queryStudioService.executeQuery('DELETE FROM mempool_transactions WHERE 1=1');
    }).toThrow(/Security policy violation/);

    expect(() => {
      queryStudioService.executeQuery('UPDATE mempool_transactions SET fee_sats = 0');
    }).toThrow(/Security policy violation/);

    expect(() => {
      queryStudioService.executeQuery('SELECT * FROM mempool_transactions; DROP TABLE mempool_checkpoints');
    }).toThrow(/Multiple statements/);
  });

  it('never resolves an absent source as an empty result set', () => {
    for (const read of [
      () => queryStudioService.getSchema(),
      () => queryStudioService.executeQuery('SELECT 1'),
    ]) {
      let resolved: unknown = 'unresolved';
      try {
        resolved = read();
      } catch (e) {
        expect(e).toBeInstanceOf(QueryStudioEvidenceError);
        continue;
      }
      throw new Error(`resolved with ${JSON.stringify(resolved)}`);
    }
  });

  it('keeps saved queries per authenticated owner, durably and bounded', async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    const a = await developerIdentity.bootstrapOwner('analyst', '203.0.113.1');
    const b = await developerIdentity.bootstrapOwner('other', '203.0.113.2');
    const analyst: AuthenticatedOwner = (await developerIdentity.authenticateKey(a.secret_key))!;
    const other: AuthenticatedOwner = (await developerIdentity.authenticateKey(b.secret_key))!;
    expect(await queryStudioService.getSavedQueries(analyst)).toEqual([]);

    const title = 'High Priority Mempool Packages';
    const sql = 'SELECT txid, feerate FROM mempool_transactions ORDER BY feerate DESC LIMIT 50';
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
    developerIdentity.resolver = async () => [{ address: '203.0.113.9', family: 4 }];
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

  it.each([
    ['/api/v1/intelligence/developer/usage', 'unavailable-usage-metrics'],
    ['/api/v1/intelligence/query/schema', 'unavailable-query-engine'],
  ])('answers %s with a 503 that names the missing source', async (path, stage) => {
    const { gets } = mount();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await gets.get(path)!({ query: {} } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.stage).toBe(stage);
    expect(body).not.toHaveProperty('tables');
    expect(body).not.toHaveProperty('requests_total');
  });

  it('answers a policy-compliant execute with a 503 and a policy violation with a 400', async () => {
    const { posts } = mount();
    const execute = posts.get('/api/v1/intelligence/query/execute')!;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await execute({ body: { sql: 'SELECT 1' } } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ stage: 'unavailable-query-engine' }));
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('rows');

    const bad = { status: jest.fn().mockReturnThis(), json: jest.fn(), send: jest.fn() };
    await execute({ body: { sql: 'DROP TABLE x' }, accepts: () => true } as unknown as Request, bad as unknown as Response);
    expect(bad.status).toHaveBeenCalledWith(400);
  });
});
