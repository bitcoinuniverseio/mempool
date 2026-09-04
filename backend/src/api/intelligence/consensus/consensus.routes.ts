import { Application, Request, Response } from 'express';
import { consensusService } from './consensus.service';
import { handleError } from '../../../utils/api';

class ConsensusRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/consensus/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'proposals', this.$getProposals)
      .get(prefix + 'proposals/:proposalId', this.$getProposalById)
      .get(prefix + 'vaults/templates', this.$getVaultTemplates)
      .post(prefix + 'simulations', this.$postSimulateCovenant);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = consensusService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch consensus overview');
    }
  }

  private async $getProposals(req: Request, res: Response): Promise<void> {
    try {
      const proposals = consensusService.getProposals();
      res.json(proposals);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch proposals');
    }
  }

  private async $getProposalById(req: Request, res: Response): Promise<void> {
    try {
      const id = req.params.proposalId;
      const proposal = consensusService.getProposalById(id);
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      res.json(proposal);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch proposal');
    }
  }

  private async $getVaultTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = consensusService.getVaultTemplates();
      res.json(templates);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch vault templates');
    }
  }

  private async $postSimulateCovenant(req: Request, res: Response): Promise<void> {
    try {
      const result = consensusService.simulateCovenant(req.body);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to simulate covenant' });
    }
  }
}

export default new ConsensusRoutes();
