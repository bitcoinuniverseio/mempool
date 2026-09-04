import { Application, Request, Response } from 'express';
import openTimestampsService from './opentimestamps.service';

class OpenTimestampsRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/timestamps/overview', (_req: Request, res: Response) => {
      try {
        const overview = openTimestampsService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/timestamps/calendars', (_req: Request, res: Response) => {
      try {
        const calendars = openTimestampsService.listCalendars();
        res.json(calendars);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/timestamps/calendars/:calendarId', (req: Request, res: Response) => {
      try {
        const calendar = openTimestampsService.getCalendar(req.params.calendarId);
        if (!calendar) {
          return res.status(404).json({ error: 'Calendar not found' });
        }
        res.json(calendar);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/timestamps/anchors', (_req: Request, res: Response) => {
      try {
        const anchors = openTimestampsService.listAnchors();
        res.json(anchors);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/timestamps/batches/:batchId', (req: Request, res: Response) => {
      try {
        const batch = openTimestampsService.getBatch(req.params.batchId);
        if (!batch) {
          return res.status(404).json({ error: 'Batch not found' });
        }
        res.json(batch);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/timestamps/digests/stamp', (req: Request, res: Response) => {
      try {
        const digest = req.body.digest || req.body.hash;
        const result = openTimestampsService.stampDigest(digest);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/timestamps/proofs/verify', (req: Request, res: Response) => {
      try {
        const result = openTimestampsService.verifyProof(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/timestamps/proofs/upgrade', (req: Request, res: Response) => {
      try {
        const result = openTimestampsService.upgradeProof(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new OpenTimestampsRoutes();
