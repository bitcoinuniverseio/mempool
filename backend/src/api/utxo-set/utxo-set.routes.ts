import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { UtxoSetEvidenceError, UtxoSetService, utxoSetService } from './utxo-set.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof UtxoSetEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  res.status(503).json({ stage: 'utxo-source-unavailable', error: 'Owned UTXO evidence is unavailable.' });
}

export class UtxoSetRoutes {
  constructor(private readonly service: UtxoSetService = utxoSetService) {}
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX;

    app
      .get(prefix + 'utxo-set/checkpoints', (req, res) => this.$getCheckpoints(req, res))
      .get(prefix + 'utxo-set/distribution', (req, res) => this.$getDistribution(req, res))
      .get(prefix + 'utxo-set/protocols', (req, res) => this.$getProtocolUtxos(req, res))
      .get(prefix + 'utreexo/roots', (req, res) => this.$getUtreexoRoots(req, res))
      .post(prefix + 'utreexo/verify', (req, res) => this.$verifyUtreexo(req, res));
  }

  private async $getCheckpoints(req: Request, res: Response): Promise<void> {
    try {
      const checkpoints = await this.service.$getCheckpoints();
      res.json({ checkpoints, total: checkpoints.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getDistribution(req: Request, res: Response): Promise<void> {
    try {
      const distribution = await this.service.$getDistribution();
      res.json(distribution);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getProtocolUtxos(req: Request, res: Response): Promise<void> {
    try {
      const data = await this.service.$getProtocolUtxos();
      res.json(data);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getUtreexoRoots(req: Request, res: Response): Promise<void> {
    try {
      const roots = await this.service.$getUtreexoRoots();
      res.json(roots);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $verifyUtreexo(req: Request, res: Response): Promise<void> {
    try {
      const { proof } = req.body || {};
      const result = await this.service.$verifyUtreexoProof(proof);
      // Only bad input and an absent verifier are not answers.
      res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new UtxoSetRoutes();
