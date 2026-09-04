import { Application, Request, Response } from 'express';
import { quantumService } from './quantum.service';
import { handleError } from '../../../utils/api';

class QuantumRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/quantum/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'cohorts', this.$getCohorts)
      .get(prefix + 'history', this.$getHistory)
      .post(prefix + 'audit', this.$postAudit)
      .post(prefix + 'migration-plans', this.$postMigrationPlan);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = quantumService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch quantum overview');
    }
  }

  private async $getCohorts(req: Request, res: Response): Promise<void> {
    try {
      const cohorts = quantumService.getCohorts();
      res.json(cohorts);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch quantum cohorts');
    }
  }

  private async $getHistory(req: Request, res: Response): Promise<void> {
    try {
      const history = quantumService.getRecentReveals();
      res.json(history);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch quantum reveal history');
    }
  }

  private async $postAudit(req: Request, res: Response): Promise<void> {
    try {
      const { identifier } = req.body;
      const result = quantumService.auditAddressOrOutpoint(identifier);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to audit identifier' });
    }
  }

  private async $postMigrationPlan(req: Request, res: Response): Promise<void> {
    try {
      const result = quantumService.generateMigrationPlan(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to generate migration plan' });
    }
  }
}

export default new QuantumRoutes();
