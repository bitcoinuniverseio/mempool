import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { ZcashPrivacyEvidenceError, zcashPrivacyService } from './zcash-privacy.service';

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

    app
      .get(prefix + 'summary', this.$getSummary)
      .get(prefix + 'pools', this.$getPools)
      .get(prefix + 'upgrades', this.$getUpgrades);
  }

  private async $getSummary(req: Request, res: Response): Promise<void> {
    try {
      const summary = await zcashPrivacyService.$getSummary();
      res.json(summary);
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getPools(req: Request, res: Response): Promise<void> {
    try {
      const pools = await zcashPrivacyService.$getPools();
      res.json({ pools, total: pools.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getUpgrades(req: Request, res: Response): Promise<void> {
    try {
      const upgrades = await zcashPrivacyService.$getUpgrades();
      res.json({ upgrades, total: upgrades.length });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new ZcashPrivacyRoutes();
