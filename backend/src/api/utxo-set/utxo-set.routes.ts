import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { UtxoSetEvidenceError, utxoSetService } from './utxo-set.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof UtxoSetEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

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
      fail(req, res, e);
    }
  }

  private async $getDistribution(req: Request, res: Response): Promise<void> {
    try {
      const distribution = await utxoSetService.$getDistribution();
      res.json(distribution);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getProtocolUtxos(req: Request, res: Response): Promise<void> {
    try {
      const data = await utxoSetService.$getProtocolUtxos();
      res.json(data);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getUtreexoRoots(req: Request, res: Response): Promise<void> {
    try {
      const roots = await utxoSetService.$getUtreexoRoots();
      res.json(roots);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $verifyUtreexo(req: Request, res: Response): Promise<void> {
    try {
      const { proof } = req.body || {};
      const result = await utxoSetService.$verifyUtreexoProof(proof);
      // Only bad input and an absent verifier are not answers.
      res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new UtxoSetRoutes();
