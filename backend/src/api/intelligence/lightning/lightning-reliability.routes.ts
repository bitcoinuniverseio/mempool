import { Application, Request, Response } from 'express';
import { lightningReliabilityService } from './lightning-reliability.service';
import { handleError } from '../../../utils/api';

class LightningReliabilityRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/lightning/reliability/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'nodes/:pubkey', this.$getNodeReliability)
      .get(prefix + 'channels/:shortId', this.$getChannelLifecycle)
      .get(prefix + 'closures/:txid', this.$getClosureForensics)
      .get(prefix + 'lsps', this.$getLspProviders)
      .post(prefix + 'simulations', this.$postSimulateLiquidity);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = lightningReliabilityService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch lightning reliability overview');
    }
  }

  private async $getNodeReliability(req: Request, res: Response): Promise<void> {
    try {
      const pubkey = req.params.pubkey;
      const node = lightningReliabilityService.getNodeReliability(pubkey);
      if (!node) {
        res.status(404).json({ error: 'Node reliability record not found' });
        return;
      }
      res.json(node);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch node reliability');
    }
  }

  private async $getChannelLifecycle(req: Request, res: Response): Promise<void> {
    try {
      const shortId = req.params.shortId;
      const channel = lightningReliabilityService.getChannelLifecycle(shortId);
      if (!channel) {
        res.status(404).json({ error: 'Channel lifecycle record not found' });
        return;
      }
      res.json(channel);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch channel lifecycle');
    }
  }

  private async $getClosureForensics(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      const closure = lightningReliabilityService.getClosureForensics(txid);
      if (!closure) {
        res.status(404).json({ error: 'Closure forensics record not found' });
        return;
      }
      res.json(closure);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch closure forensics');
    }
  }

  private async $getLspProviders(req: Request, res: Response): Promise<void> {
    try {
      const lsps = lightningReliabilityService.getLspProviders();
      res.json(lsps);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch LSP providers');
    }
  }

  private async $postSimulateLiquidity(req: Request, res: Response): Promise<void> {
    try {
      const { target_pubkey, amount_sats, source_pubkey } = req.body;
      const result = lightningReliabilityService.simulateLiquidity({
        target_pubkey,
        amount_sats: Number(amount_sats),
        source_pubkey,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Liquidity simulation failed' });
    }
  }
}

export default new LightningReliabilityRoutes();
