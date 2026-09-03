import { Application, Request, Response } from 'express';
import config from '../../config';
import { handleError } from '../../utils/api';
import { wildkinService } from './wildkin.service';

class WildkinRoutes {
  public initRoutes(app: Application): void {
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'wildkin/';

    app
      .get(prefix + 'status', this.$getStatus)
      .get(prefix + 'creatures', this.$getCreatures)
      .get(prefix + 'creatures/:id', this.$getCreature)
      .get(prefix + 'braids', this.$getBraids);
  }

  private async $getStatus(req: Request, res: Response): Promise<void> {
    try {
      const status = await wildkinService.$getStatus();
      res.json(status);
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getCreatures(req: Request, res: Response): Promise<void> {
    try {
      const creatures = await wildkinService.$getCreatures();
      res.json({ creatures, total: creatures.length });
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getCreature(req: Request, res: Response): Promise<void> {
    try {
      const creature = await wildkinService.$getCreature(req.params.id);
      if (!creature) {
        res.status(404).json({ error: 'wildkin-creature-not-found' });
        return;
      }
      res.json(creature);
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }

  private async $getBraids(req: Request, res: Response): Promise<void> {
    try {
      const braids = await wildkinService.$getBraids();
      res.json({ braids, total: braids.length });
    } catch (e) {
        handleError(req, res, 500, e instanceof Error ? e.message : 'The request could not be served');
    }
  }
}

export default new WildkinRoutes();
