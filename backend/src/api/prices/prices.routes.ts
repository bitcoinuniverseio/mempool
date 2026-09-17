import { Application, Request, Response } from 'express';
import config from '../../config';
import pricesUpdater from '../../tasks/price-updater';

class PricesRoutes {
  public initRoutes(app: Application): void {
    app
      .get(config.MEMPOOL.API_URL_PREFIX + 'prices', this.$getCurrentPrices.bind(this))
    ;
  }

  private $getCurrentPrices(req: Request, res: Response): void {
    res.header('Pragma', 'public');
    res.header('Cache-control', 'public');
    res.setHeader('Expires', new Date(Date.now() + 360_0000 / config.MEMPOOL.PRICE_UPDATES_PER_HOUR).toUTCString());

    // The served price plus its provenance: a disabled or stale observation
    // is marked as such rather than presented as the current quote.
    res.json(pricesUpdater.getAdvertisedPrices());
  }
}

export default new PricesRoutes();
