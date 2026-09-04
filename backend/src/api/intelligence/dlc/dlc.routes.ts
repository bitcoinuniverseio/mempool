import { Application, Request, Response } from 'express';
import dlcService from './dlc.service';

class DlcRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/dlc/overview', (req: Request, res: Response) => {
      try {
        const overview = dlcService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles', (req: Request, res: Response) => {
      try {
        const oracles = dlcService.listOracles();
        res.json(oracles);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles/:oracleId', (req: Request, res: Response) => {
      try {
        const oracle = dlcService.getOracle(req.params.oracleId);
        if (!oracle) {
          return res.status(404).json({ error: 'Oracle not found' });
        }
        res.json(oracle);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/oracles/:oracleId/history', (req: Request, res: Response) => {
      try {
        const history = dlcService.getOracleHistory(req.params.oracleId);
        res.json(history);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/events', (req: Request, res: Response) => {
      try {
        const events = dlcService.listEvents();
        res.json(events);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/events/:eventId', (req: Request, res: Response) => {
      try {
        const event = dlcService.getEvent(req.params.eventId);
        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }
        res.json(event);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/events/:eventId/attestations', (req: Request, res: Response) => {
      try {
        const attestations = dlcService.getEventAttestations(req.params.eventId);
        res.json(attestations);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/dlc/conflicts', (req: Request, res: Response) => {
      try {
        const conflicts = dlcService.listConflicts();
        res.json(conflicts);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/dlc/announcements/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyAnnouncement(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Invalid announcement request' });
      }
    });

    app.post('/api/v1/intelligence/dlc/attestations/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyAttestation(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Invalid attestation request' });
      }
    });

    app.post('/api/v1/intelligence/dlc/contracts/verify', (req: Request, res: Response) => {
      try {
        const result = dlcService.verifyContractPackage(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Invalid contract package' });
      }
    });

    app.post('/api/v1/intelligence/dlc/simulations', (req: Request, res: Response) => {
      try {
        const sim = dlcService.createSimulation(req.body);
        res.json(sim);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Simulation execution failed' });
      }
    });

    app.get('/api/v1/intelligence/dlc/simulations/:simulationId', (req: Request, res: Response) => {
      try {
        const sim = dlcService.getSimulation(req.params.simulationId);
        if (!sim) {
          return res.status(404).json({ error: 'Simulation not found' });
        }
        res.json(sim);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new DlcRoutes();
