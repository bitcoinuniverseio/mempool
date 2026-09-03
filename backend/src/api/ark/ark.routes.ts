import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { arkService } from './ark.service';

class ArkRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'ark/';

    app
      .get(prefix + 'operators', this.$getOperators)
      .get(prefix + 'batches', this.$getBatches)
      .get(prefix + 'batches/:batchId', this.$getBatch)
      .get(prefix + 'vtxos/:vtxoId', this.$getVtxo)
      .get(prefix + 'virtual-txs', this.$getVirtualTxs)
      .post(prefix + 'verify', this.$verifyProof);
  }

  private async $getOperators(req: Request, res: Response): Promise<void> {
    try {
      const operators = await arkService.$getOperators();
      res.json({ operators, total: operators.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getBatches(req: Request, res: Response): Promise<void> {
    try {
      const batches = await arkService.$getBatches();
      res.json({ batches, total: batches.length });
    } catch (e) {
      handleError(res, e);
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
      handleError(res, e);
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
      handleError(res, e);
    }
  }

  private async $getVirtualTxs(req: Request, res: Response): Promise<void> {
    try {
      const virtualTxs = await arkService.$getVirtualTxs();
      res.json({ virtualTxs, total: virtualTxs.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $verifyProof(req: Request, res: Response): Promise<void> {
    try {
      const { vtxoId, proofPath } = req.body || {};
      const result = await arkService.$verifyProof(vtxoId || '', proofPath || []);
      res.json(result);
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new ArkRoutes();
