import { Application, Request, Response } from 'express';
import consensusConformanceService from './consensus-conformance.service';

class ConsensusConformanceRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/consensus-conformance/overview', (_req: Request, res: Response) => {
      try {
        const overview = consensusConformanceService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/implementations', (_req: Request, res: Response) => {
      try {
        const impls = consensusConformanceService.listImplementations();
        res.json(impls);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/targets', (_req: Request, res: Response) => {
      try {
        const targets = consensusConformanceService.listTargets();
        res.json(targets);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/campaigns', (_req: Request, res: Response) => {
      try {
        const campaigns = consensusConformanceService.listCampaigns();
        res.json(campaigns);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/cases', (_req: Request, res: Response) => {
      try {
        const cases = consensusConformanceService.listCases();
        res.json(cases);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/cases/:caseId', (req: Request, res: Response) => {
      try {
        const caseRecord = consensusConformanceService.getCase(req.params.caseId);
        if (!caseRecord) {
          return res.status(404).json({ error: 'Consensus case not found' });
        }
        res.json(caseRecord);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/consensus-conformance/campaigns', (req: Request, res: Response) => {
      try {
        const targetId = req.body.target_id || 'transaction_parse';
        const seed = req.body.seed || Date.now();
        const campaign = consensusConformanceService.startCampaign(targetId, seed);
        res.json(campaign);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/consensus-conformance/cases/:caseId/replay', (req: Request, res: Response) => {
      try {
        const result = consensusConformanceService.replayCase(req.params.caseId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/formal-artifacts', (_req: Request, res: Response) => {
      try {
        const artifacts = consensusConformanceService.listFormalArtifacts();
        res.json(artifacts);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new ConsensusConformanceRoutes();
