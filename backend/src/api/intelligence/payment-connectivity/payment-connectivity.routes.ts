import { Application, Request, Response } from 'express';
import paymentConnectivityService, { PaymentConnectivityEvidenceError } from './payment-connectivity.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown, status = 500): Response {
  if (err instanceof PaymentConnectivityEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(status).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

class PaymentConnectivityRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/payment-connectivity/overview', (req: Request, res: Response) => {
      try {
        const overview = paymentConnectivityService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/products', (req: Request, res: Response) => {
      try {
        const products = paymentConnectivityService.listProducts();
        res.json(products);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/compatibility', (req: Request, res: Response) => {
      try {
        const compatibility = paymentConnectivityService.getCompatibility();
        res.json(compatibility);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/relays', (req: Request, res: Response) => {
      try {
        const relays = paymentConnectivityService.listRelays();
        res.json(relays);
      } catch (err: any) {
        fail(res, err);
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
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/payment-connectivity/lnurl/providers', (req: Request, res: Response) => {
      try {
        const providers = paymentConnectivityService.listLnurlProviders();
        res.json(providers);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/manifests/verify', (req: Request, res: Response) => {
      try {
        res.json(paymentConnectivityService.verifyManifest());
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/public-endpoints/verify', (req: Request, res: Response) => {
      try {
        const result = paymentConnectivityService.verifyPublicEndpoint(req.body.endpoint_url);
        res.json(result);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.post('/api/v1/intelligence/payment-connectivity/zaps/verify', (req: Request, res: Response) => {
      try {
        const result = paymentConnectivityService.verifyZap(req.body);
        res.json(result);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });
  }
}

export default new PaymentConnectivityRoutes();
