import { Application, Request, Response } from 'express';
import config from '../config';
import capabilities from './capabilities';
import { handleError } from '../utils/api';

/**
 * Publishes what this deployment can actually serve. The frontend reads it to
 * render truthful states instead of guessing from its own build-time flags,
 * and the release procedure reads it to refuse an incoherent cutover.
 */
class CapabilitiesRoutes {
  public initRoutes(app: Application): void {
    app.get(config.MEMPOOL.API_URL_PREFIX + 'capabilities', async (req: Request, res: Response) => {
      try {
        const report = await capabilities.$report();
        res.header('Pragma', 'public');
        res.header('Cache-control', 'public');
        res.setHeader('Expires', new Date(Date.now() + 1000 * 10).toUTCString());
        res.json(report);
      } catch (e) {
        handleError(req, res, 500, 'Failed to build the capability report');
      }
    });
  }
}

export default new CapabilitiesRoutes();
