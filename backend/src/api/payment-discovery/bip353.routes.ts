import { Application } from 'express';
import config from '../../config';
import { Bip353Error, bip353Service } from './bip353.service';

export function registerBip353Routes(app: Application): void {
  app.get(config.MEMPOOL.API_URL_PREFIX + 'payment-discovery/bip353', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await bip353Service.resolve(req.query.name);
      res.json({ ...result, network: config.MEMPOOL.NETWORK });
    } catch (error) {
      const failure = error instanceof Bip353Error ? error : new Bip353Error('resolution-failed', 'DNSSEC resolution failed.', 502);
      res.status(failure.status).json({ code: failure.code, error: failure.message });
    }
  });
}
