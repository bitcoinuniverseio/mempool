import { Application, Request, Response } from 'express';
import { silentPaymentsService } from './silent-payments.service';
import { handleError } from '../../../utils/api';

class SilentPaymentsRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/payments/silent/';

    app
      .get(prefix + 'coverage', this.$getCoverage)
      .get(prefix + 'blocks/:height/manifest', this.$getBlockManifest)
      .get(prefix + 'blocks/:height/bundle', this.$getBlockBundle)
      .get(prefix + 'support', this.$getSupportRegistry)
      .post(prefix + 'validate-address', this.$postValidateAddress)
      .post(prefix + 'validate-psbt', this.$postValidatePsbt);
  }

  private async $getCoverage(req: Request, res: Response): Promise<void> {
    try {
      const overview = silentPaymentsService.getCoverageOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch silent payments coverage');
    }
  }

  private async $getBlockManifest(req: Request, res: Response): Promise<void> {
    try {
      const height = parseInt(req.params.height, 10);
      const manifest = silentPaymentsService.getBlockManifest(height);
      if (!manifest) {
        res.status(404).json({ error: 'Block manifest not found' });
        return;
      }
      res.json(manifest);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch block manifest');
    }
  }

  private async $getBlockBundle(req: Request, res: Response): Promise<void> {
    try {
      const height = parseInt(req.params.height, 10);
      const bundle = silentPaymentsService.getBlockBundle(height);
      if (!bundle) {
        res.status(404).json({ error: 'Block bundle not found' });
        return;
      }
      res.json(bundle);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch block bundle');
    }
  }

  private async $getSupportRegistry(req: Request, res: Response): Promise<void> {
    try {
      const claims = silentPaymentsService.getSupportRegistry();
      res.json(claims);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch support registry');
    }
  }

  private async $postValidateAddress(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.body;
      const result = silentPaymentsService.validateSilentPaymentAddress(address);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to validate address' });
    }
  }

  private async $postValidatePsbt(req: Request, res: Response): Promise<void> {
    try {
      const { psbt } = req.body;
      const result = silentPaymentsService.validatePsbtFields(psbt);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to validate PSBT' });
    }
  }
}

export default new SilentPaymentsRoutes();
