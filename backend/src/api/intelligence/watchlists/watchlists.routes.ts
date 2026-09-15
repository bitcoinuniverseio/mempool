import { Application, Request, Response } from 'express';
import { watchlistsService } from './watchlists.service';
import { ownerOf, requireOwner, sendIdentityError } from '../identity/owner-auth';

/**
 * Every watchlist route needs an owner key with the watchlists scope. The
 * owner comes from the key; the routes never read a user_id.
 */
class WatchlistsRoutes {
  public initRoutes(app: Application): void {
    const prefix = '/api/v1/intelligence/watchlists';
    const guard = requireOwner('watchlists');

    app
      .post(prefix, guard, this.$postWatchlist)
      .get(prefix, guard, this.$getWatchlists)
      .get(prefix + '/notifications', guard, this.$getAllNotifications)
      .post(prefix + '/notifications/:notifId/ack', guard, this.$postAckNotification)
      .get(prefix + '/:id', guard, this.$getWatchlist)
      .delete(prefix + '/:id', guard, this.$deleteWatchlist)
      .post(prefix + '/:id/entities', guard, this.$postEntity)
      .post(prefix + '/:id/rules', guard, this.$postRule)
      .delete(prefix + '/:id/entities/:entityId', guard, this.$deleteEntity)
      .delete(prefix + '/:id/rules/:ruleId', guard, this.$deleteRule)
      .get(prefix + '/:id/notifications', guard, this.$getNotifications);
  }

  private notFound(res: Response, id: string): void {
    res.status(404).json({ error: `Watchlist '${id}' not found.` });
  }

  private async $postWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const { name, privacy_mode } = req.body ?? {};
      res.status(201).json(await watchlistsService.createWatchlist(ownerOf(res), name, privacy_mode ?? 'blinded'));
    } catch (e) {
      sendIdentityError(res, e, 'Failed to create watchlist');
    }
  }

  private async $getWatchlists(req: Request, res: Response): Promise<void> {
    try {
      const list = await watchlistsService.getWatchlists(ownerOf(res));
      res.json({ watchlists: list, count: list.length });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch watchlists');
    }
  }

  private async $getWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const wl = await watchlistsService.getWatchlistById(ownerOf(res), req.params.id);
      if (!wl) { res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` }); return; }
      res.json(wl);
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch watchlist');
    }
  }

  private async $deleteWatchlist(req: Request, res: Response): Promise<void> {
    try {
      const deleted = await watchlistsService.deleteWatchlist(ownerOf(res), req.params.id);
      if (!deleted) { res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` }); return; }
      res.json({ deleted: true });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to delete watchlist');
    }
  }

  private async $deleteEntity(req: Request, res: Response): Promise<void> {
    try {
      const deleted = await watchlistsService.deleteEntity(ownerOf(res), req.params.id, req.params.entityId);
      if (!deleted) { res.status(404).json({ error: `Entity '${req.params.entityId}' not found in watchlist '${req.params.id}'.` }); return; }
      res.json({ deleted: true });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to delete entity');
    }
  }

  private async $deleteRule(req: Request, res: Response): Promise<void> {
    try {
      const deleted = await watchlistsService.deleteRule(ownerOf(res), req.params.id, req.params.ruleId);
      if (!deleted) { res.status(404).json({ error: `Rule '${req.params.ruleId}' not found in watchlist '${req.params.id}'.` }); return; }
      res.json({ deleted: true });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to delete rule');
    }
  }

  private async $postEntity(req: Request, res: Response): Promise<void> {
    try {
      const { entity_type, entity_raw_or_blinded, label, blinded } = req.body ?? {};
      const entity = await watchlistsService.addEntity(ownerOf(res), req.params.id, entity_type, entity_raw_or_blinded, label, blinded === true);
      if (!entity) { res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` }); return; }
      res.status(201).json(entity);
    } catch (e) {
      sendIdentityError(res, e, 'Failed to add entity');
    }
  }

  private async $postRule(req: Request, res: Response): Promise<void> {
    try {
      const { condition_type, delivery_channel, threshold_value, webhook_id } = req.body ?? {};
      const rule = await watchlistsService.addRule(ownerOf(res), req.params.id, condition_type, delivery_channel, threshold_value, webhook_id);
      if (!rule) { res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` }); return; }
      res.status(201).json(rule);
    } catch (e) {
      sendIdentityError(res, e, 'Failed to add rule');
    }
  }

  private async $getNotifications(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 100;
      const notifications = await watchlistsService.getNotifications(ownerOf(res), req.params.id, Number.isFinite(limit) ? limit : 100);
      if (!notifications) { res.status(404).json({ error: `Watchlist '${req.params.id}' not found.` }); return; }
      res.json({ notifications, count: notifications.length });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch notifications');
    }
  }

  private async $getAllNotifications(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit !== undefined ? parseInt(String(req.query.limit), 10) : 100;
      const notifications = await watchlistsService.getNotifications(ownerOf(res), null, Number.isFinite(limit) ? limit : 100);
      res.json({ notifications: notifications ?? [], count: notifications?.length ?? 0 });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to fetch notifications');
    }
  }

  private async $postAckNotification(req: Request, res: Response): Promise<void> {
    try {
      const acked = await watchlistsService.acknowledgeNotification(ownerOf(res), req.params.notifId);
      if (!acked) { res.status(404).json({ error: 'Notification not found or already acknowledged.' }); return; }
      res.json({ acknowledged: true });
    } catch (e) {
      sendIdentityError(res, e, 'Failed to ack notification');
    }
  }
}

export default new WatchlistsRoutes();
