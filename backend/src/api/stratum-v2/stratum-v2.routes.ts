import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { StratumV2EvidenceError, stratumV2Service } from './stratum-v2.service';
import { Sv2Family } from './stratum-v2.types';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof StratumV2EvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class StratumV2Routes {
  private async read(req: Request, res: Response, family: Sv2Family): Promise<void> {
    const controller = new AbortController(), abort = (): void => { controller.abort(); };
    const closed = (): void => { if (!res.writableEnded) abort(); };
    req.once?.('aborted', abort); res.once?.('close', closed);
    try {
      if (Object.keys(req.query || {}).some(key => !['network', 'limit', 'cursor'].includes(key))) throw new StratumV2EvidenceError('invalid-sv2-selector', 'Unsupported SV2 query selector.', 400);
      const page = await stratumV2Service.$getPage(family, req.query || {}, controller.signal);
      if (!controller.signal.aborted) { res.setHeader?.('Cache-Control', 'no-store'); res.json({ ...page, [family]: page.items }); }
    } catch (error) { if (!controller.signal.aborted) fail(req, res, error); }
    finally { req.removeListener?.('aborted', abort); res.removeListener?.('close', closed); }
  }
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'stratum-v2/';

    app
      .get(prefix + 'network', (req, res) => this.read(req, res, 'roles'))
      .get(prefix + 'templates', (req, res) => this.read(req, res, 'templates'))
      .get(prefix + 'declarations', (req, res) => this.read(req, res, 'declarations'));
  }

}

export default new StratumV2Routes();
