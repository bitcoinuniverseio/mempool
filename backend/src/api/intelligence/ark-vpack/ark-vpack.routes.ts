import { Application, Request, Response } from 'express';
import arkVpackService from './ark-vpack.service';

class ArkVpackRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/ark/vpack/overview', (_req: Request, res: Response) => {
      try {
        const overview = arkVpackService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ark/vpack/versions', (_req: Request, res: Response) => {
      try {
        const versions = arkVpackService.listVersions();
        res.json(versions);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ark/vpack/implementations', (_req: Request, res: Response) => {
      try {
        const impls = arkVpackService.listImplementations();
        res.json(impls);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ark/vpack/providers', (_req: Request, res: Response) => {
      try {
        const providers = arkVpackService.listProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/ark/vpack/providers/:providerId', (req: Request, res: Response) => {
      try {
        const provider = arkVpackService.getProvider(req.params.providerId);
        if (!provider) {
          return res.status(404).json({ error: 'Ark provider not found' });
        }
        res.json(provider);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/ark/vpack/public-anchors/verify', (req: Request, res: Response) => {
      try {
        const outpoint = req.body.anchor_outpoint || req.body.outpoint;
        if (!outpoint) {
          return res.status(400).json({ error: 'anchor_outpoint is required' });
        }
        const result = arkVpackService.verifyPublicAnchor(outpoint);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/ark/vpack/manifests/verify', (req: Request, res: Response) => {
      try {
        const result = arkVpackService.verifyManifest(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new ArkVpackRoutes();
