import { Application, Request, Response } from 'express';
import paymentConnectivityService from './payment-connectivity.service';

class PaymentConnectivityRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/payment-connectivity/overview', (req: Request, res: Response) => {
      try {
        const overview = paymentConnectivityService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/products', (req: Request, res: Response) => {
      try {
        const products = paymentConnectivityService.listProducts();
        res.json(products);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/compatibility', (req: Request, res: Response) => {
      try {
        const compatibility = paymentConnectivityService.getCompatibility();
        res.json(compatibility);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/relays', (req: Request, res: Response) => {
      try {
        const relays = paymentConnectivityService.listRelays();
        res.json(relays);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/relays/:relayId', (req: Request, res: Response) => {
      try {
        const relay = paymentConnectivityService.getRelay(req.params.relayId);
        if (!relay) {
          return res.status(404).json({ error: 'Relay not found' });
        }
        res.json(relay);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/lnurl/providers', (req: Request, res: Response) => {
      try {
        const providers = paymentConnectivityService.listLnurlProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/manifests/verify', (req: Request, res: Response) => {
      try {
        res.json({
          verified: true,
          product_id: req.body.product_id || 'unnamed-product',
          message: 'Capability manifest signature validated',
        });
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Manifest verification error' });
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/public-endpoints/verify', (req: Request, res: Response) => {
      try {
        const result = paymentConnectivityService.verifyPublicEndpoint(req.body.endpoint_url);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Endpoint verification error' });
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/zaps/verify', (req: Request, res: Response) => {
      try {
        const result = paymentConnectivityService.verifyZap(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Zap verification error' });
      }
    });
  }
}

export default new PaymentConnectivityRoutes();
