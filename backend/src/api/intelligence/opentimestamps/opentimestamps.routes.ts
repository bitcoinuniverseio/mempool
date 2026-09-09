import { Application, Request, Response } from 'express';
import openTimestampsService, { TimestampEvidenceError } from './opentimestamps.service';

function fail(res: Response, err: unknown): Response {
  if (err instanceof TimestampEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(500).json({ error: 'Internal error' });
}

class OpenTimestampsRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/timestamps/overview', async (_req: Request, res: Response) => {
      try {
        const overview = await openTimestampsService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/timestamps/calendars', async (_req: Request, res: Response) => {
      try {
        const calendars = await openTimestampsService.listCalendars();
        res.json(calendars);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/timestamps/calendars/:calendarId', async (req: Request, res: Response) => {
      try {
        const calendar = await openTimestampsService.getCalendar(req.params.calendarId);
        if (!calendar) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
        res.json(calendar);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/timestamps/anchors', async (_req: Request, res: Response) => {
      try {
        const anchors = await openTimestampsService.listAnchors();
        res.json(anchors);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/timestamps/batches/:batchId', async (req: Request, res: Response) => {
      try {
        const batch = await openTimestampsService.getBatch(req.params.batchId);
        if (!batch) {
          return res.status(404).json({ error: 'Batch not found' });
        }
        res.json(batch);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/timestamps/digests/stamp', async (req: Request, res: Response) => {
      try {
        const digest = req.body?.digest ?? req.body?.hash;
        const result = await openTimestampsService.stampDigest(digest);
        res.json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/timestamps/proofs/verify', async (req: Request, res: Response) => {
      try {
        const result = await openTimestampsService.verifyProof(req.body);
        res.json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/timestamps/proofs/upgrade', async (req: Request, res: Response) => {
      try {
        const result = await openTimestampsService.upgradeProof(req.body ?? {});
        res.json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });
  }
}

export default new OpenTimestampsRoutes();
