import { Application, Request, Response } from 'express';
import { ecashService } from './ecash.service';
import { handleError } from '../../../utils/api';

class EcashRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/ecash/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'cashu/mints', this.$getCashuMints)
      .get(prefix + 'cashu/mints/:mintId', this.$getCashuMintById)
      .get(prefix + 'fedimint/federations', this.$getFedimintFederations)
      .get(prefix + 'fedimint/federations/:federationId', this.$getFedimintFederationById)
      .post(prefix + 'providers/claims', this.$postRegisterClaim);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = ecashService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch ecash overview');
    }
  }

  private async $getCashuMints(req: Request, res: Response): Promise<void> {
    try {
      const mints = ecashService.getMints();
      res.json(mints);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch Cashu mints');
    }
  }

  private async $getCashuMintById(req: Request, res: Response): Promise<void> {
    try {
      const mintId = req.params.mintId;
      const mint = ecashService.getMintById(mintId);
      if (!mint) {
        res.status(404).json({ error: 'Cashu mint not found' });
        return;
      }
      res.json(mint);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch Cashu mint');
    }
  }

  private async $getFedimintFederations(req: Request, res: Response): Promise<void> {
    try {
      const federations = ecashService.getFederations();
      res.json(federations);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch Fedimint federations');
    }
  }

  private async $getFedimintFederationById(req: Request, res: Response): Promise<void> {
    try {
      const fedId = req.params.federationId;
      const federation = ecashService.getFederationById(fedId);
      if (!federation) {
        res.status(404).json({ error: 'Fedimint federation not found' });
        return;
      }
      res.json(federation);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch Fedimint federation');
    }
  }

  private async $postRegisterClaim(req: Request, res: Response): Promise<void> {
    try {
      const claim = ecashService.registerClaim(req.body);
      res.json(claim);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to register provider claim' });
    }
  }
}

export default new EcashRoutes();
