import { queryStudioService } from './query-studio.service';
import { DeveloperIdentityManager } from '../identity/developer-identity';

describe('Product 9: Developer Data Platform and Query Studio', () => {
  it('exposes sandboxed table schemas and column definitions', () => {
    const schema = queryStudioService.getSchema();
    expect(schema.length).toBeGreaterThanOrEqual(3);

    const txTable = schema.find((t) => t.table_name === 'mempool_transactions');
    expect(txTable).toBeDefined();
    expect(txTable?.columns.some((c) => c.name === 'txid' && c.is_primary_key)).toBe(true);
    expect(txTable?.columns.some((c) => c.name === 'fee_sats')).toBe(true);
  });

  it('executes safe read-only SELECT queries', () => {
    const sql = 'SELECT txid, fee_sats, vsize, feerate FROM mempool_transactions WHERE feerate > 10 LIMIT 10';
    const result = queryStudioService.executeQuery(sql);

    expect(result.query_id).toBeDefined();
    expect(result.columns).toContain('txid');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.execution_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('strictly rejects non-SELECT queries and dangerous SQL keywords', () => {
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

  it('records query history and persists saved queries', () => {
    const title = 'High Priority Mempool Packages';
    const sql = 'SELECT txid, feerate FROM mempool_transactions ORDER BY feerate DESC LIMIT 50';

    const saved = queryStudioService.saveQuery('dev-analyst-01', title, sql);
    expect(saved.query_id).toBeDefined();

    const queries = queryStudioService.getSavedQueries('dev-analyst-01');
    expect(queries.some((q) => q.query_id === saved.query_id)).toBe(true);

    const history = queryStudioService.getHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it('blocks SSRF attempts in developer webhook registration', () => {
    expect(() => {
      DeveloperIdentityManager.registerWebhook(
        'dev-user-01',
        'http://169.254.169.254/latest/meta-data/',
        ['mempool.evaluated']
      );
    }).toThrow(/SSRF Protection/);

    expect(() => {
      DeveloperIdentityManager.registerWebhook(
        'dev-user-01',
        'http://localhost:8080/callback',
        ['mempool.evaluated']
      );
    }).toThrow(/SSRF Protection/);

    const validHook = DeveloperIdentityManager.registerWebhook(
      'dev-user-01',
      'https://api.externalpartner.org/webhooks/mempool',
      ['mempool.evaluated']
    );
    expect(validHook.webhook_id).toBeDefined();
    expect(validHook.secret).toBeDefined();
  });
});
