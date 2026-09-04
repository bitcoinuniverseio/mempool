import { Application, Request, Response } from 'express';
import bitcoinStakingService from './bitcoin-staking.service';
import { StakingDelegationState } from './bitcoin-staking.models';

class BitcoinStakingRoutes {
  public initRoutes(app: Application): void {
    app.get('/api/v1/intelligence/bitcoin-staking/overview', (req: Request, res: Response) => {
      try {
        const overview = bitcoinStakingService.getOverview();
        res.json(overview);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/parameters', (req: Request, res: Response) => {
      try {
        const params = bitcoinStakingService.getParameters();
        res.json(params);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/parameters/:versionId', (req: Request, res: Response) => {
      try {
        const param = bitcoinStakingService.getParameter(req.params.versionId);
        if (!param) {
          return res.status(404).json({ error: 'Parameter version not found' });
        }
        res.json(param);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/delegations', (req: Request, res: Response) => {
      try {
        const stateFilter = req.query.state as StakingDelegationState | undefined;
        const delegations = bitcoinStakingService.listDelegations(stateFilter);
        res.json(delegations);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/delegation/:delegationId', (req: Request, res: Response) => {
      try {
        const del = bitcoinStakingService.getDelegation(req.params.delegationId);
        if (!del) {
          return res.status(404).json({ error: 'Delegation not found' });
        }
        res.json(del);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/finality-providers', (req: Request, res: Response) => {
      try {
        const providers = bitcoinStakingService.listFinalityProviders();
        res.json(providers);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/finality-provider/:providerId', (req: Request, res: Response) => {
      try {
        const fp = bitcoinStakingService.getFinalityProvider(req.params.providerId);
        if (!fp) {
          return res.status(404).json({ error: 'Finality provider not found' });
        }
        res.json(fp);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.get('/api/v1/intelligence/bitcoin-staking/evidence', (req: Request, res: Response) => {
      try {
        const evidence = bitcoinStakingService.listEvidence();
        res.json(evidence);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/bitcoin-staking/verify-transaction', (req: Request, res: Response) => {
      try {
        const result = bitcoinStakingService.verifyTransaction(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/bitcoin-staking/verify-evidence', (req: Request, res: Response) => {
      try {
        const result = bitcoinStakingService.verifySlashingEvidence(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });

    app.post('/api/v1/intelligence/bitcoin-staking/reconcile', (req: Request, res: Response) => {
      try {
        const result = bitcoinStakingService.reconcileWithConsumerPoS(req.body.chain_name);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message || 'Internal error' });
      }
    });
  }
}

export default new BitcoinStakingRoutes();
