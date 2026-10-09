import { configuredReconstructionV4Binding } from './reconstruction-v4-binding';
import { Application, Request, Response } from 'express';
import config from '../../config';
import { ReconstructionAcquisitionError } from './utxo-reconstruction.source';
import { EsploraReconstructionV4Source } from './utxo-reconstruction-v4.source';
import { ReconstructionError } from './utxo-reconstruction.service';
import { ReconstructionV4Binding } from './utxo-reconstruction-v4.types';
import { UtxoReconstructionV4Service } from './utxo-reconstruction-v4.service';

let service: UtxoReconstructionV4Service | undefined;
const getService = (): UtxoReconstructionV4Service => service || (service = new UtxoReconstructionV4Service(new EsploraReconstructionV4Source(), config.MEMPOOL.NETWORK, Date.now, configuredReconstructionV4Binding));

/** Pure parsing also guards malformed headers in non-HTTP callers/tests. */
export function reconstructionInspectionBinding(query: Record<string, unknown>, contentLength: unknown, transferEncoding: unknown): ReconstructionV4Binding {
  if (Object.keys(query).sort().join(',') !== 'configurationSha256,network,releaseSha' ||
      typeof query.network !== 'string' || !['mainnet','testnet','testnet4','signet','regtest'].includes(query.network) ||
      typeof query.releaseSha !== 'string' || !/^[0-9a-f]{40}$/.test(query.releaseSha) ||
      typeof query.configurationSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(query.configurationSha256) ||
      contentLength !== undefined && (typeof contentLength !== 'string' || !/^0{1,10}$/.test(contentLength)) ||
      transferEncoding !== undefined) {throw new ReconstructionError(400, 'Exact reconstruction inspection binding required');}
  return {network:query.network, releaseSha:query.releaseSha, configurationSha256:query.configurationSha256};
}

export function initUtxoReconstructionV4Routes(app: Application): void {
  const base = config.MEMPOOL.API_URL_PREFIX + 'address/:address/utxo-reconstruction/v4';
  const run = async (req: Request, res: Response, work: (signal: AbortSignal) => Promise<unknown> | unknown): Promise<void> => {
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
  app.get(base + '/:sessionId', (req, res) =>
    run(req, res, () => {
      const expected = reconstructionInspectionBinding(req.query, req.headers['content-length'], req.headers['transfer-encoding']);
      if (!service) {throw new ReconstructionError(404, 'Reconstruction session not found in this address context');}
      return service.inspect(req.params.address, req.params.sessionId, expected);
    })
  );
  app.delete(base + '/:sessionId', (req, res) => run(req, res, () => getService().cancel(req.params.address, req.params.sessionId)));
}
