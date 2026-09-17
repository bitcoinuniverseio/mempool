import { ChangeDetectorRef } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { StateService } from '@app/services/state.service';
import { DeveloperPlatformComponent } from './developer-platform.component';
import { DeveloperUsageResult, IntelligenceApiService, QueryExecutionResult, QuerySchemaResult } from './intelligence-api.service';
import { OwnerKeyService } from './owner-key.service';
import { QueryStudioComponent, classifyQueryFailure } from './query-studio.component';

const schema: QuerySchemaResult = {
  network: 'signet',
  source: 'analytics replica',
  observed_at: '2026-09-17T00:00:00.000Z',
  tables: [{ table_name: 'mempool_transactions', description: 'Current mempool', columns: [{ name: 'txid', type: 'char(64)', nullable: false, is_primary_key: true }, { name: 'fee_sats', type: 'bigint', nullable: false, is_primary_key: false }], indexes: ['PRIMARY'] }],
  missing_tables: ['blocks'],
  grammar: 'One SELECT over one readable table.',
};

function page(overrides: Partial<QueryExecutionResult>): QueryExecutionResult {
  return {
    query_id: 'q1', sql: 'SELECT txid, fee_sats FROM mempool_transactions', executed_sql: 'SELECT ...', columns: ['txid', 'fee_sats'],
    rows: [{ txid: 'ab'.repeat(32), fee_sats: '9007199254740993' }], row_count: 1, execution_time_ms: 3, truncated: false, next_cursor: null,
    source: { engine: 'mysql', table: 'mempool_transactions', network: 'signet', deadline_ms: 5000, max_rows: 100, result_bytes_limit: 1048576 }, precision: 'BIGINT and DECIMAL values are exact strings.',
    ...overrides,
  };
}

function studio(api: Partial<IntelligenceApiService>): QueryStudioComponent {
  const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  const state = { networkChanged$: new Subject<string>() } as unknown as StateService;
  const owner = { key$: new Subject<string | null>(), key: null } as unknown as OwnerKeyService;
  const c = new QueryStudioComponent({ getQuerySchema$: () => of(schema), ...api } as IntelligenceApiService, cdr, state, owner);
  c.ngOnInit();
  return c;
}

describe('Query Studio schema discovery', () => {
  it('renders the discovered tables, missing tables and grammar', () => {
    const c = studio({});
    expect(c.schema.map((t) => t.table_name)).toEqual(['mempool_transactions']);
    expect(c.schemaInfo?.missing_tables).toEqual(['blocks']);
    expect(c.schemaError).toBeNull();
    expect(c.schemaLoading).toBe(false);
  });

  it('reports an unconfigured engine as that, not as an empty schema', () => {
    const c = studio({ getQuerySchema$: () => throwError(() => ({ status: 503, error: { stage: 'unavailable-query-engine', reason: 'unconfigured', error: 'Query Studio results are unavailable.' } })) });
    expect(c.schema).toEqual([]);
    expect(c.schemaError?.kind).toBe('engine');
    expect(c.schemaError?.reason).toBe('unconfigured');
    expect(c.failureTitle(c.schemaError!)).toContain('No analytics replica');
  });
});

