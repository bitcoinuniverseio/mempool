import { Application, Request, Response } from 'express';
import { timeMachineService, TimeMachineUnavailableError } from './time-machine.service';
import { handleError } from '../../../utils/api';

/** Outside the observed window is a 503 or 404 that says so, never an invented state. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof TimeMachineUnavailableError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

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
      fail(req, res, e, 'Replay calculation failed');
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
      if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
        res.status(400).json({ error: 'txid must be 64 hex characters.' });
        return;
      }
      const lifecycle = timeMachineService.getTransactionLifecycle(txid);
      if (lifecycle.length === 0) {
        res.status(404).json({ error: 'This backend observed no mempool event for ' + txid + ' since it started.', observing_since_utc: timeMachineService.getCoverage().observing_since_utc });
        return;
      }
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
      if (!comparison) {
        res.status(404).json({ error: 'Both state_a and state_b must be state hashes this backend produced.' });
        return;
      }
      res.json(comparison);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to compare states');
    }
  }

  private async $postExport(req: Request, res: Response): Promise<void> {
    try {
      const stateHash = String(req.body?.state_hash || '');
      const format = String(req.body?.format || 'json');
      if (format !== 'json') {
        res.status(400).json({ error: 'Only json export is available.', code: 'unsupported_format' });
        return;
      }
      const exported = timeMachineService.exportState(stateHash);
      if (!exported) {
        res.status(404).json({ error: 'State hash ' + stateHash + ' not found.' });
        return;
      }
      res.setHeader('content-disposition', 'attachment; filename="mempool-state-' + stateHash.slice(0, 16) + '.json"');
      res.json({ format, exported_at: new Date().toISOString(), ...exported });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to start export');
    }
  }
}

export default new TimeMachineRoutes();
