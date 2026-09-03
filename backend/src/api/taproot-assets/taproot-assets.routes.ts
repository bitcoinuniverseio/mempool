import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { taprootAssetsService } from './taproot-assets.service';

class TaprootAssetsRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;

    app
      .get(prefix + 'taproot-assets/assets', this.$getAssets)
      .get(prefix + 'taproot-assets/assets/:assetId', this.$getAsset)
      .get(prefix + 'taproot-assets/groups', this.$getGroups)
      .post(prefix + 'taproot-assets/proof/verify', this.$verifyProof)
      .get(prefix + 'lightning/offers', this.$getOffers)
      .get(prefix + 'lightning/rfq', this.$getRfq);
  }

  private async $getAssets(req: Request, res: Response): Promise<void> {
    try {
      const assets = await taprootAssetsService.$getAssets();
      res.json({ assets, total: assets.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getAsset(req: Request, res: Response): Promise<void> {
    try {
      const asset = await taprootAssetsService.$getAsset(req.params.assetId);
      if (!asset) {
        res.status(404).json({ error: 'taproot-asset-not-found' });
        return;
      }
      res.json(asset);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getGroups(req: Request, res: Response): Promise<void> {
    try {
      const groups = await taprootAssetsService.$getGroups();
      res.json({ groups, total: groups.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $verifyProof(req: Request, res: Response): Promise<void> {
    try {
      const { assetId, proofData } = req.body || {};
      if (!assetId || !proofData) {
        res.status(400).json({ error: 'missing-asset-or-proof-data' });
        return;
      }
      const result = await taprootAssetsService.$verifyProof(assetId, proofData);
      res.json(result);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getOffers(req: Request, res: Response): Promise<void> {
    try {
      const offers = await taprootAssetsService.$getOffers();
      res.json({ offers, total: offers.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getRfq(req: Request, res: Response): Promise<void> {
    try {
      const quotes = await taprootAssetsService.$getRfqQuotes();
      res.json({ quotes, total: quotes.length });
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new TaprootAssetsRoutes();
