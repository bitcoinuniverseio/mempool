import { Application, Request, Response } from 'express';
import { timeMachineService } from './time-machine.service';
import { handleError } from '../../../utils/api';

class TimeMachineRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/history/';

    app
      .get(prefix + 'coverage', this.$getCoverage)
      .post(prefix + 'replays', this.$postReplay)
      .get(prefix + 'replays/:id', this.$getReplay)
      .get(prefix + 'states/:stateHash', this.$getState)
      .get(prefix + 'transactions/:txid/lifecycle', this.$getTxLifecycle)
      .get(prefix + 'compare', this.$getCompare)
      .post(prefix + 'exports', this.$postExport);
  }

  private async $getCoverage(req: Request, res: Response): Promise<void> {
    try {
      const cov = timeMachineService.getCoverage();
      res.json(cov);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch coverage');
    }
  }

  private async $postReplay(req: Request, res: Response): Promise<void> {
    try {
      const timestamp = req.body.timestamp_utc;
      const height = req.body.block_height !== undefined ? parseInt(req.body.block_height, 10) : undefined;
      const state = timeMachineService.replayToTimestampOrHeight(timestamp, height);
      res.json(state);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Replay calculation failed');
    }
  }

  private async $getReplay(req: Request, res: Response): Promise<void> {
    try {
      const state = timeMachineService.getStateByHash(req.params.id);
      if (!state) {
        res.status(404).json({ error: `Replay state '${req.params.id}' not found.` });
        return;
      }
      res.json(state);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to get replay');
    }
  }

  private async $getState(req: Request, res: Response): Promise<void> {
    try {
      const state = timeMachineService.getStateByHash(req.params.stateHash);
      if (!state) {
        res.status(404).json({ error: `State hash '${req.params.stateHash}' not found.` });
        return;
      }
      res.json(state);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to get state');
    }
  }

  private async $getTxLifecycle(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      const lifecycle = timeMachineService.getTransactionLifecycle(txid);
      res.json({ txid, events: lifecycle, count: lifecycle.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to get transaction lifecycle');
    }
  }

  private async $getCompare(req: Request, res: Response): Promise<void> {
    try {
      const hashA = String(req.query.state_a || '');
      const hashB = String(req.query.state_b || '');
      const comparison = timeMachineService.compareStates(hashA, hashB);
      res.json(comparison);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to compare states');
    }
  }

  private async $postExport(req: Request, res: Response): Promise<void> {
    try {
      const stateHash = req.body.state_hash || '';
      const format = req.body.format || 'json';
      const job = timeMachineService.startExportJob(stateHash, format);
      res.json(job);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to start export');
    }
  }
}

export default new TimeMachineRoutes();
