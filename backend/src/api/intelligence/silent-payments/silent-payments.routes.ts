import { Application, Request, Response } from 'express';
import { silentPaymentsService, SilentPaymentUnavailable } from './silent-payments.service';
import { SP_NETWORKS } from './silent-payments-parsers';

class SilentPaymentRequestError extends Error {}

export function silentPaymentNetwork(req: Request): string {
  const { chain, network } = req.query;
  if (chain === undefined && network === undefined) {return 'mainnet';}
  if (chain !== 'bitcoin' || typeof network !== 'string' || !SP_NETWORKS.includes(network)) {throw new SilentPaymentRequestError('Provide a supported chain=bitcoin and network together.');}
  return network;
}
function height(req: Request): number {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(req.params.height) || Number(req.params.height) > 0xffffffff) {throw new SilentPaymentRequestError('Invalid block height.');}
  return Number(req.params.height);
}

class SilentPaymentsRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/payments/silent/';
    const handler = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
      try { await fn(req, res); }
      catch (error) {
        const invalid = error instanceof SilentPaymentRequestError;
        const message = invalid || error instanceof SilentPaymentUnavailable ? error.message : 'Silent Payments storage or first-party source request failed.';
        res.status(invalid ? 400 : 503).json({ error: message, code: invalid ? 'INVALID_REQUEST' : 'SOURCE_UNAVAILABLE' });
      }
    };
    app.get(prefix + 'coverage', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      const result = await silentPaymentsService.getCoverageOverview(silentPaymentNetwork(req));
      res.status(result.status === 'unavailable' ? 503 : 200).json(result);
    }));
    app.get(prefix + 'blocks/:height/manifest', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      const result = await silentPaymentsService.getBlockManifest(height(req), silentPaymentNetwork(req));
      if (!result) { res.status(404).json({ error: 'Block has not been indexed.', code: 'BLOCK_NOT_INDEXED' }); return; }
      res.set('Cache-Control', 'no-store').json(result);
    }));
    app.get(prefix + 'blocks/:height/bundle', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      const bytes = await silentPaymentsService.getBlockBundleBytes(height(req), silentPaymentNetwork(req));
      if (!bytes) { res.status(404).json({ error: 'Block has not been indexed.', code: 'BLOCK_NOT_INDEXED' }); return; }
      res.set('Cache-Control', 'no-store').type('application/json').send(bytes);
    }));
    app.get(prefix + 'support', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => { silentPaymentNetwork(req); res.json(await silentPaymentsService.getSupportRegistry()); }));
    app.post(prefix + 'validate-address', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      const result = silentPaymentsService.validateSilentPaymentAddress(req.body?.address, silentPaymentNetwork(req));
      res.status(result.valid ? 200 : 400).json(result);
    }));
    app.post(prefix + 'validate-psbt', handler(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      silentPaymentNetwork(req);
      const result = silentPaymentsService.validatePsbtFields(req.body?.psbt);
      res.status(result.valid ? 200 : 400).json(result);
    }));
    silentPaymentsService.start();
  }
}

export default new SilentPaymentsRoutes();
