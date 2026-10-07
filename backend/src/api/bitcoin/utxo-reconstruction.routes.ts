import { Application, Request, Response } from 'express';
import config from '../../config';
import { EsploraReconstructionSource } from './utxo-reconstruction.source';
import { ReconstructionError, UtxoReconstructionService } from './utxo-reconstruction.service';
import { UtxoReconstructionView } from './utxo-reconstruction.types';
import { initUtxoReconstructionV2Routes } from './utxo-reconstruction-v2.routes';
import { initUtxoReconstructionV3Routes } from './utxo-reconstruction-v3.routes';
import { initUtxoReconstructionV4Routes } from './utxo-reconstruction-v4.routes';

let service: UtxoReconstructionService | undefined;
const getService = (): UtxoReconstructionService => service || (service = new UtxoReconstructionService(new EsploraReconstructionSource(), config.MEMPOOL.NETWORK));

export function initUtxoReconstructionRoutes(app: Application): void {
  initUtxoReconstructionV2Routes(app);
  initUtxoReconstructionV3Routes(app);
  initUtxoReconstructionV4Routes(app);
  const base = config.MEMPOOL.API_URL_PREFIX + 'address/:address/utxo-reconstruction';
  const run = async (req: Request, res: Response, work: (signal: AbortSignal) => Promise<UtxoReconstructionView> | UtxoReconstructionView): Promise<void> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    const close = (): void => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', close); res.once('close', close);
    res.set('Cache-Control', 'no-store');
    try {
      if (!/^[a-zA-Z0-9]{2,120}$/.test(req.params.address) || req.params.sessionId && !/^[0-9a-f-]{36}$/.test(req.params.sessionId)) {
        throw new ReconstructionError(400, 'Invalid reconstruction address or session identifier');
      }
      const result = await work(controller.signal);
      if (controller.signal.aborted) {
        if (!res.destroyed) res.status(504).json({ error: 'Reconstruction request exceeded its bounded deadline; progress cursor remains retryable' });
      } else res.json(result);
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        res.status(controller.signal.aborted ? 504 : error instanceof ReconstructionError ? error.status : 503).json({
          error: controller.signal.aborted ? 'Reconstruction cancelled or exceeded its bounded deadline; progress cursor remains retryable'
            : error instanceof ReconstructionError ? error.message : 'Configured reconstruction source could not be verified or reached',
        });
      }
    } finally { clearTimeout(timer); controller.abort(); req.removeListener('aborted', close); res.removeListener('close', close); }
  };
  app.post(base, (req, res) => run(req, res, signal => getService().create(req.params.address, signal)));
  app.post(base + '/:sessionId/next', (req, res) => run(req, res, signal => {
    if (!Number.isSafeInteger(req.body?.cursor) || req.body.cursor < 0) throw new ReconstructionError(400, 'An exact session cursor is required');
    return getService().next(req.params.address, req.params.sessionId, req.body.cursor, signal);
  }));
  app.delete(base + '/:sessionId', (req, res) => run(req, res, () => getService().cancel(req.params.address, req.params.sessionId)));
}
