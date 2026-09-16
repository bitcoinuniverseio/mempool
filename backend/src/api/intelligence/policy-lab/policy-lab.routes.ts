import { Application, Request, Response } from 'express';
import { policyLabService } from './policy-lab.service';
import { PolicyEvidenceError } from './inclusion-forecast';
function fail(res: Response, error: unknown): void { if (error instanceof PolicyEvidenceError) res.status(error.status).json({stage:error.code,error:error.message}); else res.status(500).json({error:'Policy operation failed'}); }

class PolicyLabRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/';

    app
      .post(prefix + 'policy/evaluations', this.$postEvaluation)
      .get(prefix + 'policy/evaluations/:id', this.$getEvaluation)
      .get(prefix + 'policy/profiles', this.$getProfiles)
      .post(prefix + 'packages/analyze', this.$postPackageAnalyze)
      .get(prefix + 'forecasts/:txid', this.$getForecastTx)
      .get(prefix + 'forecasts/models/current', this.$getModelCurrent)
      .get(prefix + 'forecasts/models/:version/card', this.$getModelCard);
  }

  private async $postEvaluation(req: Request, res: Response): Promise<void> {
    try {
      const rawTxs: string[] = req.body?.transactions || (req.body?.raw_hex ? [req.body.raw_hex] : []);
      if (!Array.isArray(rawTxs) || rawTxs.length === 0) {
        res.status(400).json({ error: 'Array of raw transaction hexes or raw_hex string required.' });
        return;
      }
      const evaluation = await policyLabService.evaluateTransactionOrPackage(rawTxs);
      res.json(evaluation);
    } catch (e) {
      fail(res, e);
    }
  }

  private async $getEvaluation(req: Request, res: Response): Promise<void> {
    try {
      const evalId = req.params.id;
      const evaluation = policyLabService.getSavedEvaluation(evalId);
      if (!evaluation) {
        res.status(404).json({ error: `Evaluation '${evalId}' not found.` });
        return;
      }
      res.json(evaluation);
    } catch (e) {
      fail(res, e);
    }
  }

  private async $getProfiles(req: Request, res: Response): Promise<void> {
    try {
      const profiles = await policyLabService.getNodeProfiles();
      res.json({ profiles, total: profiles.length });
    } catch (e) {
      fail(res, e);
    }
  }

  private async $postPackageAnalyze(req: Request, res: Response): Promise<void> {
    try {
      const rawTxs: string[] = req.body?.transactions || (req.body?.raw_hex ? [req.body.raw_hex] : []);
      if (!Array.isArray(rawTxs) || rawTxs.length === 0) {
        res.status(400).json({ error: 'Array of raw transactions required.' });
        return;
      }
      const result = await policyLabService.evaluateTransactionOrPackage(rawTxs);
      res.json(result.package_report);
    } catch (e) {
      fail(res, e);
    }
  }

  private async $getForecastTx(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      const forecast = policyLabService.getForecastForTxid(txid);
      res.json(forecast);
    } catch (e) {
      fail(res, e);
    }
  }

  private async $getModelCurrent(req: Request, res: Response): Promise<void> {
    try {
      const card = policyLabService.getCurrentForecastModelCard();
      res.json(card);
    } catch (e) {
      fail(res, e);
    }
  }

  private async $getModelCard(req: Request, res: Response): Promise<void> {
    try {
      const card = policyLabService.getCurrentForecastModelCard(req.params.version);
      res.json(card);
    } catch (e) {
      fail(res, e);
    }
  }
}

export default new PolicyLabRoutes();
