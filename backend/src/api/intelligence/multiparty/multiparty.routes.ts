import { Application, Request, Response } from 'express';
import multipartyService from './multiparty.service';

class MultipartyRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/multiparty/overview', (req: Request, res: Response) => {
      try {
        const overview = multipartyService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/multiparty/products', (req: Request, res: Response) => {
      try {
        const products = multipartyService.listProducts();
        res.json(products);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
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
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/multiparty/compatibility', (req: Request, res: Response) => {
      try {
        const compatibility = multipartyService.getCompatibility();
        res.json(compatibility);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/multiparty/test-vectors', (req: Request, res: Response) => {
      try {
        const vectors = multipartyService.getTestVectors();
        res.json(vectors);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/multiparty/manifests/verify', (req: Request, res: Response) => {
      try {
        const result = multipartyService.verifyManifest(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Manifest verification failed' });
      }
    });

    app.post('/api/v1/intelligence/multiparty/public-sessions/verify', (req: Request, res: Response) => {
      try {
        const result = multipartyService.verifyPublicSession(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Public session verification failed' });
      }
    });
  }
}

export default new MultipartyRoutes();
