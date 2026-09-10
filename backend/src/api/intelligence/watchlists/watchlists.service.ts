import * as crypto from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class WatchlistsEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const matcherUnavailable =
  'Watchlist notifications are unavailable. Alerts require the owned watchlist matcher that evaluates rules against the owned mempool and chain readers (UNIVERSE_WATCHLIST_MATCHER_ORIGIN), which is not connected on this deployment.';

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

/**
 * Watchlists hold what callers submitted and stay answerable. Notifications
 * used to come from a seeded sample alert about a transfer nobody observed;
 * no owned matcher is connected, so they report the source they would need.
 */
export class WatchlistsService {
  private static instance: WatchlistsService;
  private watchlists: Map<string, UserWatchlist> = new Map();

  private constructor() {}

  public static getInstance(): WatchlistsService {
    if (!WatchlistsService.instance) {
      WatchlistsService.instance = new WatchlistsService();
    }
    return WatchlistsService.instance;
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
    void watchlistId;
    throw new WatchlistsEvidenceError('unavailable-watchlist-matcher', matcherUnavailable);
  }

  public acknowledgeNotification(notifId: string): boolean {
    void notifId;
    throw new WatchlistsEvidenceError('unavailable-watchlist-matcher', matcherUnavailable);
  }

  public deleteWatchlist(id: string): boolean {
    return this.watchlists.delete(id);
  }
}

export const watchlistsService = WatchlistsService.getInstance();
