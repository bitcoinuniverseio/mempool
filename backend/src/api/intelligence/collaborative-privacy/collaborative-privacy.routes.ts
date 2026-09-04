import { Application, Request, Response } from 'express';
import collaborativePrivacyService from './collaborative-privacy.service';

class CollaborativePrivacyRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/collaborative/overview', (_req: Request, res: Response) => {
      try {
        const overview = collaborativePrivacyService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/protocols', (_req: Request, res: Response) => {
      try {
        const protocols = collaborativePrivacyService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/coordinators', (_req: Request, res: Response) => {
      try {
        const coordinators = collaborativePrivacyService.listCoordinators();
        res.json(coordinators);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/coordinators/:coordinatorId', (req: Request, res: Response) => {
      try {
        const coordinator = collaborativePrivacyService.getCoordinator(req.params.coordinatorId);
        if (!coordinator) {
          return res.status(404).json({ error: 'Coordinator not found' });
        }
        res.json(coordinator);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/rounds', (_req: Request, res: Response) => {
      try {
        const rounds = collaborativePrivacyService.listRounds();
        res.json(rounds);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/rounds/:roundId', (req: Request, res: Response) => {
      try {
        const round = collaborativePrivacyService.getRound(req.params.roundId);
        if (!round) {
          return res.status(404).json({ error: 'Round not found' });
        }
        res.json(round);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/collaborative/fidelity-bonds', (_req: Request, res: Response) => {
      try {
        const bonds = collaborativePrivacyService.listFidelityBonds();
        res.json(bonds);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/collaborative/public-packages/verify', (req: Request, res: Response) => {
      try {
        const result = collaborativePrivacyService.verifyPublicPackage(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new CollaborativePrivacyRoutes();
