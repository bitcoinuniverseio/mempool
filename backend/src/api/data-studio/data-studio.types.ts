export interface DatasetField {
  readonly name: string;
  readonly type: 'string' | 'integer';
  readonly description: string;
  readonly primaryKey?: boolean;
}
export interface DatasetManifest {
  id: string;
  name: string;
  category: string;
  description: string;
  updateFrequency: string;
  rowCountEstimate: string;
  sizeEstimateBytes: string;
  rowCount: number;
  sizeBytes: number;
  snapshotId: string;
  network: string;
  observedAt: string;
  supportedFormats: readonly string[];
  fields: readonly DatasetField[];
  exports: Record<string, { bytes: number; sha256: string; endpoint: string }>;
  coverage: unknown;
}
export interface StreamManifest {
  id: string;
  name: string;
  endpoint: string;
  transport: 'sse';
  description: string;
  schemaRef: string;
  messageRatePerSec: number | null;
  resumeScope: string;
}
export interface QueryRequest {
  datasetId: string;
  snapshotId?: string;
  fields?: readonly string[];
  limit?: number;
  offset?: number;
  filters?: readonly QueryFilter[];
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}
export interface QueryFilter {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  value: unknown;
}
export interface QueryResult {
  datasetId: string;
  snapshotId: string;
  network: string;
  observedAt: string;
  rowCount: number;
  totalAvailable: number;
  executionTimeMs: number;
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
  nextOffset: number | null;
  source: unknown;
}
export interface McpToolDeclaration {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  parameters: Record<string, unknown>;
  sampleCall: string;
}
