import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { liquidObservatoryService } from './liquid-observatory.service';

class LiquidObservatoryRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'liquid/observatory/';

    app
      .get(prefix + 'summary', this.$getSummary)
      .get(prefix + 'assets', this.$getAssets)
      .get(prefix + 'assets/:assetId', this.$getAsset)
      .get(prefix + 'pegs', this.$getPegs)
      .get(prefix + 'federation', this.$getFederation);
  }

  private async $getSummary(req: Request, res: Response): Promise<void> {
    try {
      const summary = await liquidObservatoryService.$getSummary();
      res.json(summary);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getAssets(req: Request, res: Response): Promise<void> {
    try {
      const assets = await liquidObservatoryService.$getAssets();
      res.json({ assets, total: assets.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getAsset(req: Request, res: Response): Promise<void> {
    try {
      const asset = await liquidObservatoryService.$getAsset(req.params.assetId);
      if (!asset) {
        res.status(404).json({ error: 'asset-not-found' });
        return;
      }
      res.json(asset);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getPegs(req: Request, res: Response): Promise<void> {
    try {
      const pegs = await liquidObservatoryService.$getPegs();
      res.json({ pegs, total: pegs.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getFederation(req: Request, res: Response): Promise<void> {
    try {
      const federation = await liquidObservatoryService.$getFederation();
      res.json(federation);
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new LiquidObservatoryRoutes();