describe('Query Studio execution', () => {
  it('renders rows with exact strings and no expectation of failure', () => {
    const executeDevQuery$ = vi.fn(() => of(page({})));
    const c = studio({ executeDevQuery$ });
    c.sqlQuery = 'SELECT txid, fee_sats FROM mempool_transactions';
    c.executeQuery();
    expect(executeDevQuery$).toHaveBeenCalledWith('SELECT txid, fee_sats FROM mempool_transactions', 100, undefined);
    expect(c.queryError).toBeNull();
    expect(c.loading).toBe(false);
    expect(c.rows).toHaveLength(1);
    expect(c.cell(c.rows[0]['fee_sats'])).toBe('9007199254740993');
    expect(c.cell(null)).toBe('NULL');
  });

  it('pages through an opaque cursor and appends rows', () => {
    const executeDevQuery$ = vi.fn()
      .mockReturnValueOnce(of(page({ truncated: true, next_cursor: 'cursor-1' })))
      .mockReturnValueOnce(of(page({ rows: [{ txid: 'cd'.repeat(32), fee_sats: '1' }], next_cursor: null })));
    const c = studio({ executeDevQuery$ });
    c.sqlQuery = 'SELECT txid, fee_sats FROM mempool_transactions';
    c.executeQuery();
    expect(c.queryResult?.truncated).toBe(true);
    expect(c.queryResult?.next_cursor).toBe('cursor-1');
    c.loadMore();
    expect(executeDevQuery$).toHaveBeenLastCalledWith('SELECT txid, fee_sats FROM mempool_transactions', 100, 'cursor-1');
    expect(c.rows).toHaveLength(2);
    expect(c.queryResult?.next_cursor).toBeNull();
    c.loadMore();
    expect(executeDevQuery$).toHaveBeenCalledTimes(2);
  });

  it('shows an empty page as no rows matched, not as a failure', () => {
    const c = studio({ executeDevQuery$: () => of(page({ rows: [], row_count: 0 })) });
    c.sqlQuery = 'SELECT txid FROM mempool_transactions';
    c.executeQuery();
    expect(c.queryError).toBeNull();
    expect(c.rows).toEqual([]);
    expect(c.queryResult?.row_count).toBe(0);
  });

  it.each([
    [400, { stage: 'rejected-by-grammar', error: 'Security policy violation: joins are not allowed.', position: 12 }, 'grammar', 'grammar'],
    [503, { stage: 'unavailable-query-engine', reason: 'unconfigured', error: 'Query Studio results are unavailable.' }, 'engine', 'No analytics replica'],
    [503, { stage: 'unavailable-query-engine', reason: 'invalid-dsn', error: 'The DSN is malformed.' }, 'engine', 'unavailable'],
    [504, { stage: 'unavailable-query-engine', reason: 'deadline', error: 'The query exceeded 5000 ms.' }, 'deadline', 'deadline'],
  ])('classifies the %s failure', (status, body, kind, title) => {
    const c = studio({ executeDevQuery$: () => throwError(() => ({ status, error: body })) });
    c.sqlQuery = 'SELECT 1';
    c.executeQuery();
    expect(c.queryResult).toBeNull();
    expect(c.queryError?.kind).toBe(kind);
    expect(c.queryError?.message).toBe(body.error);
    expect(c.failureTitle(c.queryError!)).toContain(title);
    if (kind === 'grammar') expect(c.queryError?.position).toBe(12);
  });

  it('keeps loaded rows when a later page fails and drops a late answer after an edit', () => {
    const later = new Subject<QueryExecutionResult>();
    const executeDevQuery$ = vi.fn()
      .mockReturnValueOnce(of(page({ next_cursor: 'cursor-1' })))
      .mockReturnValueOnce(throwError(() => ({ status: 504, error: { stage: 'unavailable-query-engine', reason: 'deadline', error: 'deadline' } })))
      .mockReturnValueOnce(later);
    const c = studio({ executeDevQuery$ });
    c.sqlQuery = 'SELECT txid FROM mempool_transactions';
    c.executeQuery();
    c.loadMore();
    expect(c.rows).toHaveLength(1);
    expect(c.queryError?.kind).toBe('deadline');
    c.executeQuery();
    c.sqlQuery = 'SELECT fee_sats FROM mempool_transactions';
    c.invalidate();
    later.next(page({}));
    expect(c.queryResult).toBeNull();
    expect(c.rows).toEqual([]);
  });

  it('classifies a transport failure without a body as other', () => {
    expect(classifyQueryFailure({ status: 0 }, 'fallback')).toEqual({ kind: 'other', stage: null, reason: null, position: null, message: 'fallback' });
  });
});

describe('Developer usage observation states', () => {
  const ownerKey = { key$: of('uip_live_' + 'a'.repeat(48)), key: 'uip_live_' + 'a'.repeat(48), headers: () => ({}), set: () => undefined, clear: () => undefined } as unknown as OwnerKeyService;
  const cdr = { markForCheck: vi.fn() } as unknown as ChangeDetectorRef;
  const base = { getDeveloperKeys$: () => of({ keys: [] }), getWebhooks$: () => of({ webhooks: [] }) };
  const coverage = { observer_id: 'backend-1', persistence: 'process-memory-only', observed_since: '2026-09-17T00:00:00.000Z', observed_at: '2026-09-17T01:00:00.000Z', scope: 'this instance' };
  const quota = { keys: [{ key_id: 'k1', name: 'ci', rate_limit_per_minute: 60, last_used_at: null, revoked: false }], source: 'owner store' };

  it('renders observed counts, quota and latency', () => {
    const usage: DeveloperUsageResult = { owner_id: 'o1', network: 'signet', state: 'observed', usage: { requests_total: 5, responses_2xx: 4, responses_4xx: 1, responses_5xx: 0, rate_limited: 0, latency_ms: { p50: 3, p95: 9, max: 12, samples: 5 }, keys: [{ key_id: 'k1', requests: 5, first_observed_at: 'a', last_observed_at: 'b' }], first_observed_at: 'a', last_observed_at: 'b' }, quota, coverage };
    const cmp = new DeveloperPlatformComponent({ ...base, getDeveloperUsage$: () => of(usage) } as unknown as IntelligenceApiService, ownerKey, cdr);
    cmp.ngOnInit();
    expect(cmp.usage?.state).toBe('observed');
    expect(cmp.usage?.usage?.requests_total).toBe(5);
    expect(cmp.usageError).toBeNull();
  });

  it('renders no-observations as that state, and a failed read as unavailable', () => {
    const none: DeveloperUsageResult = { owner_id: 'o1', network: 'signet', state: 'no-observations', usage: null, quota, coverage };
    const cmp = new DeveloperPlatformComponent({ ...base, getDeveloperUsage$: () => of(none) } as unknown as IntelligenceApiService, ownerKey, cdr);
    cmp.ngOnInit();
    expect(cmp.usage?.state).toBe('no-observations');
    expect(cmp.usage?.usage).toBeNull();

    const failed = new DeveloperPlatformComponent({ ...base, getDeveloperUsage$: () => throwError(() => ({ status: 503, error: { error: 'ledger down' } })) } as unknown as IntelligenceApiService, ownerKey, cdr);
    failed.ngOnInit();
    expect(failed.usage).toBeNull();
    expect(failed.usageError).toBe('ledger down');

    const shapeless = new DeveloperPlatformComponent({ ...base, getDeveloperUsage$: () => of({ monthly_requests: 3 } as any) } as unknown as IntelligenceApiService, ownerKey, cdr);
    shapeless.ngOnInit();
    expect(shapeless.usage).toBeNull();
    expect(shapeless.usageError).toContain('observation state');
  });
});
