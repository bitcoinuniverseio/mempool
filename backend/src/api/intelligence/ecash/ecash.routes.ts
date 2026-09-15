import { Application, Request, Response } from 'express';
import { ecashService, EcashUnavailableError } from './ecash.service';
import { handleError } from '../../../utils/api';

/** An unconfigured mint list or a missing client is a 503 that names it, never an invented provider. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof EcashUnavailableError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

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
      const overview = await ecashService.getOverview();
      res.json(overview);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch ecash overview');
    }
  }

  private async $getCashuMints(req: Request, res: Response): Promise<void> {
    try {
      const mints = await ecashService.getMints();
      res.json(mints);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch Cashu mints');
    }
  }

  private async $getCashuMintById(req: Request, res: Response): Promise<void> {
    try {
      const mintId = req.params.mintId;
      const mint = await ecashService.getMintById(mintId);
      if (!mint) {
        res.status(404).json({ error: 'Cashu mint not found' });
        return;
      }
      res.json(mint);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch Cashu mint');
    }
  }

  private async $getFedimintFederations(req: Request, res: Response): Promise<void> {
    try {
      const federations = ecashService.getFederations();
      res.json(federations);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch Fedimint federations');
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
      fail(req, res, e, 'Failed to fetch Fedimint federation');
    }
  }

  private async $postRegisterClaim(req: Request, res: Response): Promise<void> {
    try {
      const claim = ecashService.verifyClaim(req.body ?? {});
      res.json(claim);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to register provider claim' });
    }
  }
}

export default new EcashRoutes();
