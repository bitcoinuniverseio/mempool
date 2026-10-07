import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { ArkEvidenceError, arkService, arkBatchWindow } from './ark.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof ArkEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class ArkRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'ark/';

    app
      .get(prefix + 'operators', this.$getOperators)
      .get(prefix + 'batches', this.$getBatches)
      .get(prefix + 'batches/:batchId', this.$getBatch)
      .get(prefix + 'vtxos/:vtxoId', this.$getVtxo)
      .get(prefix + 'virtual-txs', this.$getVirtualTxs)
      .post(prefix + 'verify', this.$verifyProof)
      .post(prefix + 'verify/native', this.$verifyNativeProof);
  }

  private async $getOperators(req: Request, res: Response): Promise<void> {
    try {
      const operators = await arkService.$getOperators();
      res.json({ operators, total: operators.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getBatches(req: Request, res: Response): Promise<void> {
    try {
      if (Object.keys(req.query || {}).some(key => !['after', 'before', 'limit'].includes(key))) {
        throw new ArkEvidenceError('invalid-ark-batch-window', 'Unsupported completed-round selector.', 400);
      }
      const window = arkBatchWindow(req.query || {});
      const { batches, nativeObservedCount } = await arkService.$getBatchPage({ after: window.after, before: window.before, limit: String(window.limit) });
      res.json({ batches, total: null, page: { ...window, nativeObservedCount, observedCount: batches.length, completeCatalogue: false,
        scope: 'bounded-native-completed-rounds', continuation: null } });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getBatch(req: Request, res: Response): Promise<void> {
    try {
      const batch = await arkService.$getBatch(req.params.batchId);
      if (!batch) {
        res.status(404).json({ error: 'ark-batch-not-found' });
        return;
      }
      res.json(batch);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getVtxo(req: Request, res: Response): Promise<void> {
    try {
      const vtxo = await arkService.$getVtxo(req.params.vtxoId);
      if (!vtxo) {
        res.status(404).json({ error: 'ark-vtxo-not-found' });
        return;
      }
      res.json(vtxo);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getVirtualTxs(req: Request, res: Response): Promise<void> {
    try {
      const virtualTxs = await arkService.$getVirtualTxs();
      res.json({ virtualTxs, total: virtualTxs.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $verifyProof(req: Request, res: Response): Promise<void> {
    try {
      const { vtxoId, proofPath } = req.body || {};
      const result = await arkService.$verifyProof(vtxoId, proofPath);
      // Only bad input and an absent verifier are not answers.
      res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $verifyNativeProof(req: Request, res: Response): Promise<void> {
    try {
      const result = await arkService.$verifyNativeProof(req.body);
      res.status(result.stage === 'invalid-native-proof' ? 400 : result.stage === 'verified-native-proof' ? 200 : 503).json(result);
    } catch (e) { fail(req, res, e); }
  }
}

export default new ArkRoutes();
