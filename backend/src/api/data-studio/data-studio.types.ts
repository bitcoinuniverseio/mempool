/**
 * Types for the Universe Data Studio and Developer Platform.
 */

export interface DatasetManifest {
  readonly id: string;
  readonly name: string;
  readonly category: 'blockchain' | 'mempool' | 'protocols' | 'network';
  readonly description: string;
  readonly updateFrequency: 'realtime' | 'per-block' | 'hourly' | 'daily';
  readonly rowCountEstimate: string;
  readonly sizeEstimateBytes: string;
  readonly supportedFormats: readonly ('parquet' | 'ndjson' | 'csv' | 'json')[];
  readonly fields: readonly DatasetField[];
}

export interface DatasetField {
  readonly name: string;
  readonly type: 'string' | 'integer' | 'decimal' | 'boolean' | 'timestamp' | 'bytes';
  readonly description: string;
  readonly primaryKey?: boolean;
}

export interface StreamManifest {
  readonly id: string;
  readonly name: string;
  readonly endpoint: string;
  readonly transport: 'sse' | 'websocket';
  readonly description: string;
  readonly schemaRef: string;
  readonly messageRatePerSec: number;
}

export interface QueryRequest {
  readonly datasetId: string;
  readonly fields?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
  readonly filters?: readonly QueryFilter[];
  readonly orderBy?: string;
  readonly orderDirection?: 'asc' | 'desc';
}

export interface QueryFilter {
  readonly field: string;
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  readonly value: unknown;
}

export interface QueryResult {
  readonly datasetId: string;
  readonly rowCount: number;
  readonly totalAvailable: number;
  readonly executionTimeMs: number;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export interface McpToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly sampleCall: string;
}
