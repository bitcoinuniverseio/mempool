import { Application, Request, Response } from 'express';
import { globalNetworkService, GlobalNetworkUnavailableError } from './global-network.service';
import { handleError } from '../../../utils/api';

/** An unreachable node is a 503 that says so, never an invented network. */
function fail(req: Request, res: Response, e: unknown, fallback: string): void {
  if (e instanceof GlobalNetworkUnavailableError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : fallback);
}

class GlobalNetworkRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/network/';

    app
      .get(prefix + 'overview', this.$getOverview)
      .get(prefix + 'nodes', this.$getNodes)
      .get(prefix + 'nodes/:endpointId', this.$getNodeByEndpoint)
      .get(prefix + 'seeds', this.$getDnsSeeds)
      .get(prefix + 'snapshots', this.$getSnapshots)
      .get(prefix + 'sensors', this.$getSensors)
      .post(prefix + 'self-checks', this.$postSelfCheck);
  }

  private async $getOverview(req: Request, res: Response): Promise<void> {
    try {
      res.json(await globalNetworkService.getOverview());
    } catch (e) {
      fail(req, res, e, 'Failed to fetch network overview');
    }
  }

  private async $getNodes(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(String(req.query.limit)) || 50;
      const offset = parseInt(String(req.query.offset)) || 0;
      res.json(await globalNetworkService.getNodes(limit, offset));
    } catch (e) {
      fail(req, res, e, 'Failed to fetch nodes');
    }
  }

  private async $getNodeByEndpoint(req: Request, res: Response): Promise<void> {
    try {
      const node = await globalNetworkService.getNodeByEndpoint(req.params.endpointId);
      if (!node) {
        res.status(404).json({ error: 'Node endpoint not found among the current peers' });
        return;
      }
      res.json(node);
    } catch (e) {
      fail(req, res, e, 'Failed to fetch node');
    }
  }

  private async $getDnsSeeds(req: Request, res: Response): Promise<void> {
    try {
      const seeds = await globalNetworkService.getDnsSeeds();
      res.json({ seeds, total: seeds.length });
    } catch (e) {
      fail(req, res, e, 'Failed to fetch DNS seeds');
    }
  }

  private async $getSnapshots(req: Request, res: Response): Promise<void> {
    try {
      const snapshots = globalNetworkService.getSnapshots();
      res.json({ snapshots, total: snapshots.length });
    } catch (e) {
      fail(req, res, e, 'Failed to fetch snapshots');
    }
  }

  private async $getSensors(req: Request, res: Response): Promise<void> {
    try {
      const sensors = await globalNetworkService.getSensors();
      res.json({ sensors, total: sensors.length });
    } catch (e) {
      fail(req, res, e, 'Failed to fetch sensors');
    }
  }

  private async $postSelfCheck(req: Request, res: Response): Promise<void> {
    try {
      const result = await globalNetworkService.performSelfCheck({
        endpoint_address: String(req.body?.endpoint_address ?? ''),
        port: parseInt(String(req.body?.port)) || 8333,
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to perform self check' });
    }
  }
}

export default new GlobalNetworkRoutes();
