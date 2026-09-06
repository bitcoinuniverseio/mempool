import { Application, Request, Response } from 'express';
import multipartyService, { MultipartyEvidenceError } from './multiparty.service';

function fail(res: Response, err: unknown): Response {
  if (err instanceof MultipartyEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(500).json({ error: 'Internal error' });
}

class MultipartyRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/multiparty/overview', (req: Request, res: Response) => {
      try {
        const overview = multipartyService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/multiparty/products', (req: Request, res: Response) => {
      try {
        const products = multipartyService.listProducts();
        res.json(products);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/multiparty/products/:productId', (req: Request, res: Response) => {
      try {
        const product = multipartyService.getProduct(req.params.productId);
        if (!product) {
          return res.status(404).json({ error: 'Signing product not found' });
        }
        res.json(product);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/multiparty/compatibility', (req: Request, res: Response) => {
      try {
        const compatibility = multipartyService.getCompatibility();
        res.json(compatibility);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/multiparty/test-vectors', (req: Request, res: Response) => {
      try {
        const vectors = multipartyService.getTestVectors();
        res.json(vectors);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/multiparty/manifests/verify', (req: Request, res: Response) => {
      try {
        const result = multipartyService.verifyManifest(req.body);
        res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/multiparty/public-sessions/verify', (req: Request, res: Response) => {
      try {
        const result = multipartyService.verifyPublicSession(req.body);
        res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });
  }
}

export default new MultipartyRoutes();
