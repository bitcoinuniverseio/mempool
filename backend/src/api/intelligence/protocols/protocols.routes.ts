import { Application, Request, Response } from 'express';
import { protocolRegistryService } from './protocol-registry.service';
import { handleError } from '../../../utils/api';

class ProtocolsRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/protocols';

    app
      .get(prefix, this.$getProtocols)
      .post(prefix + '/decode', this.$postDecode)
      .get(prefix + '/:id/metrics', this.$getMetrics)
      .get(prefix + '/:id', this.$getProtocol);
  }

  private async $getProtocols(req: Request, res: Response): Promise<void> {
    try {
      const adapters = protocolRegistryService.getAdapters();
      res.json({ protocols: adapters, count: adapters.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch protocols');
    }
  }

  private async $getProtocol(req: Request, res: Response): Promise<void> {
    try {
      const adapter = protocolRegistryService.getAdapterById(req.params.id);
      if (!adapter) {
        res.status(404).json({ error: `Protocol '${req.params.id}' not found.` });
        return;
      }
      res.json(adapter);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch protocol');
    }
  }

  private async $postDecode(req: Request, res: Response): Promise<void> {
    try {
      const raw = String(req.body.script_hex || req.body.raw_payload || '');
      if (!raw) {
        res.status(400).json({ error: 'script_hex or raw_payload required.' });
        return;
      }
      const decoded = protocolRegistryService.decodePayload(raw);
      res.json({ decoded, count: decoded.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Protocol decoding failed');
    }
  }

  private async $getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = protocolRegistryService.getMetrics(req.params.id);
      res.json(metrics);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch protocol metrics');
    }
  }
}

export default new ProtocolsRoutes();
