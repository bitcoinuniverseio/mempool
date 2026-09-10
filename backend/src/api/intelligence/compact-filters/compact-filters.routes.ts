import { Application, Request, Response } from 'express';
import compactFiltersService, { CompactFiltersEvidenceError } from './compact-filters.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown, status = 500): Response {
  if (err instanceof CompactFiltersEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(status).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

class CompactFiltersRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/compact-filters/overview', (req: Request, res: Response) => {
      try {
        const overview = compactFiltersService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers', (req: Request, res: Response) => {
      try {
        const providers = compactFiltersService.listProviders();
        res.json(providers);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers/:providerId', (req: Request, res: Response) => {
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

    app.get('/api/v1/intelligence/compact-filters/providers/:providerId/history', (req: Request, res: Response) => {
      try {
        const history = compactFiltersService.getProviderHistory(req.params.providerId);
        res.json(history);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/checkpoints', (req: Request, res: Response) => {
      try {
        const checkpoints = compactFiltersService.listCheckpoints();
        res.json(checkpoints);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/blocks/:blockHash', (req: Request, res: Response) => {
      try {
        const filter = compactFiltersService.getBlockFilter(req.params.blockHash);
        if (!filter) {
          return res.status(404).json({ error: 'Filter not found' });
        }
        res.json(filter);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/ranges', (req: Request, res: Response) => {
      try {
        const ranges = compactFiltersService.getRanges();
        res.json(ranges);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/compact-filters/verifications', (req: Request, res: Response) => {
      try {
        const run = compactFiltersService.createVerification(req.body);
        res.json(run);
      } catch (err: any) {
        fail(res, err, 400);
      }
    });

    app.get('/api/v1/intelligence/compact-filters/verifications/:verificationId', (req: Request, res: Response) => {
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
