import * as crypto from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { eventBus } from '../events/intelligence-event-bus';

export interface WatchlistEntity {
  entity_id: string;
  entity_type: 'address' | 'txid' | 'outpoint' | 'descriptor' | 'feerate_threshold';
  blinded_hash: string;
  label: string;
  added_at_utc: string;
}

export interface WatchlistRule {
  rule_id: string;
  watchlist_id: string;
  condition_type: 'confirmation' | 'rbf_replacement' | 'feerate_cross' | 'value_transfer' | 'reorg_displaced';
  threshold_value?: number;
  delivery_channel: 'in_app' | 'webhook' | 'websocket';
  webhook_url?: string;
  enabled: boolean;
  rate_limit_per_hour: number;
}

export interface WatchlistNotification {
  notification_id: string;
  watchlist_id: string;
  rule_id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  entity_type: string;
  blinded_hash: string;
  acknowledged: boolean;
  created_at_utc: string;
}

export interface UserWatchlist {
  watchlist_id: string;
  user_id: string;
  name: string;
  privacy_mode: 'blinded' | 'encrypted' | 'standard';
  entities: WatchlistEntity[];
  rules: WatchlistRule[];
  created_at: string;
  updated_at: string;
}

export class WatchlistsService {
  private static instance: WatchlistsService;
  private watchlists: Map<string, UserWatchlist> = new Map();
  private notifications: Map<string, WatchlistNotification> = new Map();

  private constructor() {
    this.seedDefaultWatchlist();
  }

  public static getInstance(): WatchlistsService {
    if (!WatchlistsService.instance) {
      WatchlistsService.instance = new WatchlistsService();
    }
    return WatchlistsService.instance;
  }

  private seedDefaultWatchlist(): void {
    const wId = 'wl-sample-01';
    const ruleId = 'rule-sample-01';
    const address = 'bc1q751e76e8199196d454941c45d1b3a323f1433bd6';
    const blinded = crypto.createHash('sha256').update(address).digest('hex');

    const watchlist: UserWatchlist = {
      watchlist_id: wId,
      user_id: 'user-default',
      name: 'Cold Storage Vault Monitoring',
      privacy_mode: 'blinded',
      entities: [
        {
          entity_id: 'ent-01',
          entity_type: 'address',
          blinded_hash: blinded,
          label: 'Primary Vault Output',
          added_at_utc: new Date().toISOString(),
        },
      ],
      rules: [
        {
          rule_id: ruleId,
          watchlist_id: wId,
          condition_type: 'value_transfer',
          threshold_value: 1000000, // 0.01 BTC in sats
          delivery_channel: 'in_app',
          enabled: true,
          rate_limit_per_hour: 10,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.watchlists.set(wId, watchlist);

    // Default notification
    const notifId = 'notif-sample-01';
    this.notifications.set(notifId, {
      notification_id: notifId,
      watchlist_id: wId,
      rule_id: ruleId,
      title: 'Transfer Alert',
      message: 'Observed transfer of 2,500,000 satoshis matching watched blinded entity.',
      severity: 'info',
      entity_type: 'address',
      blinded_hash: blinded,
      acknowledged: false,
      created_at_utc: new Date(Date.now() - 3600000).toISOString(),
    });
  }

  public createWatchlist(
    userId: string,
    name: string,
    privacyMode: 'blinded' | 'encrypted' | 'standard' = 'blinded'
  ): UserWatchlist {
    const id = EventEnvelopeValidator.generateUuidV7();
    const now = new Date().toISOString();

    const wl: UserWatchlist = {
      watchlist_id: id,
      user_id: userId,
      name,
      privacy_mode: privacyMode,
      entities: [],
      rules: [],
      created_at: now,
      updated_at: now,
    };

    this.watchlists.set(id, wl);
    return wl;
  }

  public getWatchlists(userId: string): UserWatchlist[] {
    return Array.from(this.watchlists.values()).filter((w) => w.user_id === userId);
  }

  public getWatchlistById(id: string): UserWatchlist | null {
    return this.watchlists.get(id) || null;
  }

  public addEntity(
    watchlistId: string,
    entityType: WatchlistEntity['entity_type'],
    entityRawOrBlinded: string,
    label: string
  ): WatchlistEntity | null {
    const wl = this.watchlists.get(watchlistId);
    if (!wl) return null;

    // Blind hash if not already hashed
    const isSha256Hex = /^[0-9a-fA-F]{64}$/.test(entityRawOrBlinded);
    const blinded = isSha256Hex
      ? entityRawOrBlinded.toLowerCase()
      : crypto.createHash('sha256').update(entityRawOrBlinded).digest('hex');

    const entity: WatchlistEntity = {
      entity_id: EventEnvelopeValidator.generateUuidV7(),
      entity_type: entityType,
      blinded_hash: blinded,
      label,
      added_at_utc: new Date().toISOString(),
    };

    wl.entities.push(entity);
    wl.updated_at = new Date().toISOString();
    return entity;
  }

  public addRule(
    watchlistId: string,
    conditionType: WatchlistRule['condition_type'],
    channel: WatchlistRule['delivery_channel'],
    thresholdValue?: number,
    webhookUrl?: string
  ): WatchlistRule | null {
    const wl = this.watchlists.get(watchlistId);
    if (!wl) return null;

    const rule: WatchlistRule = {
      rule_id: EventEnvelopeValidator.generateUuidV7(),
      watchlist_id: watchlistId,
      condition_type: conditionType,
      threshold_value: thresholdValue,
      delivery_channel: channel,
      webhook_url: webhookUrl,
      enabled: true,
      rate_limit_per_hour: 20,
    };

    wl.rules.push(rule);
    wl.updated_at = new Date().toISOString();
    return rule;
  }

  public getNotifications(watchlistId?: string): WatchlistNotification[] {
    const list = Array.from(this.notifications.values());
    if (watchlistId) {
      return list.filter((n) => n.watchlist_id === watchlistId);
    }
    return list;
  }

  public acknowledgeNotification(notifId: string): boolean {
    const n = this.notifications.get(notifId);
    if (!n) return false;
    n.acknowledged = true;
    return true;
  }

  public deleteWatchlist(id: string): boolean {
    return this.watchlists.delete(id);
  }
}

export const watchlistsService = WatchlistsService.getInstance();
