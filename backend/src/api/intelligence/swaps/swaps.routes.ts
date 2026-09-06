import { Application, Request, Response } from 'express';
import swapsService from './swaps.service';
import { swapContext, SwapEvidenceError } from './swaps-evidence';

const publicFields = new Set(['chain', 'network', 'swap_id', 'swap_type', 'protocol_id', 'protocol_revision',
  'schema_version', 'provider_id', 'created_at', 'expires_at', 'preimage_hash', 'timeout_height',
  'expected_amount_sats', 'lockup_address', 'lockup_transaction', 'lockup_vout', 'claim_transaction',
  'refund_transaction', 'claim_public_key', 'refund_public_key', 'internal_key', 'destination_address', 'fee_sats', 'status']);

class SwapsRoutes {
  public initRoutes(app: Application): void {
    const base = '/api/v1/intelligence/swaps';
    const handle = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        swapContext(req.query.chain, req.query.network);
        if (req.method === 'POST') {
          if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || JSON.stringify(req.body).length > 16384) {
            return res.status(400).json({ error: 'Provide a JSON object no larger than 16 KiB.', stage: 'invalid' });
          }
          if (!req.path.endsWith('/manifests/verify') && Object.keys(req.body).some(key => !publicFields.has(key))) {
            return res.status(400).json({ error: 'Only the documented public package fields are accepted. Remove private backup data and caller-controlled height.', stage: 'invalid' });
          }
        }
        return await fn(req, res);
      } catch (err) {
        return res.status(err instanceof SwapEvidenceError && err.code !== 'unavailable-registry' ? 400 : 503).json({
          error: err instanceof SwapEvidenceError ? err.message : 'Swap evidence service is unavailable.',
          stage: err instanceof SwapEvidenceError ? err.code : 'unavailable-source',
        });
      }
    };
    app.get(`${base}/overview`, handle(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => res.json(await swapsService.getOverview(swapContext(req.query.chain, req.query.network)))));
    app.get(`${base}/protocols`, handle((_req, res) => res.json(swapsService.listProtocols())));
    app.get(`${base}/providers`, handle((_req, res) => res.json(swapsService.listProviders())));
    app.get(`${base}/providers/:providerId`, handle((req, res) => {
      const provider = swapsService.getProvider(req.params.providerId);
      return provider ? res.json(provider) : res.status(404).json({ error: 'The provider identity is unknown to the authenticated registry.', stage: 'unknown-provider' });
    }));
    app.get(`${base}/providers/:providerId/history`, handle((req, res) => {
      const history = swapsService.getProviderHistory(req.params.providerId);
      return history ? res.json(history) : res.status(404).json({ error: 'The provider identity is unknown to the authenticated registry.', stage: 'unknown-provider' });
    }));
    app.post(`${base}/manifests/verify`, handle((req, res) => {
      const result = swapsService.verifyProviderManifest(req.body);
      return res.status(result.stage === 'unavailable-registry' ? 503 : result.stage === 'invalid' ? 400 : 200).json(result);
    }));
    app.post(`${base}/public-receipts/verify`, handle(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => res.json(await swapsService.verifyReceipts(req.body, swapContext(req.query.chain, req.query.network)))));
    app.post(`${base}/chain-context`, handle(/** @asyncUnsafe The route wrapper catches rejected requests. */ async (req, res) => {
      const recovery_plan = await swapsService.planRecovery(req.body, swapContext(req.query.chain, req.query.network));
      return res.json({ current_height: recovery_plan.current_block_height, recovery_plan,
        reconciliation: swapsService.reconcileCrossLayer(req.body.swap_id) });
    }));
  }
}
export default new SwapsRoutes();
