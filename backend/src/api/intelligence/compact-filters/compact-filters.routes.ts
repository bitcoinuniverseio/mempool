import { Application, Request, Response } from 'express';
import compactFiltersService, { CompactFiltersEvidenceError } from './compact-filters.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown, status = 500): Response {
  if (err instanceof CompactFiltersEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(status).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

function readNetwork(req: Request): string {
 const query=req.query || {};
 if(Object.keys(query).some(key=>!['network','start','end'].includes(key)) || query.network!==undefined && typeof query.network!=='string') throw new CompactFiltersEvidenceError('invalid-query','Only public network and height selectors are accepted.',400);
 return typeof query.network==='string'?query.network:'main';
}
function readHeight(req:Request,key:string):number|undefined {
 const value=req.query?.[key]; if(value===undefined)return undefined;
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,9})$/.test(value))throw new CompactFiltersEvidenceError('invalid-height','Height must be a canonical nonnegative integer.',400);
 return Number(value);
}
class CompactFiltersRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/compact-filters/overview', async (req: Request, res: Response) => {
      try {
        const overview = compactFiltersService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers', async (req: Request, res: Response) => {
      try {
        const providers = compactFiltersService.listProviders();
        res.json(providers);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers/:providerId', async (req: Request, res: Response) => {
      try {
        const provider = compactFiltersService.getProvider(req.params.providerId);
        if (!provider) {
          return res.status(404).json({ error: 'Provider not found' });
        }
        res.json(provider);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers/:providerId/history', async (req: Request, res: Response) => {
      try {
        const history = compactFiltersService.getProviderHistory(req.params.providerId);
        res.json(history);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/checkpoints', async (req: Request, res: Response) => {
      try {
        const checkpoints = await compactFiltersService.listCheckpoints(readNetwork(req));
        res.json(checkpoints);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/blocks/:blockHash', async (req: Request, res: Response) => {
      try {
        const filter = await compactFiltersService.getBlockFilter(req.params.blockHash, readNetwork(req));
        if (!filter) {
          return res.status(404).json({ error: 'Filter not found' });
        }
        res.json(filter);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/ranges', async (req: Request, res: Response) => {
      try {
        const ranges = await compactFiltersService.getRanges(readHeight(req, 'start'), readHeight(req, 'end'), readNetwork(req));
        res.json(ranges);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/compact-filters/verifications', async (req: Request, res: Response) => {
      try {
        const run = compactFiltersService.createVerification(req.body);
        res.json(run);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/verifications/:verificationId', async (req: Request, res: Response) => {
      try {
        const run = compactFiltersService.getVerification(req.params.verificationId);
        if (!run) {
          return res.status(404).json({ error: 'Verification run not found' });
        }
        res.json(run);
      } catch (err: any) {
        fail(res, err);
      }
    });
  }
}

export default new CompactFiltersRoutes();
