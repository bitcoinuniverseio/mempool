import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { utxoSetService } from './utxo-set.service';

class UtxoSetRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;

    app
      .get(prefix + 'utxo-set/checkpoints', this.$getCheckpoints)
      .get(prefix + 'utxo-set/distribution', this.$getDistribution)
      .get(prefix + 'utxo-set/protocols', this.$getProtocolUtxos)
      .get(prefix + 'utreexo/roots', this.$getUtreexoRoots)
      .post(prefix + 'utreexo/verify', this.$verifyUtreexo);
  }

  private async $getCheckpoints(req: Request, res: Response): Promise<void> {
    try {
      const checkpoints = await utxoSetService.$getCheckpoints();
      res.json({ checkpoints, total: checkpoints.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getDistribution(req: Request, res: Response): Promise<void> {
    try {
      const distribution = await utxoSetService.$getDistribution();
      res.json(distribution);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getProtocolUtxos(req: Request, res: Response): Promise<void> {
    try {
      const data = await utxoSetService.$getProtocolUtxos();
      res.json(data);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getUtreexoRoots(req: Request, res: Response): Promise<void> {
    try {
      const roots = await utxoSetService.$getUtreexoRoots();
      res.json(roots);
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $verifyUtreexo(req: Request, res: Response): Promise<void> {
    try {
      const { proof } = req.body || {};
      const result = await utxoSetService.$verifyUtreexoProof(proof || []);
      res.json(result);
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new UtxoSetRoutes();
