import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { stratumV2Service } from './stratum-v2.service';

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
      handleError(res, e);
    }
  }

  private async $getTemplates(req: Request, res: Response): Promise<void> {
    try {
      const templates = await stratumV2Service.$getTemplates();
      res.json({ templates, total: templates.length });
    } catch (e) {
      handleError(res, e);
    }
  }

  private async $getDeclarations(req: Request, res: Response): Promise<void> {
    try {
      const declarations = await stratumV2Service.$getDeclarations();
      res.json({ declarations, total: declarations.length });
    } catch (e) {
      handleError(res, e);
    }
  }
}

export default new StratumV2Routes();
