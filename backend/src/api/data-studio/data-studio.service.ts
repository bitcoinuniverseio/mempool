import { GENESIS } from '../intelligence/utxo/utxo-evidence';
import config from '../../config';
import cluster from 'cluster';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { HistoryStore, historyPathForRole } from '../intelligence/time-machine/history-store';
import {
  DataSource,
  DataSnapshot,
  OwnedDataSource,
  DataStudioEvidenceError,
  LIMITS,
  snapshotDigest,
  sha,
} from './data-studio-source';
import { DatasetManifest, QueryRequest, QueryResult } from './data-studio.types';
export { DataStudioEvidenceError } from './data-studio-source';
export const FIELDS: Record<string, Record<string, 'string' | 'integer'>> = {
  'bitcoin.blocks': {
    height: 'integer',
    hash: 'string',
    previous_hash: 'string',
    merkle_root: 'string',
    time: 'integer',
    version: 'integer',
    bits: 'integer',
    nonce: 'integer',
    header_hex: 'string',
  },
  'bitcoin.mempool': { txid: 'string' },
};
export const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['datasetId'],
  properties: {
    datasetId: { type: 'string', enum: Object.keys(FIELDS) },
    snapshotId: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    fields: { type: 'array', maxItems: 9, items: { type: 'string' } },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
    offset: { type: 'integer', minimum: 0, maximum: 10000 },
    orderBy: { type: 'string' },
    orderDirection: { enum: ['asc', 'desc'] },
    filters: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'operator', 'value'],
        properties: {
          field: { type: 'string' },
          operator: { enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'] },
          value: {},
        },
      },
    },
  },
};
export const MCP_TOOLS = [
  {
    name: 'data_catalog',
    description: 'Read the actual bounded owned-node snapshot catalog.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'data_query',
    description: 'Run a validated typed query against an immutable owned dataset snapshot.',
    inputSchema: QUERY_SCHEMA,
  },
];
export interface DataEvent {
  id: string;
  sequence: number;
  network: string;
  kind: 'snapshot' | 'observation_gap';
  observedAt: string;
  snapshotId: string;
  scope: string;
}
export function exportBytes(rows: Record<string, unknown>[], fields: string[], format: string): Buffer {
  if (format === 'json') return Buffer.from(JSON.stringify(rows) + '\n');
  if (format === 'ndjson')
    return Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  if (format === 'csv') {
    const escape = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
    return Buffer.from(
      fields.map(escape).join(',') +
        '\r\n' +
        rows.map((row) => fields.map((f) => escape(row[f])).join(',')).join('\r\n') +
        (rows.length ? '\r\n' : '')
    );
  }
  throw new DataStudioEvidenceError('unsupported-export-format', 'Supported formats are json, ndjson and csv.', 400);
}
export class DataStudioService {
  private store: HistoryStore | null = null;
  private loaded = false;
  private failure = false;
  private flight: Promise<DataSnapshot> | null = null;
  private sourceWork: Promise<DataSnapshot> | null = null;
  private pendingGap = false;
  private listeners = new Set<(event: DataEvent) => void>();
  private state: {
    schema: string;
    network: string;
    epoch: string;
    sequence: number;
    snapshots: DataSnapshot[];
    events: DataEvent[];
  } = { schema: 'data-studio-state-v1', network: '', epoch: randomUUID(), sequence: 0, snapshots: [], events: [] };
  constructor(
    private source: DataSource = new OwnedDataSource(),
    private path: string | null = historyPathForRole(
      process.env.UNIVERSE_DATA_STUDIO_PATH ??
        join(config.MEMPOOL.CACHE_DIR, 'data-studio', config.MEMPOOL.NETWORK + '.json.gz'),
      !!config.MEMPOOL.SPAWN_CLUSTER_PROCS,
      cluster.isPrimary,
      process.env.workerId
    )
  ) {
    this.state.network = this.source.network;
  }
  private load() {
    if (this.failure)
      throw new DataStudioEvidenceError('data-storage-invalid', 'Owned dataset persistence failed validation.');
    if (this.loaded) return;
    try {
      if (!this.path) throw Error('No writer role');
      this.store = new HistoryStore(this.path, this.source.network);
      const s: any = this.store.read();
      if (s) {
        if (
          s.schema !== 'data-studio-state-v1' ||
          s.network !== this.source.network ||
          !/^[a-f0-9-]{36}$/.test(s.epoch) ||
          !Number.isSafeInteger(s.sequence) ||
          s.sequence < 0 ||
          !Array.isArray(s.snapshots) ||
          s.snapshots.length > 8 ||
          !Array.isArray(s.events) ||
          s.events.length > 64
        )
          throw Error('Invalid state');
        for (const snap of s.snapshots) this.validateSnapshot(snap);
        let previous = 0;
        for (const event of s.events) {
          if (
            event.network !== s.network ||
            !Number.isSafeInteger(event.sequence) ||
            event.sequence <= previous ||
            event.sequence > s.sequence ||
            event.id !== s.epoch + ':' + event.sequence ||
            !['snapshot', 'observation_gap'].includes(event.kind) ||
            !/^[a-f0-9]{64}$/.test(event.snapshotId)
          )
            throw Error('Invalid event');
          previous = event.sequence;
        }
        this.state = s;
        this.pendingGap = true;
      }
      this.loaded = true;
    } catch {
      this.failure = true;
      this.store?.close();
      throw new DataStudioEvidenceError(
        'data-storage-invalid',
        'Owned dataset persistence or exclusive writer validation failed.'
      );
    }
  }
  private validateSnapshot(s: any) {
    if (
      s?.schema !== 'owned-data-v1' ||
      s.network !== this.source.network ||
      s.genesis !== GENESIS[this.source.network] ||
      s.id !== snapshotDigest(s) ||
      !Number.isFinite(Date.parse(s.observedAt)) ||
      !/^[a-f0-9]{64}$/.test(s.tipHash) ||
      !Number.isSafeInteger(s.tipHeight) ||
      s.tipHeight < 0 ||
      !s.datasets ||
      typeof s.datasets !== 'object'
    )
      throw Error('Invalid snapshot');
    for (const [id, rows] of Object.entries(s.datasets)) {
      if (!FIELDS[id] || !Array.isArray(rows) || rows.length > (id === 'bitcoin.blocks' ? 32 : 10000))
        throw Error('Invalid dataset');
      for (const row of rows) {
        if (!row || Object.keys(row).length !== Object.keys(FIELDS[id]).length) throw Error('Invalid row');
        for (const [field, type] of Object.entries(FIELDS[id]))
          if (
            type === 'integer'
              ? typeof row[field] !== 'number' || !Number.isSafeInteger(row[field])
              : typeof row[field] !== 'string' || row[field].length > 256
          )
            throw Error('Invalid field');
      }
    }
  }
  async refresh(): Promise<DataSnapshot> {
    this.load();
    const last = this.state.snapshots.at(-1);
    if (
      !this.pendingGap &&
      last &&
      Date.now() - Date.parse(last.observedAt) >= 0 &&
      Date.now() - Date.parse(last.observedAt) < LIMITS.sourceFreshMs
    )
      return structuredClone(last);
    if (!this.flight) {
      const run = async () => {
        let timeout: NodeJS.Timeout | undefined;
        try {
          if (!this.sourceWork) {
            const work = this.source.read();
            this.sourceWork = work;
            void work
              .finally(() => {
                if (this.sourceWork === work) this.sourceWork = null;
              })
              .catch(() => undefined);
          }
          const snapshot = await Promise.race([
            this.sourceWork,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () =>
                  reject(new DataStudioEvidenceError('data-source-timeout', 'Owned snapshot collection timed out.')),
                LIMITS.sourceTimeoutMs
              );
            }),
          ]);
          this.validateSnapshot(snapshot);
          if (
            Date.now() - Date.parse(snapshot.observedAt) < 0 ||
            Date.now() - Date.parse(snapshot.observedAt) > LIMITS.sourceFreshMs
          )
            throw new DataStudioEvidenceError('data-source-stale', 'Owned snapshot is outside the freshness bound.');
          const previous = this.state;
          const next = structuredClone(previous);
          next.snapshots.push(snapshot);
          next.snapshots = next.snapshots.slice(-8);
          const newEvents: DataEvent[] = [];
          for (const kind of this.pendingGap ? (['observation_gap', 'snapshot'] as const) : (['snapshot'] as const)) {
            const sequence = ++next.sequence;
            const event: DataEvent = {
              id: next.epoch + ':' + sequence,
              sequence,
              network: this.source.network,
              kind,
              observedAt: snapshot.observedAt,
              snapshotId: snapshot.id,
              scope:
                kind === 'observation_gap'
                  ? 'Process restart: intermediate node changes were not observed.'
                  : 'Owned bounded dataset snapshot persisted. Polling does not enumerate every transaction arrival/removal.',
            };
            next.events.push(event);
            newEvents.push(event);
          }
          next.events = next.events.slice(-64);
          if (Buffer.byteLength(JSON.stringify(next)) > 32 * 1024 * 1024)
            throw new DataStudioEvidenceError('data-storage-bound', 'Dataset persistence exceeds32MiB.');
          await this.store!.write(next);
          this.state = next;
          this.pendingGap = false;
          for (const event of newEvents)
            for (const listener of this.listeners) {
              try {
                listener(event);
              } catch {
                this.listeners.delete(listener);
              }
            }
          return structuredClone(snapshot);
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      };
      this.flight = run();
      void this.flight
        .finally(() => {
          this.flight = null;
        })
        .catch(() => undefined);
    }
    return this.flight;
  }
  async snapshot(id?: string) {
    this.load();
    if (id !== undefined) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
        throw new DataStudioEvidenceError('invalid-snapshot-id', 'Snapshot identity must be a SHA256.', 400);
      const s = this.state.snapshots.find((s) => s.id === id);
      if (!s)
        throw new DataStudioEvidenceError(
          'snapshot-expired',
          'Snapshot is unknown or outside the eight-snapshot retention window.',
          410
        );
      return structuredClone(s);
    }
    return this.refresh();
  }
  async $getCatalog() {
    const s = await this.refresh();
    const datasets: DatasetManifest[] = Object.entries(s.datasets).map(([id, rows]) => {
      const encodedFormats: Record<string, { bytes: number; sha256: string; endpoint: string }> = {};
      for (const format of ['json', 'ndjson', 'csv']) {
        const bytes = exportBytes(rows, Object.keys(FIELDS[id]), format);
        encodedFormats[format] = {
          bytes: bytes.length,
          sha256: sha(bytes),
          endpoint: `/api/v1/data/export/${s.id}/${id}?format=${format}`,
        };
      }
      return {
        id,
        name: id === 'bitcoin.blocks' ? 'Owned canonical block headers' : 'Owned mempool transaction IDs',
        category: id === 'bitcoin.blocks' ? 'blockchain' : 'mempool',
        description: s.scope,
        updateFrequency: 'realtime',
        rowCountEstimate: String(rows.length),
        sizeEstimateBytes: String(encodedFormats.ndjson.bytes),
        rowCount: rows.length,
        sizeBytes: encodedFormats.ndjson.bytes,
        snapshotId: s.id,
        network: s.network,
        observedAt: s.observedAt,
        supportedFormats: ['json', 'ndjson', 'csv'],
        fields: Object.entries(FIELDS[id]).map(([name, type]) => ({
          name,
          type,
          description: 'Owned Core snapshot field',
        })),
        exports: encodedFormats,
        coverage:
          id === 'bitcoin.blocks'
            ? { fromHeight: rows[0]?.height, toHeight: s.tipHeight, fullBlockchain: false }
            : { completeAtObservation: true, mempoolSequence: s.mempoolSequence },
      };
    });
    return {
      datasets,
      streams: [
        {
          id: 'data.snapshots',
          name: 'Persisted owned snapshot observations',
          endpoint: '/api/v1/data/live/snapshots',
          transport: 'sse',
          description: 'Snapshot observations with bounded persisted resume. Restart gaps are explicit.',
          schemaRef: 'owned-data-event-v1',
          messageRatePerSec: null,
          resumeScope: 'Last64 persisted events from this network and writer; not every node transaction event.',
        },
      ],
      mcpTools: MCP_TOOLS.map((t) => ({
        ...t,
        parameters: t.inputSchema,
        sampleCall: JSON.stringify({
          method: 'tools/call',
          params: {
            name: t.name,
            arguments: t.name === 'data_query' ? { datasetId: 'bitcoin.blocks', snapshotId: s.id, limit: 2 } : {},
          },
        }),
      })),
      snapshotId: s.id,
      source: {
        network: s.network,
        genesis: s.genesis,
        tipHash: s.tipHash,
        tipHeight: s.tipHeight,
        observedAt: s.observedAt,
      },
      unavailable: s.unavailable,
      scope: s.scope,
      unsupportedAcceptance: [
        'Parquet export',
        'Full historical blockchain/protocol datasets',
        'SQL grammar',
        'WebSocket transport',
        'Complete transaction-by-transaction durable event history',
        'Shared distributed snapshot storage',
      ],
      mcpEndpoint: '/api/v1/data/mcp/rpc',
    };
  }
  validateQuery(q: any): asserts q is QueryRequest {
    const bad = (message: string) => {
      throw new DataStudioEvidenceError('invalid-query', message, 400);
    };
    if (
      !q ||
      typeof q !== 'object' ||
      Array.isArray(q) ||
      Object.keys(q).some(
        (k) =>
          !['datasetId', 'snapshotId', 'fields', 'limit', 'offset', 'filters', 'orderBy', 'orderDirection'].includes(k)
      ) ||
      typeof q.datasetId !== 'string' ||
      !Object.prototype.hasOwnProperty.call(FIELDS, q.datasetId)
    )
      bad('Unknown dataset or query property.');
    const fields = FIELDS[q.datasetId];
    if (q.snapshotId !== undefined && (typeof q.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(q.snapshotId)))
      bad('Invalid snapshot identity.');
    for (const [key, min, max] of [
      ['limit', 1, 1000],
      ['offset', 0, 10000],
    ] as [string, number, number][])
      if (q[key] !== undefined && (!Number.isSafeInteger(q[key]) || q[key] < min || q[key] > max))
        bad('Invalid pagination bound.');
    if (
      q.fields !== undefined &&
      (!Array.isArray(q.fields) ||
        !q.fields.length ||
        q.fields.length > 9 ||
        new Set(q.fields).size !== q.fields.length ||
        q.fields.some((f) => typeof f !== 'string' || !Object.prototype.hasOwnProperty.call(fields, f)))
    )
      bad('Invalid projection.');
    if (q.orderBy !== undefined && !Object.prototype.hasOwnProperty.call(fields, q.orderBy))
      bad('Invalid order field.');
    if (q.orderDirection !== undefined && !['asc', 'desc'].includes(q.orderDirection)) bad('Invalid order direction.');
    if (q.filters !== undefined && (!Array.isArray(q.filters) || q.filters.length > 8)) bad('Invalid filter list.');
    for (const f of q.filters ?? []) {
      if (
        !f ||
        Object.keys(f).some((k) => !['field', 'operator', 'value'].includes(k)) ||
        !Object.prototype.hasOwnProperty.call(fields, f.field) ||
        !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'].includes(f.operator)
      )
        bad('Invalid typed filter.');
      const values = f.operator === 'in' ? f.value : [f.value];
      if (!Array.isArray(values) || !values.length || values.length > 50) bad('Invalid bounded membership filter.');
      for (const value of values)
        if (
          fields[f.field] === 'integer'
            ? typeof value !== 'number' || !Number.isSafeInteger(value)
            : typeof value !== 'string' || value.length > 256
        )
          bad('Filter value does not match field type.');
    }
  }
  async $executeQuery(query: QueryRequest): Promise<QueryResult> {
    this.validateQuery(query);
    const start = performance.now(),
      s = await this.snapshot(query.snapshotId),
      source = s.datasets[query.datasetId];
    if (!source)
      throw new DataStudioEvidenceError(
        'dataset-unavailable',
        s.unavailable[query.datasetId] ?? 'Dataset unavailable in this snapshot.'
      );
    let rows = source.filter((row) =>
      (query.filters ?? []).every((f) => {
        const a: any = row[f.field],
          b: any = f.value;
        return f.operator === 'eq'
          ? a === b
          : f.operator === 'neq'
            ? a !== b
            : f.operator === 'gt'
              ? a > b
              : f.operator === 'gte'
                ? a >= b
                : f.operator === 'lt'
                  ? a < b
                  : f.operator === 'lte'
                    ? a <= b
                    : b.includes(a);
      })
    );
    if (query.orderBy) {
      const field = query.orderBy,
        m = query.orderDirection === 'desc' ? -1 : 1;
      rows.sort((a: any, b: any) => (a[field] < b[field] ? -m : a[field] > b[field] ? m : 0));
    }
    const totalAvailable = rows.length,
      offset = query.offset ?? 0,
      limit = query.limit ?? 20,
      columns = query.fields ?? Object.keys(FIELDS[query.datasetId]);
    rows = rows.slice(offset, offset + limit);
    return {
      datasetId: query.datasetId,
      snapshotId: s.id,
      network: s.network,
      observedAt: s.observedAt,
      rowCount: rows.length,
      totalAvailable,
      executionTimeMs: performance.now() - start,
      columns,
      rows: rows.map((row) => columns.map((f) => row[f])),
      nextOffset: offset + rows.length < totalAvailable ? offset + rows.length : null,
      source: { tipHash: s.tipHash, tipHeight: s.tipHeight, scope: s.scope },
    };
  }
  async export(id: string, dataset: string, format: string) {
    const s = await this.snapshot(id);
    if (!Object.prototype.hasOwnProperty.call(FIELDS, dataset) || !s.datasets[dataset])
      throw new DataStudioEvidenceError(
        'dataset-unavailable',
        'Dataset is not present in this immutable snapshot.',
        404
      );
    const bytes = exportBytes(s.datasets[dataset], Object.keys(FIELDS[dataset]), format);
    return { bytes, sha256: sha(bytes), network: s.network, rowCount: s.datasets[dataset].length };
  }
  eventsAfter(cursor?: string) {
    this.load();
    if (!cursor) return structuredClone(this.state.events.slice(-1));
    const match = /^([a-f0-9-]{36}):(\d+)$/.exec(cursor);
    if (
      !match ||
      match[1] !== this.state.epoch ||
      !Number.isSafeInteger(Number(match[2])) ||
      Number(match[2]) > this.state.sequence ||
      Number(match[2]) < (this.state.events[0]?.sequence ?? 1) - 1
    )
      throw new DataStudioEvidenceError(
        'stream-cursor-expired',
        'Cursor belongs to another writer/network or exceeds retained event coverage.',
        410
      );
    return structuredClone(this.state.events.filter((e) => e.sequence > Number(match[2])));
  }
  subscribe(listener: (event: DataEvent) => void) {
    if (this.listeners.size >= 20)
      throw new DataStudioEvidenceError('stream-client-bound', 'Stream client capacity reached.', 429);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async close() {
    await this.flight?.catch(() => undefined);
    this.listeners.clear();
    this.store?.close();
  }
}
export const dataStudioService = new DataStudioService();
