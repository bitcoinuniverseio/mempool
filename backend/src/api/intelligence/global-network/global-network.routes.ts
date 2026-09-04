import { Application, Request, Response } from 'express';
import { globalNetworkService } from './global-network.service';
import { handleError } from '../../../utils/api';

class GlobalNetworkRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/network/global/';

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
      const overview = globalNetworkService.getOverview();
      res.json(overview);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch global network overview');
    }
  }

  private async $getNodes(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const result = globalNetworkService.getNodes(limit, offset);
      res.json(result);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch global network nodes');
    }
  }

  private async $getNodeByEndpoint(req: Request, res: Response): Promise<void> {
    try {
      const endpointId = req.params.endpointId;
      const node = globalNetworkService.getNodeByEndpoint(endpointId);
      if (!node) {
        res.status(404).json({ error: 'Node endpoint not found' });
        return;
      }
      res.json(node);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch node detail');
    }
  }

  private async $getDnsSeeds(req: Request, res: Response): Promise<void> {
    try {
      const seeds = globalNetworkService.getDnsSeeds();
      res.json(seeds);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch DNS seeds');
    }
  }

  private async $getSnapshots(req: Request, res: Response): Promise<void> {
    try {
      const snapshots = globalNetworkService.getSnapshots();
      res.json(snapshots);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch network snapshots');
    }
  }

  private async $getSensors(req: Request, res: Response): Promise<void> {
    try {
      const sensors = globalNetworkService.getSensors();
      res.json(sensors);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch network sensors');
    }
  }

  private async $postSelfCheck(req: Request, res: Response): Promise<void> {
    try {
      const { endpoint_address, port } = req.body;
      const result = globalNetworkService.performSelfCheck({
        endpoint_address,
        port: Number(port),
      });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to perform self check' });
    }
  }
}

export default new GlobalNetworkRoutes();
