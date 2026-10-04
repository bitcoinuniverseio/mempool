import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { ZcashPrivacyEvidenceError, zcashPrivacyService } from './zcash-privacy.service';
import { zcashBlockSource } from './zcash-block-source';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof ZcashPrivacyEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class ZcashPrivacyRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'zcash/privacy/';

    app.get(prefix + 'blocks', async (req: Request, res: Response) => {
      try {
        if (Object.keys(req.query).some(key => !['network','start','end','previous'].includes(key)) || !/^[1-9][0-9]{0,9}$/.test(String(req.query.start)) || !/^[1-9][0-9]{0,9}$/.test(String(req.query.end))) throw new ZcashPrivacyEvidenceError('invalid-query', 'Only a public network, bounded height interval and optional prior block hash are accepted.', 400);
        const result = await zcashBlockSource.range(String(req.query.network), Number(req.query.start), Number(req.query.end), req.query.previous === undefined ? undefined : String(req.query.previous));
        res.setHeader('Cache-Control', 'no-store'); res.json(result);
      } catch (error) { fail(req, res, error); }
    });

    app
      .get(prefix + 'history', async (req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
          if (Object.keys(req.query).some(key => key !== 'network') || req.query.network !== undefined && typeof req.query.network !== 'string') throw new ZcashPrivacyEvidenceError('invalid-query', 'Only the exact public network is accepted.', 400);
          res.json(await zcashPrivacyService.$getHistory(req.query.network === undefined ? 'mainnet' : String(req.query.network)));
        } catch (error) { fail(req, res, error); }
      })
      .get(prefix + 'summary', this.$getSummary)
      .get(prefix + 'pools', this.$getPools)
      .get(prefix + 'upgrades', this.$getUpgrades);
  }

  private async $getSummary(req: Request, res: Response): Promise<void> {
    try {
      const summary = await zcashPrivacyService.$getSummary(req.query.network === undefined ? 'mainnet' : String(req.query.network));
      res.setHeader('Cache-Control', 'no-store');
      res.json(summary);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getPools(req: Request, res: Response): Promise<void> {
    try {
      const summary = await zcashPrivacyService.$getSummary(req.query.network === undefined ? 'mainnet' : String(req.query.network));
      const pools = summary.pools;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ pools, total: pools.length, network: summary.network, source: summary.source, tipHeight: summary.tipHeight });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getUpgrades(req: Request, res: Response): Promise<void> {
    try {
      const upgrades = await zcashPrivacyService.$getUpgrades(req.query.network === undefined ? 'mainnet' : String(req.query.network));
      res.json({ upgrades, total: upgrades.length });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new ZcashPrivacyRoutes();
