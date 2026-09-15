import * as crypto from 'crypto';
import { Application, Request, Response } from 'express';
import watchlistsRoutes from './watchlists.routes';
import { blind, watchlistsService } from './watchlists.service';
import { WatchlistMatcher } from './watchlist-matcher';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, ownerStore, useOwnerStore } from '../identity/owner-store';
import config from '../../../config';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';

/**
 * Two owners on one store: every assertion about isolation is made by
 * trying the other owner's key against a resource and expecting nothing.
 * The matcher is fed synthetic blocks whose transactions carry real-looking
 * txids and addresses; findings are compared against SHA-256 blinding.
 */
const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

async function owner(name: string, address: string): Promise<AuthenticatedOwner> {
  const key = await developerIdentity.bootstrapOwner(name, address);
  return (await developerIdentity.authenticateKey(key.secret_key))!;
}

const block = (height: number, id: string, medianFee: number, timestamp = 1_000_000 + height): BlockExtended =>
  ({ height, id, timestamp, weight: 4000, extras: { medianFee, totalFees: 10 } } as unknown as BlockExtended);

const tx = (txid: string, vout: { address: string; value: number }[], vin: { address: string; value: number }[] = []): TransactionExtended =>
  ({ txid, weight: 400, fee: 10, vout: vout.map(v => ({ scriptpubkey_address: v.address, value: v.value, scriptpubkey_type: 'v0_p2wpkh' })), vin: vin.map(v => ({ prevout: { scriptpubkey_address: v.address, value: v.value } })) } as unknown as TransactionExtended);

describe('watchlists: ownership, validation and durability', () => {
  let alice: AuthenticatedOwner;
  let bob: AuthenticatedOwner;

  beforeEach(async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    alice = await owner('alice', '203.0.113.1');
    bob = await owner('bob', '203.0.113.2');
  });

  it('starts empty and blinds entities with SHA-256', async () => {
    expect(await watchlistsService.getWatchlists(alice)).toEqual([]);
    const wl = await watchlistsService.createWatchlist(alice, 'Cold Multisig Watchlist', 'blinded');
    expect(wl.owner_id).toBe(alice.owner_id);
    expect(wl.network).toBe(config.MEMPOOL.NETWORK);
    const rawAddress = 'tb1qy0swjglf4nw5cac2kh3nh7y09dkevedl7cfuta';
    const entity = await watchlistsService.addEntity(alice, wl.watchlist_id, 'address', rawAddress, 'Audit wallet');
    expect(entity?.blinded_hash).toBe(sha256(rawAddress));
    expect(blind(sha256(rawAddress), true)).toBe(sha256(rawAddress));
    // A txid is 64 hex characters and is still hashed unless the caller says it is already blinded.
    expect(blind('c'.repeat(64))).toBe(sha256('c'.repeat(64)));
    expect(() => blind('not-a-hash', true)).toThrow();
  });

  it('a foreign watchlist is not found, not readable, not writable, not deletable', async () => {
    const wl = await watchlistsService.createWatchlist(alice, 'mine');
    expect(await watchlistsService.getWatchlistById(bob, wl.watchlist_id)).toBeNull();
    expect(await watchlistsService.addEntity(bob, wl.watchlist_id, 'txid', 'a'.repeat(64), 'x')).toBeNull();
    expect(await watchlistsService.addRule(bob, wl.watchlist_id, 'confirmation', 'in_app')).toBeNull();
    expect(await watchlistsService.getNotifications(bob, wl.watchlist_id)).toBeNull();
    expect(await watchlistsService.deleteWatchlist(bob, wl.watchlist_id)).toBe(false);
    expect(await watchlistsService.getWatchlists(bob)).toEqual([]);
    expect((await watchlistsService.getWatchlists(alice)).map(w => w.watchlist_id)).toEqual([wl.watchlist_id]);
    expect(await watchlistsService.deleteWatchlist(alice, wl.watchlist_id)).toBe(true);
    expect(await watchlistsService.getWatchlists(alice)).toEqual([]);
  });

  it('validates enums, lengths, thresholds, webhook ownership and duplicates', async () => {
    const wl = await watchlistsService.createWatchlist(alice, 'rules');
    await expect(watchlistsService.createWatchlist(alice, '')).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
    await expect(watchlistsService.createWatchlist(alice, 'x', 'public')).rejects.toMatchObject({ code: 'invalid_privacy_mode' });
    await expect(watchlistsService.addEntity(alice, wl.watchlist_id, 'wallet', 'x', 'l')).rejects.toMatchObject({ code: 'invalid_entity_type' });
    await expect(watchlistsService.addEntity(alice, wl.watchlist_id, 'txid', 'x'.repeat(600), 'l')).rejects.toMatchObject({ code: 'invalid_entity_raw_or_blinded' });
    await watchlistsService.addEntity(alice, wl.watchlist_id, 'txid', 'b'.repeat(64), 'once');
    await expect(watchlistsService.addEntity(alice, wl.watchlist_id, 'txid', 'b'.repeat(64), 'twice')).rejects.toMatchObject({ code: 'duplicate_entity', status: 409 });
    await expect(watchlistsService.addRule(alice, wl.watchlist_id, 'price', 'in_app')).rejects.toMatchObject({ code: 'invalid_condition_type' });
    await expect(watchlistsService.addRule(alice, wl.watchlist_id, 'feerate_cross', 'in_app')).rejects.toMatchObject({ code: 'invalid_threshold_value' });
    await expect(watchlistsService.addRule(alice, wl.watchlist_id, 'value_transfer', 'in_app', 'NaN')).rejects.toMatchObject({ code: 'invalid_threshold_value' });
    await expect(watchlistsService.addRule(alice, wl.watchlist_id, 'confirmation', 'webhook')).rejects.toMatchObject({ code: 'invalid_webhook_id' });
    developerIdentity.resolver = async () => [{ address: '203.0.113.9', family: 4 }];
    const bobHook = await developerIdentity.registerWebhook(bob, 'https://hooks.example.org/b', ['watchlist.notification']);
    await expect(watchlistsService.addRule(alice, wl.watchlist_id, 'confirmation', 'webhook', undefined, bobHook.webhook_id)).rejects.toMatchObject({ code: 'invalid_webhook_id', status: 404 });
    const aliceHook = await developerIdentity.registerWebhook(alice, 'https://hooks.example.org/a', ['watchlist.notification']);
    const rule = await watchlistsService.addRule(alice, wl.watchlist_id, 'confirmation', 'webhook', undefined, aliceHook.webhook_id);
    expect(rule?.webhook_id).toBe(aliceHook.webhook_id);
  });

  it('routes require an owner key and never read a user_id', async () => {
    const handlers = new Map<string, Function[]>();
    const app = {
      get: jest.fn((path: string, ...fns: Function[]) => { handlers.set('GET ' + path, fns); return app; }),
      post: jest.fn((path: string, ...fns: Function[]) => { handlers.set('POST ' + path, fns); return app; }),
      delete: jest.fn((path: string, ...fns: Function[]) => { handlers.set('DELETE ' + path, fns); return app; }),
    };
    watchlistsRoutes.initRoutes(app as unknown as Application);
    for (const [route, fns] of handlers) {
      expect(fns.length).toBe(2);
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), locals: {} };
      const next = jest.fn();
      await fns[0]({ headers: {}, body: { user_id: alice.owner_id }, query: { user_id: alice.owner_id } } as unknown as Request, res as unknown as Response, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      void route;
    }
  });
});

