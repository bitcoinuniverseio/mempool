import * as crypto from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { DeveloperIdentityManager, DeveloperApiKeyRecord } from '../identity/developer-identity';

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
  user_id: string;
  title: string;
  sql: string;
  created_at: string;
  updated_at: string;
}

export class QueryStudioService {
  private static instance: QueryStudioService;
  private savedQueries: Map<string, SavedQueryRecord> = new Map();
  private queryHistory: Array<{ query_id: string; sql: string; executed_at: string; duration_ms: number }> = [];

  private constructor() {
    this.seedDefaultSavedQueries();
  }

  public static getInstance(): QueryStudioService {
    if (!QueryStudioService.instance) {
      QueryStudioService.instance = new QueryStudioService();
    }
    return QueryStudioService.instance;
  }

  private seedDefaultSavedQueries(): void {
    const q1Id = 'query-top-feerates';
    this.savedQueries.set(q1Id, {
      query_id: q1Id,
      user_id: 'dev-admin',
      title: 'Top Mempool Fee Rates',
      sql: 'SELECT txid, fee_sats, vsize, feerate FROM mempool_transactions ORDER BY feerate DESC LIMIT 20',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  public getSchema(): TableSchemaInfo[] {
    return [
      {
        table_name: 'mempool_transactions',
        description: 'Current real-time unconfirmed transactions in the Universe node mempool',
        columns: [
          { name: 'txid', type: 'VARCHAR(64)', nullable: false, is_primary_key: true },
          { name: 'fee_sats', type: 'BIGINT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'vsize', type: 'INT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'weight', type: 'INT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'feerate', type: 'DECIMAL(10,2)', nullable: false, is_primary_key: false },
          { name: 'first_seen_utc', type: 'DATETIME', nullable: false, is_primary_key: false },
        ],
        indexes: ['PRIMARY (txid)', 'idx_feerate (feerate DESC)'],
      },
      {
        table_name: 'mempool_checkpoints',
        description: 'Verified historical mempool state snapshots and checkpoints',
        columns: [
          { name: 'checkpoint_id', type: 'VARCHAR(64)', nullable: false, is_primary_key: true },
          { name: 'block_height', type: 'INT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'tx_count', type: 'INT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'total_weight', type: 'BIGINT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'total_fees_sats', type: 'BIGINT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'state_hash', type: 'CHAR(64)', nullable: false, is_primary_key: false },
        ],
        indexes: ['PRIMARY (checkpoint_id)', 'idx_height (block_height)'],
      },
      {
        table_name: 'relay_sensor_observations',
        description: 'Observed propagation delays across geographically distributed Universe nodes',
        columns: [
          { name: 'id', type: 'BIGINT UNSIGNED', nullable: false, is_primary_key: true },
          { name: 'txid', type: 'VARCHAR(64)', nullable: false, is_primary_key: false },
          { name: 'sensor_id', type: 'VARCHAR(64)', nullable: false, is_primary_key: false },
          { name: 'delta_from_first_ms', type: 'INT UNSIGNED', nullable: false, is_primary_key: false },
          { name: 'transport_type', type: 'VARCHAR(16)', nullable: false, is_primary_key: false },
        ],
        indexes: ['PRIMARY (id)', 'idx_txid (txid)'],
      },
    ];
  }

  public executeQuery(sql: string, maxRows = 100): QueryExecutionResult {
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

    const queryId = EventEnvelopeValidator.generateUuidV7();
    const startTime = Date.now();

    // Deterministic safe execution mock with realistic records
    const dummyRows: Array<Record<string, unknown>> = [
      {
        txid: '3b8908fef9b8098c772274b7c1265882e70c8cf865d1d6cb58a74e54e44f479d',
        fee_sats: 1540,
        vsize: 140,
        feerate: 11.0,
        first_seen_utc: new Date(Date.now() - 30000).toISOString(),
      },
      {
        txid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
        fee_sats: 2890,
        vsize: 210,
        feerate: 13.76,
        first_seen_utc: new Date(Date.now() - 45000).toISOString(),
      },
    ];

    const duration = Date.now() - startTime + 2;
    this.queryHistory.unshift({
      query_id: queryId,
      sql: trimmed,
      executed_at: new Date().toISOString(),
      duration_ms: duration,
    });
    if (this.queryHistory.length > 50) this.queryHistory.pop();

    return {
      query_id: queryId,
      sql: trimmed,
      columns: ['txid', 'fee_sats', 'vsize', 'feerate', 'first_seen_utc'],
      rows: dummyRows.slice(0, maxRows),
      row_count: Math.min(dummyRows.length, maxRows),
      execution_time_ms: duration,
      truncated: false,
    };
  }

  public getHistory(): Array<{ query_id: string; sql: string; executed_at: string; duration_ms: number }> {
    return this.queryHistory;
  }

  public saveQuery(userId: string, title: string, sql: string): SavedQueryRecord {
    const id = EventEnvelopeValidator.generateUuidV7();
    const saved: SavedQueryRecord = {
      query_id: id,
      user_id: userId,
      title,
      sql,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.savedQueries.set(id, saved);
    return saved;
  }

  public getSavedQueries(userId: string): SavedQueryRecord[] {
    return Array.from(this.savedQueries.values()).filter(
      (q) => q.user_id === userId || q.user_id === 'dev-admin'
    );
  }
}

export const queryStudioService = QueryStudioService.getInstance();
