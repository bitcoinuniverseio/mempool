import { Application, Request, Response } from 'express';
import { timeMachineService, TimeMachineUnavailableError } from './time-machine.service';
import { handleError } from '../../../utils/api';
import config from '../../../config';
import { HistoryParquetError, writeHistoryParquet } from './history-parquet';

let parquetExportPending = false;

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
      const timestamp = req.body?.timestamp_utc;
      const height = req.body?.block_height;
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
    let ownsParquetSlot = false;
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['state_hash', 'format'].includes(key)) || typeof body.state_hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.state_hash)) {
        res.status(400).json({ error: 'Supply a retained 64-character state hash and an export format.', code: 'invalid_export_request' });
        return;
      }
      const stateHash = body.state_hash;
      const format = body.format === undefined ? 'json' : body.format;
      if (format !== 'json' && format !== 'parquet') {
        res.status(400).json({ error: 'Supported export formats are json and parquet.', code: 'unsupported_format' });
        return;
      }
      const exported = timeMachineService.exportState(stateHash);
      if (!exported) {
        res.status(404).json({ error: 'State hash ' + stateHash + ' not found.' });
        return;
      }
      res.setHeader('cache-control', 'no-store');
      if (format === 'parquet') {
        if (parquetExportPending) {
          res.setHeader('retry-after', '1');
          res.status(429).json({ error: 'A bounded Parquet export is already running.', code: 'history-parquet-busy' });
          return;
        }
        parquetExportPending = true; ownsParquetSlot = true;
        const bytes = await writeHistoryParquet({ network: config.MEMPOOL.NETWORK, ...exported });
        if (req.aborted || res.destroyed) { return; }
        res.setHeader('content-type', 'application/vnd.apache.parquet');
        res.setHeader('content-length', String(bytes.length));
        res.setHeader('content-disposition', 'attachment; filename="mempool-state-' + stateHash.slice(0, 16) + '.parquet"');
        res.send(bytes);
        return;
      }
      res.setHeader('content-disposition', 'attachment; filename="mempool-state-' + stateHash.slice(0, 16) + '.json"');
      res.json({ format, exported_at: new Date().toISOString(), ...exported });
    } catch (e) {
      if (e instanceof HistoryParquetError) {
        const status = e.code === 'history-parquet-invalid-capture' ? 400 : e.code === 'history-parquet-limit' ? 413 : 503;
        res.status(status).json({ error: 'Retained Parquet export is invalid, exceeds its bound or is unavailable.', code: e.code });
      } else { handleError(req, res, 500, 'Failed to start retained export'); }
    } finally { if (ownsParquetSlot) { parquetExportPending = false; } }
  }
}

export default new TimeMachineRoutes();
