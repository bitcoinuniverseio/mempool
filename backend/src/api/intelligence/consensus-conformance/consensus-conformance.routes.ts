import { Application, Request, Response } from 'express';
import consensusConformanceService, { ConformanceEvidenceError } from './consensus-conformance.service';

export class ConsensusConformanceRoutes {
  constructor(private readonly service = consensusConformanceService) {}
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/consensus-conformance/overview', (_req: Request, res: Response) => {
      try {
        const overview = this.service.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/implementations', (_req: Request, res: Response) => {
      try {
        const impls = this.service.listImplementations();
        res.json(impls);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/targets', (_req: Request, res: Response) => {
      try {
        const targets = this.service.listTargets();
        res.json(targets);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/campaigns', (_req: Request, res: Response) => {
      try {
        const campaigns = this.service.listCampaigns();
        res.json(campaigns);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/cases', (_req: Request, res: Response) => {
      try {
        const cases = this.service.listCases();
        res.json(cases);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/cases/:caseId', async (req: Request, res: Response) => {
      try {
        const caseRecord = this.service.getCase(req.params.caseId);
        if (!caseRecord) {
          return res.status(404).json({ error: 'Consensus case not found' });
        }
        res.json(caseRecord);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/consensus-conformance/campaigns', async (req: Request, res: Response) => {
      try {
        this.service.authorizeExecution(req.get('X-Conformance-Execution-Token'));
        const targetId = req.body?.target_id ?? 'transaction_parse';
        const seed = req.body?.seed ?? Date.now();
        const campaign = await this.service.startCampaign(targetId, seed);
        res.json(campaign);
      } catch (err: any) {
        res.status(err instanceof ConformanceEvidenceError ? err.status : 500).json({
          stage: err instanceof ConformanceEvidenceError ? err.code : 'internal-error',
          error: err instanceof ConformanceEvidenceError ? err.message : 'Internal error',
        });
      }
    });

    app.post('/api/v1/intelligence/consensus-conformance/cases/:caseId/replay', async (req: Request, res: Response) => {
      try {
        this.service.authorizeExecution(req.get('X-Conformance-Execution-Token'));
        const result = await this.service.replayCase(req.params.caseId);
        res.json(result);
      } catch (err: any) {
        res.status(err instanceof ConformanceEvidenceError ? err.status : 500).json({
          stage: err instanceof ConformanceEvidenceError ? err.code : 'internal-error',
          error: err instanceof ConformanceEvidenceError ? err.message : 'Internal error',
        });
      }
    });

    app.get('/api/v1/intelligence/consensus-conformance/formal-artifacts', (_req: Request, res: Response) => {
      try {
        const artifacts = this.service.listFormalArtifacts();
        res.json(artifacts);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new ConsensusConformanceRoutes();
