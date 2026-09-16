import { Application, Request, Response } from 'express';
import dlcService, { DlcEvidenceError } from './dlc.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(res: Response, err: unknown, status: number, fallback: string): void {
  if (err instanceof DlcEvidenceError) {
    res.status(err.status).json({ stage: err.code, error: err.message });
    return;
  }
  res.status(status).json({ error: err instanceof Error && err.message ? err.message : fallback });
}

class DlcRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/dlc/overview', (req: Request, res: Response) => {
      try {
        const overview = dlcService.getOverview();
        res.json(overview);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles', (req: Request, res: Response) => {
      try {
        const oracles = dlcService.listOracles();
        res.json(oracles);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles/:oracleId', (req: Request, res: Response) => {
      try {
        const oracle = dlcService.getOracle(req.params.oracleId);
        if (!oracle) {
          return res.status(404).json({ error: 'Oracle not found' });
        }
        res.json(oracle);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles/:oracleId/history', (req: Request, res: Response) => {
      try {
        const history = dlcService.getOracleHistory(req.params.oracleId);
        res.json(history);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/events', (req: Request, res: Response) => {
      try {
        const events = dlcService.listEvents();
        res.json(events);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/events/:eventId', (req: Request, res: Response) => {
      try {
        const event = dlcService.getEvent(req.params.eventId);
        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }
        res.json(event);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/events/:eventId/attestations', (req: Request, res: Response) => {
      try {
        const attestations = dlcService.getEventAttestations(req.params.eventId);
        res.json(attestations);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.get('/api/v1/intelligence/dlc/conflicts', (req: Request, res: Response) => {
      try {
        const conflicts = dlcService.listConflicts();
        res.json(conflicts);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });

    app.post('/api/v1/intelligence/dlc/announcements/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyAnnouncement(req.body);
        res.json(result);
      } catch (err) {
        fail(res, err, 400, 'Invalid announcement request');
      }
    });

    app.post('/api/v1/intelligence/dlc/attestations/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyAttestation(req.body);
        res.json(result);
      } catch (err) {
        fail(res, err, 400, 'Invalid attestation request');
      }
    });

    app.post('/api/v1/intelligence/dlc/contracts/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyContractPackage(req.body);
        res.json(result);
      } catch (err) {
        fail(res, err, 400, 'Invalid contract package');
      }
    });

    app.post('/api/v1/intelligence/dlc/simulations', (req: Request, res: Response) => {
      try {
        const sim = dlcService.createSimulation(req.body);
        res.json(sim);
      } catch (err) {
        fail(res, err, 400, 'Simulation execution failed');
      }
    });

    app.get('/api/v1/intelligence/dlc/simulations/:simulationId', (req: Request, res: Response) => {
      try {
        const sim = dlcService.getSimulation(req.params.simulationId);
        if (!sim) {
          return res.status(404).json({ error: 'Simulation not found' });
        }
        res.json(sim);
      } catch (err) {
        fail(res, err, 500, 'Internal error');
      }
    });
  }
}

export default new DlcRoutes();
