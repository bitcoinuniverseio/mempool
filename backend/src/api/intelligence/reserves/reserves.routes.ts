import { Application, Request, Response } from 'express';
import { ReservesEvidenceError, reservesService } from './reserves.service';
import { handleError } from '../../../utils/api';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof ReservesEvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

class ReservesRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/reserves/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'providers', this.$getProviders)
      .get(prefix + 'providers/:providerId', this.$getProviderById)
      .get(prefix + 'snapshots', this.$getSnapshots)
      .get(prefix + 'snapshots/:snapshotId', this.$getSnapshotById)
      .post(prefix + 'verify', this.$verifyProof);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = reservesService.getOverview();
      res.json(overview);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch reserves overview');
    }
  }

  private async $getProviders(req: Request, res: Response): Promise<void> {
    try {
      const providers = reservesService.getProviders();
      res.json(providers);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch reserve providers');
    }
  }

  private async $getProviderById(req: Request, res: Response): Promise<void> {
    try {
      const providerId = req.params.providerId;
      const provider = reservesService.getProviderById(providerId);
      if (!provider) {
        handleError(req, res, 404, `Reserve provider ${providerId} not found`);
        return;
      }
      res.json(provider);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch reserve provider');
    }
  }

  private async $getSnapshots(req: Request, res: Response): Promise<void> {
    try {
      const providerId = req.query.provider_id as string | undefined;
      const snapshots = reservesService.getSnapshots(providerId);
      res.json(snapshots);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch reserve snapshots');
    }
  }

  private async $getSnapshotById(req: Request, res: Response): Promise<void> {
    try {
      const snapshotId = req.params.snapshotId;
      const snapshot = reservesService.getSnapshotById(snapshotId);
      if (!snapshot) {
        handleError(req, res, 404, `Reserve snapshot ${snapshotId} not found`);
        return;
      }
      res.json(snapshot);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch reserve snapshot');
    }
  }

  private async $verifyProof(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      const result = reservesService.verifyProof(body);
      res.json(result);
    } catch (e) {
      fail(req, res, e, 'Failed to verify proof');
    }
  }
}

export default new ReservesRoutes();
