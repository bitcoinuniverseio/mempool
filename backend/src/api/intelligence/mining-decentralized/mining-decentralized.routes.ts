import { Application, Request, Response } from 'express';
import decentralizedMiningService, { DecentralizedMiningEvidenceError } from './mining-decentralized.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown): Response {
  if (err instanceof DecentralizedMiningEvidenceError) {
    return res.status(err.status).json({ stage: err.code, error: err.message });
  }
  return res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

class DecentralizedMiningRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/mining/decentralized/overview', (req: Request, res: Response) => {
      try {
        const overview = decentralizedMiningService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/protocols', (req: Request, res: Response) => {
      try {
        const protocols = decentralizedMiningService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/sources', (req: Request, res: Response) => {
      try {
        const sources = decentralizedMiningService.listSources();
        res.json(sources);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/shares', (req: Request, res: Response) => {
      try {
        const shares = decentralizedMiningService.listShares();
        res.json(shares);
      } catch (err: any) {
        fail(res, err);
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
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/templates', (req: Request, res: Response) => {
      try {
        const templates = decentralizedMiningService.listTemplates();
        res.json(templates);
      } catch (err: any) {
        fail(res, err);
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
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/payouts', (req: Request, res: Response) => {
      try {
        const payouts = decentralizedMiningService.listPayouts();
        res.json(payouts);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/mining/decentralized/compare', (req: Request, res: Response) => {
      try {
        const comparison = decentralizedMiningService.compareTemplates();
        res.json(comparison);
      } catch (err: any) {
        fail(res, err);
      }
    });
  }
}

export default new DecentralizedMiningRoutes();
