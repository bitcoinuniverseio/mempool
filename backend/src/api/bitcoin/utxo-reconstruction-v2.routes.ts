import { Application, Request, Response } from 'express';
import config from '../../config';
import { EsploraReconstructionSource, ReconstructionAcquisitionError } from './utxo-reconstruction.source';
import { ReconstructionError } from './utxo-reconstruction.service';
import { UtxoReconstructionV2Service } from './utxo-reconstruction-v2.service';
import { UtxoReconstructionV2View } from './utxo-reconstruction-v2.types';

let service: UtxoReconstructionV2Service | undefined;
const getService = (): UtxoReconstructionV2Service => service || (service = new UtxoReconstructionV2Service(new EsploraReconstructionSource(), config.MEMPOOL.NETWORK));

export function initUtxoReconstructionV2Routes(app: Application): void {
  const base = config.MEMPOOL.API_URL_PREFIX + 'address/:address/utxo-reconstruction/v2';
  const run = async (req: Request, res: Response, work: (signal: AbortSignal) => Promise<UtxoReconstructionV2View> | UtxoReconstructionV2View): Promise<void> => {
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
          ...(error instanceof ReconstructionAcquisitionError ? { phase: error.phase, sourceFailure: { code: error.causeCode, upstreamStatus: error.upstreamStatus } } : {}),
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
