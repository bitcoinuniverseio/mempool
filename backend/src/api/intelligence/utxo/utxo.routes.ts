import { Application, Request, Response } from 'express';
import { utxoIntelligenceService } from './utxo-intelligence.service';
import { handleError } from '../../../utils/api';

class UtxoRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/utxo/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'cohorts', this.$getCohorts)
      .get(prefix + 'history', this.$getHistory)
      .get(prefix + 'economic-thresholds', this.$getThresholds)
      .get(prefix + 'spend-transitions', this.$getTransitions)
      .get(prefix + 'reconciliation', this.$getReconciliation);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = utxoIntelligenceService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch UTXO overview');
    }
  }

  private async $getCohorts(req: Request, res: Response): Promise<void> {
    try {
      const cohorts = utxoIntelligenceService.getCohorts();
      res.json(cohorts);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch UTXO cohorts');
    }
  }

  private async $getHistory(req: Request, res: Response): Promise<void> {
    try {
      const transitions = utxoIntelligenceService.getSpendTransitions(30);
      res.json({ history: transitions, count: transitions.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch UTXO history');
    }
  }

  private async $getThresholds(req: Request, res: Response): Promise<void> {
    try {
      const thresholds = utxoIntelligenceService.getEconomicThresholds();
      res.json({ thresholds, count: thresholds.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch economic thresholds');
    }
  }

  private async $getTransitions(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 10;
      const transitions = utxoIntelligenceService.getSpendTransitions(limit);
      res.json({ transitions, count: transitions.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch spend transitions');
    }
  }

  private async $getReconciliation(req: Request, res: Response): Promise<void> {
    try {
      const report = utxoIntelligenceService.getReconciliation();
      res.json(report);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch reconciliation report');
    }
  }
}

export default new UtxoRoutes();
