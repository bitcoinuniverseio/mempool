import { Application, Request, Response } from 'express';
import { blockspaceService } from './blockspace.service';
import { handleError } from '../../../utils/api';

class BlockspaceRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/blockspace/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'taxonomy', this.$getTaxonomy)
      .get(prefix + 'composition', this.$getComposition)
      .get(prefix + 'regimes', this.$getRegimes)
      .get(prefix + 'transactions/:txid/semantics', this.$getTxSemantics);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = blockspaceService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch blockspace overview');
    }
  }

  private async $getTaxonomy(req: Request, res: Response): Promise<void> {
    try {
      const tax = blockspaceService.getTaxonomy();
      res.json(tax);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch taxonomy');
    }
  }

  private async $getComposition(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 24;
      const comp = blockspaceService.getComposition(limit);
      res.json(comp);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch blockspace composition');
    }
  }

  private async $getRegimes(req: Request, res: Response): Promise<void> {
    try {
      const regimes = blockspaceService.getRegimes();
      res.json(regimes);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch blockspace regimes');
    }
  }

  private async $getTxSemantics(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      const evidence = blockspaceService.getTxSemantics(txid);
      res.json(evidence);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch transaction semantics');
    }
  }
}

export default new BlockspaceRoutes();
