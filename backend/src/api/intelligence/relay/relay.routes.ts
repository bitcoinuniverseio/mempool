import { Application, Request, Response } from 'express';
import { relayCollectorService } from './relay-collector.service';
import { handleError } from '../../../utils/api';
import { eventBus } from '../events/intelligence-event-bus';

class RelayRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/relay/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'transactions/:txid', this.$getTransactionRelay)
      .get(prefix + 'sensors', this.$getSensors)
      .get(prefix + 'policy-differences', this.$getPolicyDifferences)
      .get(prefix + 'transports', this.$getTransports)
      .get(prefix + 'stream', this.$getRelayStream);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      const overview = relayCollectorService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch relay overview');
    }
  }

  private async $getTransactionRelay(req: Request, res: Response): Promise<void> {
    try {
      const txid = req.params.txid;
      const relay = relayCollectorService.getPropagationForTx(txid);
      res.json(relay);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch transaction relay');
    }
  }

  private async $getSensors(req: Request, res: Response): Promise<void> {
    try {
      const sensors = relayCollectorService.getSensors();
      res.json({ sensors, total: sensors.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch sensors');
    }
  }

  private async $getPolicyDifferences(req: Request, res: Response): Promise<void> {
    try {
      const diffs = relayCollectorService.getPolicyDifferences();
      res.json({ differences: diffs, total: diffs.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch policy differences');
    }
  }

  private async $getTransports(req: Request, res: Response): Promise<void> {
    try {
      const metrics = relayCollectorService.getTransportMetrics();
      res.json(metrics);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch transport metrics');
    }
  }

  private async $getRelayStream(req: Request, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = eventBus.subscribe('btc.*.relay.*', (envelope) => {
      res.write(`event: intelligence.relay.transaction\ndata: ${JSON.stringify(envelope)}\n\n`);
    });

    const keepAliveTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      unsubscribe();
    });
  }
}

export default new RelayRoutes();
