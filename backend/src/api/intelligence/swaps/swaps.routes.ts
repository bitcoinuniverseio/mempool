import { Application, Request, Response } from 'express';
import swapsService from './swaps.service';

class SwapsRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/swaps/overview', (_req: Request, res: Response) => {
      try {
        const overview = swapsService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/swaps/protocols', (_req: Request, res: Response) => {
      try {
        const protocols = swapsService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/swaps/providers', (_req: Request, res: Response) => {
      try {
        const providers = swapsService.listProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/swaps/providers/:providerId', (req: Request, res: Response) => {
      try {
        const provider = swapsService.getProvider(req.params.providerId);
        if (!provider) {
          return res.status(404).json({ error: 'Provider not found' });
        }
        res.json(provider);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/swaps/providers/:providerId/history', (req: Request, res: Response) => {
      try {
        const history = swapsService.getProviderHistory(req.params.providerId);
        if (!history) {
          return res.status(404).json({ error: 'Provider history not found' });
        }
        res.json(history);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/swaps/manifests/verify', (req: Request, res: Response) => {
      try {
        const result = swapsService.verifyProviderManifest(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/swaps/public-receipts/verify', (req: Request, res: Response) => {
      try {
        const lockupRes = swapsService.verifyLockup(req.body, { currentHeight: req.body.current_height || 864195 });
        const claimRes = swapsService.verifyClaim(req.body);
        const refundRes = swapsService.verifyRefund(req.body, { currentHeight: req.body.current_height || 864195 });
        res.json({
          lockup: lockupRes,
          claim: claimRes,
          refund: refundRes,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/swaps/chain-context', (req: Request, res: Response) => {
      try {
        const currentHeight = req.body.current_height || 864195;
        const plan = swapsService.planRecovery(req.body, { currentHeight });
        const reconciliation = swapsService.reconcileCrossLayer(req.body.swap_id);
        res.json({
          current_height: currentHeight,
          recovery_plan: plan,
          reconciliation,
        });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new SwapsRoutes();
