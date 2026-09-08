import { Application, Request, Response } from 'express';
import collaborativePrivacyService, { CollaborativeEvidenceError } from './collaborative-privacy.service';

/** An absent source is a 503 that names the source, never a 500 and never an answer. */
function fail(res: Response, err: unknown): Response {
  if (err instanceof CollaborativeEvidenceError) return res.status(err.status).json({ stage: err.code, error: err.message });
  return res.status(500).json({ error: err instanceof Error && err.message ? err.message : 'Internal error' });
}

class CollaborativePrivacyRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/collaborative/overview', (_req: Request, res: Response) => {
      try {
        const overview = collaborativePrivacyService.getOverview();
        res.json(overview);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/collaborative/protocols', (_req: Request, res: Response) => {
      try {
        const protocols = collaborativePrivacyService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/collaborative/coordinators', (_req: Request, res: Response) => {
      try {
        const coordinators = collaborativePrivacyService.listCoordinators();
        res.json(coordinators);
      } catch (err: any) {
        fail(res, err);
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
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/collaborative/rounds', (_req: Request, res: Response) => {
      try {
        const rounds = collaborativePrivacyService.listRounds();
        res.json(rounds);
      } catch (err: any) {
        fail(res, err);
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
        fail(res, err);
      }
    });

    app.get('/api/v1/intelligence/collaborative/fidelity-bonds', (_req: Request, res: Response) => {
      try {
        const bonds = collaborativePrivacyService.listFidelityBonds();
        res.json(bonds);
      } catch (err: any) {
        fail(res, err);
      }
    });

    app.post('/api/v1/intelligence/collaborative/public-packages/verify', (req: Request, res: Response) => {
      try {
        const result = collaborativePrivacyService.verifyPublicPackage(req.body);
        res.status(result.stage === 'invalid-input' ? 400 : 503).json(result);
      } catch (err: any) {
        fail(res, err);
      }
    });
  }
}

export default new CollaborativePrivacyRoutes();
