import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { StratumV2EvidenceError, stratumV2Service } from './stratum-v2.service';

/** An absent source is a 503 that names the source, never a 500 and never an empty list. */
function fail(req: Request, res: Response, e: unknown): void {
  if (e instanceof StratumV2EvidenceError) {
    res.status(e.status).json({ stage: e.code, error: e.message });
    return;
  }
  handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
}

class StratumV2Routes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'stratum-v2/';

    app
      .get(prefix + 'network', this.$getNetwork)
      .get(prefix + 'templates', this.$getTemplates)
      .get(prefix + 'declarations', this.$getDeclarations);
  }

  private async $getNetwork(req: Request, res: Response): Promise<void> {
    try {
      const roles = await stratumV2Service.$getRoles();
      res.json({ roles, total: roles.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = await stratumV2Service.$getTemplates();
      res.json({ templates, total: templates.length });
    } catch (e) {
      fail(req, res, e);
    }
  }

  private async $getDeclarations(req: Request, res: Response): Promise<void> {
    try {
      const declarations = await stratumV2Service.$getDeclarations();
      res.json({ declarations, total: declarations.length });
    } catch (e) {
      fail(req, res, e);
    }
  }
}

export default new StratumV2Routes();
