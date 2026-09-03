import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { networkObservatoryService } from './network-observatory.service';

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
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getPropagation(req: Request, res: Response): Promise<void> {
    try {
      const data = await networkObservatoryService.$getPropagation();
      res.json(data);
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getPropagationTx(req: Request, res: Response): Promise<void> {
    try {
      const data = await networkObservatoryService.$getPropagation(req.params.txid);
      res.json(data);
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = await networkObservatoryService.$getTemplates();
      res.json(templates);
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }
}

export default new NetworkObservatoryRoutes();
