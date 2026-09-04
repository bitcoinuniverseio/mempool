import { Application, Request, Response } from 'express';
import lightningResilienceService from './lightning-resilience.service';

class LightningResilienceRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/lightning/resilience/overview', (_req: Request, res: Response) => {
      try {
        const overview = lightningResilienceService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/channels', (_req: Request, res: Response) => {
      try {
        const channels = lightningResilienceService.listChannels();
        res.json({ channels });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/channels/:shortId', (req: Request, res: Response) => {
      try {
        const channel = lightningResilienceService.getChannel(req.params.shortId);
        if (!channel) {
          return res.status(404).json({ error: 'Channel not found' });
        }
        res.json(channel);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/nodes/:publicKey', (req: Request, res: Response) => {
      try {
        const node = lightningResilienceService.getNodeResilience(req.params.publicKey);
        res.json(node);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/incidents', (_req: Request, res: Response) => {
      try {
        const incidents = lightningResilienceService.listIncidents();
        res.json({ incidents });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/mitigations', (_req: Request, res: Response) => {
      try {
        const mitigations = lightningResilienceService.listMitigations();
        res.json({ mitigations });
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/lightning/resilience/capabilities', (_req: Request, res: Response) => {
      try {
        const caps = lightningResilienceService.getCapabilities();
        res.json(caps);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/lightning/resilience/simulate', (req: Request, res: Response) => {
      try {
        const result = lightningResilienceService.runSimulator(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new LightningResilienceRoutes();
