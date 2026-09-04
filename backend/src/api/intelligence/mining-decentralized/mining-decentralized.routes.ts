import { Application, Request, Response } from 'express';
import decentralizedMiningService from './mining-decentralized.service';

class DecentralizedMiningRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/mining/decentralized/overview', (req: Request, res: Response) => {
      try {
        const overview = decentralizedMiningService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/protocols', (req: Request, res: Response) => {
      try {
        const protocols = decentralizedMiningService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/sources', (req: Request, res: Response) => {
      try {
        const sources = decentralizedMiningService.listSources();
        res.json(sources);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/shares', (req: Request, res: Response) => {
      try {
        const shares = decentralizedMiningService.listShares();
        res.json(shares);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/shares/:shareId', (req: Request, res: Response) => {
      try {
        const share = decentralizedMiningService.getShare(req.params.shareId);
        if (!share) {
          return res.status(404).json({ error: 'Share not found' });
        }
        res.json(share);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/templates', (req: Request, res: Response) => {
      try {
        const templates = decentralizedMiningService.listTemplates();
        res.json(templates);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/templates/:templateId', (req: Request, res: Response) => {
      try {
        const template = decentralizedMiningService.getTemplate(req.params.templateId);
        if (!template) {
          return res.status(404).json({ error: 'Template not found' });
        }
        res.json(template);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/payouts', (req: Request, res: Response) => {
      try {
        const payouts = decentralizedMiningService.listPayouts();
        res.json(payouts);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/compare', (req: Request, res: Response) => {
      try {
        const comparison = decentralizedMiningService.compareTemplates();
        res.json(comparison);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new DecentralizedMiningRoutes();
