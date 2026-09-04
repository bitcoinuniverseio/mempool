import { watchlistsService } from './watchlists.service';

describe('Product 10: Privacy-First Watchlists, Rules, and Alerts', () => {
  const userId = 'user-privacy-01';

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

  it('manages notifications and handles acknowledgement', () => {
    const notifs = watchlistsService.getNotifications();
    expect(notifs.length).toBeGreaterThan(0);

    const first = notifs[0];
    const initialAck = first.acknowledged;

    const acked = watchlistsService.acknowledgeNotification(first.notification_id);
    expect(acked).toBe(true);

    const updated = watchlistsService.getNotifications().find((n) => n.notification_id === first.notification_id);
    expect(updated?.acknowledged).toBe(true);
  });

  it('supports watchlist deletion and cleans up references', () => {
    const tempWl = watchlistsService.createWatchlist(userId, 'Temporary Monitor');
    expect(watchlistsService.getWatchlistById(tempWl.watchlist_id)).not.toBeNull();

    const deleted = watchlistsService.deleteWatchlist(tempWl.watchlist_id);
    expect(deleted).toBe(true);
    expect(watchlistsService.getWatchlistById(tempWl.watchlist_id)).toBeNull();
  });
});
