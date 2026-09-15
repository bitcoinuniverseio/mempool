import { Application, Request, Response } from 'express';
import { protocolRegistryService, ProtocolDecodeError } from './protocol-registry.service';
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
      // Only a string body field is accepted; numbers, arrays and objects are
      // rejected instead of being coerced into something that looks like hex.
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const raw = body.script_hex ?? body.raw_payload;
      if (raw === undefined || raw === null || raw === '') {
        res.status(400).json({ error: 'script_hex or raw_payload required.', code: 'invalid_input' });
        return;
      }
      const decoded = protocolRegistryService.decodePayload(raw);
      res.json({ decoded, count: decoded.length, input_format: 'hex' });
    } catch (e) {
      if (e instanceof ProtocolDecodeError) {
        res.status(400).json({ error: e.message, code: e.code });
        return;
      }
      handleError(req, res, 500, e instanceof Error ? e.message : 'Protocol decoding failed');
    }
  }

  private async $getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const result = protocolRegistryService.getMetrics(req.params.id);
      if (result === null) {
        res.status(404).json({ error: `Protocol '${req.params.id}' not found.` });
        return;
      }
      if ('unavailable' in result) {
        res.status(503).json({ error: result.unavailable, code: 'metrics_unavailable', protocol_id: req.params.id });
        return;
      }
      res.json(result.metrics);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch protocol metrics');
    }
  }
}

export default new ProtocolsRoutes();
