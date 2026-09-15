import { Application, Request, Response } from 'express';
import offchainService, { OffchainRegistryError } from './offchain.service';
import { OffchainVerificationError } from './package-verifier';

class OffchainRoutes {
  public initRoutes(app: Application): void {
    for (const kind of ['statechain', 'coinswap'] as const) {
      app.post(`/api/v1/intelligence/offchain/${kind}/verify`, async (req: Request, res: Response) => {
        try { res.json(await (kind === 'statechain' ? offchainService.verifyTransferPackage(req.body) : offchainService.verifyCoinswapPackage(req.body))); }
        catch (error) {
          const known = error instanceof OffchainVerificationError;
          res.status(known ? error.status : (error as any).status || 503).json({ is_valid: false, code: known ? error.code : 'verification-unavailable', error: known ? error.message : 'The independent transaction verifier is unavailable.' });
        }
      });
    }
    app.get('/api/v1/intelligence/offchain/overview', (req: Request, res: Response) => {
      try {
        const overview = offchainService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.get('/api/v1/intelligence/offchain/protocols', (req: Request, res: Response) => {
      try {
        const protocols = offchainService.listProtocols();
        res.json(protocols);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.get('/api/v1/intelligence/offchain/operators', (req: Request, res: Response) => {
      try {
        const operators = offchainService.listOperators();
        res.json(operators);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.get('/api/v1/intelligence/offchain/operators/:operatorId', (req: Request, res: Response) => {
      try {
        const operator = offchainService.getOperator(req.params.operatorId);
        if (!operator) {
          return res.status(404).json({ error: 'Operator not found' });
        }
        res.json(operator);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.get('/api/v1/intelligence/offchain/operators/:operatorId/history', (req: Request, res: Response) => {
      try {
        const history = offchainService.getOperatorHistory(req.params.operatorId);
        res.json(history);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.get('/api/v1/intelligence/offchain/offers', (req: Request, res: Response) => {
      try {
        const offers = offchainService.listOffers();
        res.json(offers);
      } catch (err: any) {
        res.status(err instanceof OffchainRegistryError ? err.status : 503).json({ stage: err instanceof OffchainRegistryError ? err.code : 'source-unavailable', error: err instanceof OffchainRegistryError ? err.message : 'Offchain evidence is unavailable.' });
      }
    });

    app.post('/api/v1/intelligence/offchain/manifests/verify', (req: Request, res: Response) => {
      try {
        const result = offchainService.verifyManifest(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Manifest verification failed' });
      }
    });

    app.post('/api/v1/intelligence/offchain/recovery/context', (req: Request, res: Response) => {
      try {
        const plan = offchainService.generateRecoveryPlan(req.body);
        res.json(plan);
      } catch (err: any) {
        res.status(400).json({ error: err.message || 'Recovery context generation failed' });
      }
    });
  }
}

export default new OffchainRoutes();
