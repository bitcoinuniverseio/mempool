import { Application, Request, Response } from 'express';
import { watchlistsService } from './watchlists.service';
import { handleError } from '../../../utils/api';

class WatchlistsRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/watchlists';

    app
      .post(prefix, this.$postWatchlist)
      .get(prefix, this.$getWatchlists)
      .get(prefix + '/:id', this.$getWatchlist)
      .delete(prefix + '/:id', this.$deleteWatchlist)
      .post(prefix + '/:id/entities', this.$postEntity)
      .post(prefix + '/:id/rules', this.$postRule)
      .get(prefix + '/:id/notifications', this.$getNotifications)
      .post(prefix + '/notifications/:notifId/ack', this.$postAckNotification);
  }

  private async $postWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, name, privacy_mode } = req.body;
      if (!name) {
        res.status(400).json({ error: 'name parameter required.' });
        return;
      }
      const wl = watchlistsService.createWatchlist(
        user_id || 'user-default',
        name,
        privacy_mode || 'blinded'
      );
      res.json(wl);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to create watchlist');
    }
  }

  private async $getWatchlists(req: Request, res: Response): Promise<void> {
    try {
      const userId = String(req.query.user_id || 'user-default');
      const list = watchlistsService.getWatchlists(userId);
      res.json({ watchlists: list, count: list.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch watchlists');
    }
  }

  private async $getWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const wl = watchlistsService.getWatchlistById(req.params.id);
      if (!wl) {
        res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` });
        return;
      }
      res.json(wl);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch watchlist');
    }
  }

  private async $deleteWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const deleted = watchlistsService.deleteWatchlist(req.params.id);
      res.json({ deleted });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to delete watchlist');
    }
  }

  private async $postEntity(req: Request, res: Response): Promise<void> {
    try {
      const { entity_type, entity_raw_or_blinded, label } = req.body;
      if (!entity_type || !entity_raw_or_blinded) {
        res.status(400).json({ error: 'entity_type and entity_raw_or_blinded required.' });
        return;
      }
      const entity = watchlistsService.addEntity(
        req.params.id,
        entity_type,
        entity_raw_or_blinded,
        label || 'Monitored Item'
      );
      if (!entity) {
        res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` });
        return;
      }
      res.json(entity);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to add entity');
    }
  }

  private async $postRule(req: Request, res: Response): Promise<void> {
    try {
      const { condition_type, delivery_channel, threshold_value, webhook_url } = req.body;
      if (!condition_type || !delivery_channel) {
        res.status(400).json({ error: 'condition_type and delivery_channel required.' });
        return;
      }
      const rule = watchlistsService.addRule(
        req.params.id,
        condition_type,
        delivery_channel,
        threshold_value,
        webhook_url
      );
      if (!rule) {
        res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` });
        return;
      }
      res.json(rule);
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to add rule');
    }
  }

  private async $getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const notifs = watchlistsService.getNotifications(req.params.id);
      res.json({ notifications: notifs, count: notifs.length });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to fetch notifications');
    }
  }

  private async $postAckNotification(req: Request, res: Response): Promise<void> {
    try {
      const acked = watchlistsService.acknowledgeNotification(req.params.notifId);
      res.json({ acknowledged: acked });
    } catch (e) {
      handleError(req, res, 500, e instanceof Error ? e.message : 'Failed to ack notification');
    }
  }
}

export default new WatchlistsRoutes();
