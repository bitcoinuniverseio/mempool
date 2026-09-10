import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { DataStudioEvidenceError, dataStudioService } from './data-studio.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof DataStudioEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class DataStudioRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'data/';

    app
      .get(prefix + 'catalog', this.$getCatalog)
      .post(prefix + 'query', this.$postQuery)
      .get(prefix + 'mcp', this.$getMcp);
  }

  private async $getCatalog(req: Request, res: Response): Promise<void> {
    try {
      const catalog = await dataStudioService.$getCatalog();
      res.json(catalog);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $postQuery(req: Request, res: Response): Promise<void> {
    try {
      const datasetId = req.body?.datasetId;
      if (!datasetId || typeof datasetId !== 'string') {
        res.status(400).json({ error: 'invalid-dataset-id' });
        return;
      }
      const result = await dataStudioService.$executeQuery(req.body);
      res.json(result);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getMcp(req: Request, res: Response): Promise<void> {
    try {
      const catalog = await dataStudioService.$getCatalog();
      res.json({ tools: catalog.mcpTools });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new DataStudioRoutes();
