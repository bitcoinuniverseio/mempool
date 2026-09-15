import { Application, Request, Response } from 'express';
import { blockspaceService, BlockspaceUnavailableError } from './blockspace.service';
import { handleError } from '../../../utils/api';

/** No observed block yet is a 503 that says so, never an invented composition. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof BlockspaceUnavailableError) {
    res.status(503).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

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
      fail(req, res, e, 'Failed to fetch blockspace overview');
    }
  }

  private async $getTaxonomy(req: Request, res: Response): Promise<void> {
    try {
      const tax = blockspaceService.getTaxonomy();
      res.json(tax);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch taxonomy');
    }
  }

  private async $getComposition(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 24;
      const comp = blockspaceService.getComposition(limit);
      res.json(comp);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch blockspace composition');
    }
  }

  private async $getRegimes(req: Request, res: Response): Promise<void> {
    try {
      const regimes = blockspaceService.getRegimes();
      res.json(regimes);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch blockspace regimes');
    }
  }

  private async $getTxSemantics(req: Request, res: Response): Promise<void> {
    try {
      const evidence = await blockspaceService.getTxSemantics(req.params.txid);
      if (!evidence) {
        res.status(404).json({ error: 'Transaction ' + req.params.txid + ' is not in this index.' });
        return;
      }
      res.json(evidence);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch transaction semantics');
    }
  }
}

export default new BlockspaceRoutes();
