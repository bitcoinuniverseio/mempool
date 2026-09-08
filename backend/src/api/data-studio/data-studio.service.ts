import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  DatasetManifest,
  McpToolDeclaration,
  QueryRequest,
  QueryResult,
  StreamManifest,
} from './data-studio.types';

export class DataStudioService {
  /** @asyncSafe */
  public async $getCatalog(): Promise<{
    datasets: DatasetManifest[];
    streams: StreamManifest[];
    mcpTools: McpToolDeclaration[];
  }> {
    throwFirstPartyDataUnavailable('data-studio');
  }

  /** @asyncSafe */
  public async $executeQuery(query: QueryRequest): Promise<QueryResult> {
    void query;
    throwFirstPartyDataUnavailable('data-studio');
  }
}

export const dataStudioService = new DataStudioService();
