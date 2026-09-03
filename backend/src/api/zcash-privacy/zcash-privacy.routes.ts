import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { zcashPrivacyService } from './zcash-privacy.service';

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
      handleError(res, e);
    }
  }

  private async $getPools(req: Request, res: Response): Promise<void> {
    try {
      const pools = await zcashPrivacyService.$getPools();
      res.json({ pools, total: pools.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getUpgrades(req: Request, res: Response): Promise<void> {
    try {
      const upgrades = await zcashPrivacyService.$getUpgrades();
      res.json({ upgrades, total: upgrades.length });
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new ZcashPrivacyRoutes();
