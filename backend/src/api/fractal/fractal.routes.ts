import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { FractalEvidenceError, fractalService } from './fractal.service';
import { Cat20PageRequest } from './fractal.types';

function page(req: Request): Cat20PageRequest {
  const { limit, cursor } = req.query || {};
  if ((limit !== undefined && (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit)))
    || (cursor !== undefined && typeof cursor !== 'string')) {
    throw new FractalEvidenceError('invalid-cat20-input', 'Invalid CAT pagination parameters.', 400);
  }
  return { limit: limit === undefined ? undefined : Number(limit), cursor: cursor as string | undefined };
}

function selectedNetwork(req: Request): void {
  const network = req.query?.network;
  if (network !== undefined && network !== 'testnet') {
    throw new FractalEvidenceError('unsupported-fractal-network', 'This source is explicitly bound to Fractal testnet.', 400);
  }
}

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
      selectedNetwork(req);
      const tip = await fractalService.$getTip();
      res.json(tip);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getMempool(req: Request, res: Response): Promise<void> {
    try {
      selectedNetwork(req);
      const mempool = await fractalService.$getMempool();
      res.json(mempool);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getBlock(req: Request, res: Response): Promise<void> {
    try {
      selectedNetwork(req);
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
      selectedNetwork(req);
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
      selectedNetwork(req);
      const result = await fractalService.$getCat20Tokens(page(req));
      res.json({ ...result, tokens: result.items });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getCat20Token(req: Request, res: Response): Promise<void> {
    try {
      selectedNetwork(req);
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
      selectedNetwork(req);
      const result = await fractalService.$getCat20Holders(req.params.tokenId, page(req));
      res.json({ ...result, holders: result.items });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new FractalRoutes();
