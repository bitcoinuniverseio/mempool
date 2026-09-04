import { Application, Request, Response } from 'express';
import compactFiltersService from './compact-filters.service';

class CompactFiltersRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/compact-filters/overview', (req: Request, res: Response) => {
      try {
        const overview = compactFiltersService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers', (req: Request, res: Response) => {
      try {
        const providers = compactFiltersService.listProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
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
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/compact-filters/providers/:providerId/history', (req: Request, res: Response) => {
      try {
        const history = compactFiltersService.getProviderHistory(req.params.providerId);
        res.json(history);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/compact-filters/checkpoints', (req: Request, res: Response) => {
      try {
        const checkpoints = compactFiltersService.listCheckpoints();
        res.json(checkpoints);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
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
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/compact-filters/ranges', (req: Request, res: Response) => {
      try {
        const ranges = compactFiltersService.getRanges();
        res.json(ranges);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/compact-filters/verifications', (req: Request, res: Response) => {
      try {
        const run = compactFiltersService.createVerification(req.body);
        res.json(run);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Verification execution failed' });
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
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new CompactFiltersRoutes();
