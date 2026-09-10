import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { FractalEvidenceError, fractalService } from './fractal.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof FractalEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class FractalRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'fractal/';

    app
      .get(prefix + 'tip', this.$getTip)
      .get(prefix + 'mempool', this.$getMempool)
      .get(prefix + 'block/:hash', this.$getBlock)
      .get(prefix + 'tx/:txid', this.$getTransaction)
      .get(prefix + 'cat20/tokens', this.$getCat20Tokens)
      .get(prefix + 'cat20/tokens/:tokenId', this.$getCat20Token)
      .get(prefix + 'cat20/tokens/:tokenId/holders', this.$getCat20Holders);
  }

  private async $getTip(req: Request, res: Response): Promise<void> {
    try {
      const tip = await fractalService.$getTip();
      res.json(tip);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getMempool(req: Request, res: Response): Promise<void> {
    try {
      const mempool = await fractalService.$getMempool();
      res.json(mempool);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getBlock(req: Request, res: Response): Promise<void> {
    try {
      const block = await fractalService.$getBlock(req.params.hash);
      if (!block) {
        res.status(404).json({ error: 'block-not-found' });
        return;
      }
      res.json(block);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getTransaction(req: Request, res: Response): Promise<void> {
    try {
      const tx = await fractalService.$getTransaction(req.params.txid);
      if (!tx) {
        res.status(404).json({ error: 'tx-not-found' });
        return;
      }
      res.json(tx);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getCat20Tokens(req: Request, res: Response): Promise<void> {
    try {
      const tokens = await fractalService.$getCat20Tokens();
      res.json({ tokens, total: tokens.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getCat20Token(req: Request, res: Response): Promise<void> {
    try {
      const token = await fractalService.$getCat20Token(req.params.tokenId);
      if (!token) {
        res.status(404).json({ error: 'cat20-token-not-found' });
        return;
      }
      res.json(token);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getCat20Holders(req: Request, res: Response): Promise<void> {
    try {
      const holders = await fractalService.$getCat20Holders(req.params.tokenId);
      res.json({ holders, total: holders.length });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new FractalRoutes();
