import { Application, Request, Response } from 'express';
import watchlistsRoutes from './watchlists.routes';
import { WatchlistsEvidenceError, watchlistsService } from './watchlists.service';

/**
 * The notification assertions replace ones that asserted a seeded alert about
 * a 2,500,000 satoshi transfer nobody observed. Watchlists themselves hold
 * what callers submit, so those assertions stay, minus the seeded sample.
 */
describe('Product 10: Privacy-First Watchlists, Rules, and Alerts', () => {
  const userId = 'user-privacy-01';

  it('starts with no watchlists that nobody created', () => {
    expect(watchlistsService.getWatchlists('user-default')).toEqual([]);
    expect(watchlistsService.getWatchlistById('wl-sample-01')).toBeNull();
  });

  it('creates privacy-first blinded watchlists and hashes sensitive entities', () => {
    const wl = watchlistsService.createWatchlist(userId, 'Cold Multisig Watchlist', 'blinded');
    expect(wl.watchlist_id).toBeDefined();
    expect(wl.privacy_mode).toBe('blinded');

    const rawAddress = 'bc1q751e76e8199196d454941c45d1b3a323f1433bd6';
    const entity = watchlistsService.addEntity(wl.watchlist_id, 'address', rawAddress, 'Multisig Key 1');

    expect(entity).not.toBeNull();
    expect(entity?.blinded_hash).toHaveLength(64);
    // Blinded hash must not equal raw address string
    expect(entity?.blinded_hash).not.toBe(rawAddress);
  });

  it('attaches configurable notification rules to watchlists', () => {
    const watchlists = watchlistsService.getWatchlists(userId);
    const wlId = watchlists[0].watchlist_id;

    const rule = watchlistsService.addRule(
      wlId,
      'value_transfer',
      'in_app',
      5000000 // 0.05 BTC in sats
    );

    expect(rule).not.toBeNull();
    expect(rule?.watchlist_id).toBe(wlId);
    expect(rule?.condition_type).toBe('value_transfer');
    expect(rule?.threshold_value).toBe(5000000);
    expect(rule?.rate_limit_per_hour).toBeGreaterThan(0);
  });

  it('reports the missing matcher rather than a seeded alert', () => {
    const unavailable = expect.objectContaining({ code: 'unavailable-watchlist-matcher', status: 503 });
    expect(() => watchlistsService.getNotifications()).toThrow(unavailable);
    expect(() => watchlistsService.getNotifications('wl-sample-01')).toThrow(unavailable);
    expect(() => watchlistsService.acknowledgeNotification('notif-sample-01')).toThrow(unavailable);
  });

  it('never resolves an absent matcher as an empty inbox', () => {
    let resolved: unknown = 'unresolved';
    try {
      resolved = watchlistsService.getNotifications();
    } catch (e) {
      expect(e).toBeInstanceOf(WatchlistsEvidenceError);
      return;
    }
    throw new Error(`resolved with ${JSON.stringify(resolved)}`);
  });

  it('supports watchlist deletion and cleans up references', () => {
    const tempWl = watchlistsService.createWatchlist(userId, 'Temporary Monitor');
    expect(watchlistsService.getWatchlistById(tempWl.watchlist_id)).not.toBeNull();

    const deleted = watchlistsService.deleteWatchlist(tempWl.watchlist_id);
    expect(deleted).toBe(true);
    expect(watchlistsService.getWatchlistById(tempWl.watchlist_id)).toBeNull();
  });
});

describe('Watchlist HTTP responses', () => {
  type Handler = (req: Request, res: Response) => Promise<void>;

  function mount(): { gets: Map<string, Handler>; posts: Map<string, Handler> } {
    const gets = new Map<string, Handler>();
    const posts = new Map<string, Handler>();
    const app = {
      get: jest.fn((path: string, callback: Handler) => { gets.set(path, callback); return app; }),
      post: jest.fn((path: string, callback: Handler) => { posts.set(path, callback); return app; }),
      delete: jest.fn(() => app),
    };
    watchlistsRoutes.initRoutes(app as unknown as Application);
    return { gets, posts };
  }

  it('answers the notification reads with a 503 that names the missing matcher', async () => {
    const { gets, posts } = mount();
    for (const handler of [
      gets.get('/api/v1/intelligence/watchlists/:id/notifications')!,
      posts.get('/api/v1/intelligence/watchlists/notifications/:notifId/ack')!,
    ]) {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await handler({ params: { id: 'wl-1', notifId: 'n-1' } } as unknown as Request, res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.stage).toBe('unavailable-watchlist-matcher');
      expect(body).not.toHaveProperty('notifications');
    }
  });
});
