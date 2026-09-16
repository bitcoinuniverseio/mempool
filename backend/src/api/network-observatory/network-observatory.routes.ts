import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { NetworkObservatoryEvidenceError, networkObservatoryService } from './network-observatory.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof NetworkObservatoryEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class NetworkObservatoryRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'network/';

    app
      .get(prefix + 'nodes', this.$getNodes)
      .get(prefix + 'propagation', this.$getPropagation)
      .get(prefix + 'propagation/:txid', this.$getPropagationTx)
      .get(prefix + 'templates', this.$getTemplates);
  }

  private async $getNodes(req: Request, res: Response): Promise<void> {
    try {
      const nodes = await networkObservatoryService.$getNodes();
      res.json({ nodes, total: nodes.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getPropagation(req: Request, res: Response): Promise<void> {
    try {
      const data = await networkObservatoryService.$getPropagation();
      res.json(data);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getPropagationTx(req: Request, res: Response): Promise<void> {
    try {
      const data = await networkObservatoryService.$getPropagation(req.params.txid);
      res.json(data);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = await networkObservatoryService.$getTemplates();
      res.json(templates);
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new NetworkObservatoryRoutes();
