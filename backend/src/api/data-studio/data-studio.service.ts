import {
  DatasetManifest,
  McpToolDeclaration,
  QueryRequest,
  QueryResult,
  StreamManifest,
} from './data-studio.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class DataStudioEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const catalogUnavailable =
  'The Data Studio catalog is unavailable. Dataset manifests with their row and size estimates, live stream registrations and MCP tool declarations require the owned Data Studio export service (dataset exporter, SSE stream registry and MCP tool server), which is not connected on this deployment.';

const queryEngineUnavailable =
  'Data Studio queries are unavailable. Running a query requires the owned Data Studio query engine over the exported datasets, which is not connected on this deployment.';

/**
 * Data Studio catalog and query evidence.
 *
 * The catalog and every query answer come from the owned export service. A
 * deployment that has none gets a 503 that names it: an empty catalog and an
 * absent one are different answers, and this never turns the second into the
 * first.
 */
export class DataStudioService {
  /** @asyncSafe */
  public async $getCatalog(): Promise<{ datasets: DatasetManifest[]; streams: StreamManifest[]; mcpTools: McpToolDeclaration[] }> {
    throw new DataStudioEvidenceError('unavailable-data-catalog', catalogUnavailable);
  }

  /** @asyncSafe */
  public async $executeQuery(_query: QueryRequest): Promise<QueryResult> {
    throw new DataStudioEvidenceError('unavailable-query-engine', queryEngineUnavailable);
  }
}

export const dataStudioService = new DataStudioService();
