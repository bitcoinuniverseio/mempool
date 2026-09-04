import { Application, Request, Response } from 'express';
import nodeSecurityService from './node-security.service';

class NodeSecurityRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/node-security/overview', (_req: Request, res: Response) => {
      try {
        const overview = nodeSecurityService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/releases', (_req: Request, res: Response) => {
      try {
        const releases = nodeSecurityService.listReleases();
        res.json(releases);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/advisories', (_req: Request, res: Response) => {
      try {
        const advisories = nodeSecurityService.listAdvisories();
        res.json(advisories);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/advisories/:advisoryId', (req: Request, res: Response) => {
      try {
        const advisory = nodeSecurityService.getAdvisory(req.params.advisoryId);
        if (!advisory) {
          return res.status(404).json({ error: 'Security advisory not found' });
        }
        res.json(advisory);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/fleet', (_req: Request, res: Response) => {
      try {
        const fleet = nodeSecurityService.listFleet();
        res.json(fleet);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/nodes/:nodeId', (req: Request, res: Response) => {
      try {
        const node = nodeSecurityService.getNode(req.params.nodeId);
        if (!node) {
          return res.status(404).json({ error: 'Fleet node not found' });
        }
        res.json(node);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/nodes/:nodeId/exposures', (req: Request, res: Response) => {
      try {
        const exposures = nodeSecurityService.getNodeExposures(req.params.nodeId);
        if (!exposures) {
          return res.status(404).json({ error: 'Node not found' });
        }
        res.json(exposures);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/node-security/artifacts', (_req: Request, res: Response) => {
      try {
        const artifacts = nodeSecurityService.listArtifacts();
        res.json(artifacts);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/node-security/artifacts/verify', (req: Request, res: Response) => {
      try {
        const result = nodeSecurityService.verifyArtifact(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/node-security/upgrade-plans', (req: Request, res: Response) => {
      try {
        const plan = nodeSecurityService.createUpgradePlan(req.body);
        res.json(plan);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new NodeSecurityRoutes();