describe('watchlist matcher: findings come from observed blocks and replacements', () => {
  let alice: AuthenticatedOwner;
  let bob: AuthenticatedOwner;
  let matcher: WatchlistMatcher;
  const watchedTxid = 'c'.repeat(64);
  const watchedAddress = 'tb1qwatchedaddressxxxxxxxxxxxxxxxxxxxxxxxx';

  beforeEach(async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    alice = await owner('alice', '203.0.113.1');
    bob = await owner('bob', '203.0.113.2');
    matcher = new WatchlistMatcher(config.MEMPOOL.NETWORK);
  });

  async function aliceList(rules: { condition: string; threshold?: number }[]) {
    const wl = await watchlistsService.createWatchlist(alice, 'watch');
    await watchlistsService.addEntity(alice, wl.watchlist_id, 'txid', watchedTxid, 'the tx');
    await watchlistsService.addEntity(alice, wl.watchlist_id, 'address', watchedAddress, 'the address');
    for (const rule of rules) { await watchlistsService.addRule(alice, wl.watchlist_id, rule.condition, 'in_app', rule.threshold); }
    return wl;
  }

  it('confirmation and value transfers produce one notification each, once, for the owner only', async () => {
    const wl = await aliceList([{ condition: 'confirmation' }, { condition: 'value_transfer', threshold: 1000 }]);
    const b = block(100, 'a1'.repeat(32), 5);
    const txs = [tx(watchedTxid, [{ address: watchedAddress, value: 5000 }, { address: 'other', value: 1 }]), tx('d'.repeat(64), [{ address: watchedAddress, value: 10 }])];
    expect(await matcher.observeBlock(b, txs)).toEqual({ inserted: 2, duplicates: 0, displaced: 0 });
    // The same block again (a replay) creates nothing new.
    expect(await matcher.observeBlock(b, txs)).toEqual({ inserted: 0, duplicates: 2, displaced: 0 });
    const notifications = (await watchlistsService.getNotifications(alice, wl.watchlist_id))!;
    expect(notifications.map(n => n.title).sort()).toEqual(['Transaction confirmed', 'Value received']);
    expect(notifications.every(n => n.block_height === 100 && n.block_hash === b.id && n.state === 'open')).toBe(true);
    expect(notifications.find(n => n.title === 'Transaction confirmed')?.blinded_hash).toBe(sha256(watchedTxid));
    expect(await watchlistsService.getNotifications(bob, null)).toEqual([]);
    // Bob cannot acknowledge Alice's notification; Alice can, once.
    expect(await watchlistsService.acknowledgeNotification(bob, notifications[0].notification_id)).toBe(false);
    expect(await watchlistsService.acknowledgeNotification(alice, notifications[0].notification_id)).toBe(true);
    expect(await watchlistsService.acknowledgeNotification(alice, notifications[0].notification_id)).toBe(false);
    expect((await watchlistsService.getNotifications(alice, null))!.find(n => n.notification_id === notifications[0].notification_id)?.state).toBe('acknowledged');
    expect((await ownerStore().getCheckpoint('watchlist-matcher', config.MEMPOOL.NETWORK))?.block_height).toBe(100);
  });

  it('fee rate crossings compare consecutive blocks against the threshold', async () => {
    const wl = await aliceList([{ condition: 'feerate_cross', threshold: 10 }]);
    await matcher.observeBlock(block(1, '01'.repeat(32), 4), []);
    await matcher.observeBlock(block(2, '02'.repeat(32), 12), []);
    await matcher.observeBlock(block(3, '03'.repeat(32), 15), []);
    await matcher.observeBlock(block(4, '04'.repeat(32), 3), []);
    const notifications = (await watchlistsService.getNotifications(alice, wl.watchlist_id))!;
    expect(notifications.map(n => [n.block_height, n.title]).sort()).toEqual([[2, 'Fee rate rose past threshold'], [4, 'Fee rate fell below threshold']]);
  });

  it('a reorg displaces the confirmation and reports it when a rule asks for it', async () => {
    const wl = await aliceList([{ condition: 'confirmation' }, { condition: 'reorg_displaced' }]);
    await matcher.observeBlock(block(50, 'aa'.repeat(32), 5), [tx(watchedTxid, [{ address: 'x', value: 1 }])]);
    const result = await matcher.observeBlock(block(50, 'bb'.repeat(32), 5), [tx('e'.repeat(64), [{ address: 'x', value: 1 }])]);
    expect(result.displaced).toBe(1);
    const notifications = (await watchlistsService.getNotifications(alice, wl.watchlist_id))!;
    expect(notifications.find(n => n.title === 'Transaction confirmed')?.state).toBe('displaced');
    expect(notifications.find(n => n.title === 'Confirmation displaced by reorg')).toMatchObject({ block_hash: 'bb'.repeat(32), severity: 'critical' });
  });

  it('a mempool replacement of a watched txid is reported', async () => {
    const wl = await aliceList([{ condition: 'rbf_replacement' }]);
    expect(await matcher.observeReplacement(watchedTxid, 'f'.repeat(64))).toBe(1);
    expect(await matcher.observeReplacement(watchedTxid, 'f'.repeat(64))).toBe(0);
    expect(await matcher.observeReplacement('9'.repeat(64), 'f'.repeat(64))).toBe(0);
    const [notification] = (await watchlistsService.getNotifications(alice, wl.watchlist_id))!;
    expect(notification).toMatchObject({ title: 'Transaction replaced', block_height: null });
  });

  it('a webhook rule queues a delivery for exactly the owner webhook', async () => {
    developerIdentity.resolver = async () => [{ address: '203.0.113.9', family: 4 }];
    const hook = await developerIdentity.registerWebhook(alice, 'https://hooks.example.org/a', ['watchlist.notification']);
    const wl = await watchlistsService.createWatchlist(alice, 'hooked');
    await watchlistsService.addEntity(alice, wl.watchlist_id, 'txid', watchedTxid, 'the tx');
    await watchlistsService.addRule(alice, wl.watchlist_id, 'confirmation', 'webhook', undefined, hook.webhook_id);
    await matcher.observeBlock(block(7, '07'.repeat(32), 5), [tx(watchedTxid, [{ address: 'x', value: 1 }])]);
    const claimed = await ownerStore().claimOutbox(config.MEMPOOL.NETWORK, new Date(Date.now() + 1000).toISOString(), new Date(Date.now() + 60_000).toISOString(), 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].webhook_id).toBe(hook.webhook_id);
  });

  it('the per-rule hourly rate limit caps notifications', async () => {
    const wl = await watchlistsService.createWatchlist(alice, 'busy');
    await watchlistsService.addEntity(alice, wl.watchlist_id, 'address', watchedAddress, 'addr');
    await watchlistsService.addRule(alice, wl.watchlist_id, 'value_transfer', 'in_app');
    const txs = Array.from({ length: 30 }, (_, i) => tx(i.toString(16).padStart(64, '0'), [{ address: watchedAddress, value: 1 }]));
    const result = await matcher.observeBlock(block(9, '09'.repeat(32), 5), txs);
    expect(result.inserted).toBe(20);
    expect((await watchlistsService.getNotifications(alice, wl.watchlist_id, 100))!.length).toBe(20);
  });
});
