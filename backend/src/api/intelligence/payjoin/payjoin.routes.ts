import { Application, Request, Response } from 'express';
import { payjoinService } from './payjoin.service';
import { handleError } from '../../../utils/api';

class PayjoinRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/payments/payjoin/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'directories', this.$getDirectories)
      .get(prefix + 'compatibility', this.$getCompatibility)
      .post(prefix + 'analyze', this.$postAnalyzeProposal)
      .post(prefix + 'playground/sessions', this.$postCreatePlaygroundSession)
      .post(prefix + 'playground/sessions/:id/advance', this.$postAdvancePlaygroundSession);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = payjoinService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch payjoin overview');
    }
  }

  private async $getDirectories(req: Request, res: Response): Promise<void> {
    try {
      const dirs = payjoinService.getDirectories();
      res.json(dirs);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch payjoin directories');
    }
  }

  private async $getCompatibility(req: Request, res: Response): Promise<void> {
    try {
      const compat = payjoinService.getCompatibility();
      res.json(compat);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch compatibility matrix');
    }
  }

  private async $postAnalyzeProposal(req: Request, res: Response): Promise<void> {
    try {
      const { original_psbt, proposal_psbt } = req.body;
      const result = payjoinService.analyzeProposal({ original_psbt, proposal_psbt });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to analyze payjoin proposal' });
    }
  }

  private async $postCreatePlaygroundSession(req: Request, res: Response): Promise<void> {
    try {
      const { amount_sats } = req.body;
      const session = payjoinService.createPlaygroundSession(amount_sats ? Number(amount_sats) : undefined);
      res.json(session);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to create playground session' });
    }
  }

  private async $postAdvancePlaygroundSession(req: Request, res: Response): Promise<void> {
    try {
      const sessionId = req.params.id;
      const session = payjoinService.advancePlaygroundSession(sessionId);
      res.json(session);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to advance playground session' });
    }
  }
}

export default new PayjoinRoutes();
