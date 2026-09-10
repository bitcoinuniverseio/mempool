import { Application, Request, Response } from 'express';
import { QuantumEvidenceError, quantumService } from './quantum.service';
import { handleError } from '../../../utils/api';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof QuantumEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

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
      fail(req, res, e, 'Failed to fetch quantum overview');
    }
  }

  private async $getCohorts(req: Request, res: Response): Promise<void> {
    try {
      const cohorts = quantumService.getCohorts();
      res.json(cohorts);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch quantum cohorts');
    }
  }

  private async $getHistory(req: Request, res: Response): Promise<void> {
    try {
      const history = quantumService.getRecentReveals();
      res.json(history);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch quantum reveal history');
    }
  }

  private async $postAudit(req: Request, res: Response): Promise<void> {
    try {
      const { identifier } = req.body || {};
      const result = quantumService.auditAddressOrOutpoint(identifier);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 'Failed to audit identifier');
    }
  }

  private async $postMigrationPlan(req: Request, res: Response): Promise<void> {
    try {
      const result = quantumService.generateMigrationPlan(req.body);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 'Failed to generate migration plan');
    }
  }
}

export default new QuantumRoutes();
