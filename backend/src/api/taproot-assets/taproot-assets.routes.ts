import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { TaprootAssetsEvidenceError, taprootAssetsService } from './taproot-assets.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof TaprootAssetsEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

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
      fail(req, res, e);
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
      fail(req, res, e);
    }
  }

  private async $getGroups(req: Request, res: Response): Promise<void> {
    try {
      const groups = await taprootAssetsService.$getGroups();
      res.json({ groups, total: groups.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $verifyProof(req: Request, res: Response): Promise<void> {
    try {
      const { assetId, proofData } = req.body || {};
      const result = await taprootAssetsService.$verifyProof(assetId, proofData);
      // A completed verdict, valid or not, is a 200; only bad input and an absent verifier are not answers.
      res.status(result.stage === 'invalid-input' ? 400 : result.stage === 'unavailable-verifier' ? 503 : 200).json(result);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getOffers(req: Request, res: Response): Promise<void> {
    try {
      const offers = await taprootAssetsService.$getOffers();
      res.json({ offers, total: offers.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getRfq(req: Request, res: Response): Promise<void> {
    try {
      const quotes = await taprootAssetsService.$getRfqQuotes();
      res.json({ quotes, total: quotes.length });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new TaprootAssetsRoutes();
