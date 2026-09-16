import * as crypto from 'crypto';
import config from '../../../config';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { AuthenticatedOwner, IdentityError } from '../identity/developer-identity';
import { NotificationRow, ownerStore, WatchlistEntityRow, WatchlistRow, WatchlistRuleRow } from '../identity/owner-store';

/**
 * Watchlists: what an owner asked this deployment to watch, and what the
 * matcher found for them.
 *
 * Every read and write is scoped to the authenticated owner and to this
 * backend's network. A foreign watchlist ID is "not found", a caller-chosen
 * user_id is ignored because there is none, and nothing lives only in
 * process memory when a database is configured.
 */

export const ENTITY_TYPES = ['address', 'txid', 'outpoint', 'descriptor', 'feerate_threshold'] as const;
export const CONDITION_TYPES = ['confirmation', 'rbf_replacement', 'feerate_cross', 'value_transfer', 'reorg_displaced'] as const;
export const DELIVERY_CHANNELS = ['in_app', 'webhook', 'websocket'] as const;
export const PRIVACY_MODES = ['blinded', 'standard'] as const;

export const WATCHLIST_LIMITS = { perOwner: 50, entitiesPerList: 500, rulesPerList: 50, nameLength: 128, labelLength: 128, rawLength: 512 } as const;

export type EntityType = typeof ENTITY_TYPES[number];
export type ConditionType = typeof CONDITION_TYPES[number];
export type DeliveryChannel = typeof DELIVERY_CHANNELS[number];

export interface WatchlistEntity {
  entity_id: string;
  entity_type: EntityType;
  blinded_hash: string;
  label: string;
  added_at_utc: string;
}

export interface WatchlistRule {
  rule_id: string;
  watchlist_id: string;
  condition_type: ConditionType;
  threshold_value?: number;
  delivery_channel: DeliveryChannel;
  webhook_id?: string;
  enabled: boolean;
  rate_limit_per_hour: number;
}

export interface WatchlistNotification {
  notification_id: string;
  watchlist_id: string;
  rule_id: string;
  event_id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  entity_type: string;
  blinded_hash: string;
  block_height: number | null;
  block_hash: string | null;
  state: 'open' | 'acknowledged' | 'displaced';
  acknowledged: boolean;
  created_at_utc: string;
}

export interface UserWatchlist {
  watchlist_id: string;
  owner_id: string;
  network: string;
  name: string;
  privacy_mode: string;
  requested_privacy_mode: string;
  privacy_scope: string;
  encryption_verified: false;
  entities: WatchlistEntity[];
  rules: WatchlistRule[];
  created_at: string;
  updated_at: string;
  version: number;
  storage: 'durable' | 'memory';
}

/**
 * SHA-256 of the raw identifier. A caller that blinded the value itself
 * says so explicitly; guessing from the shape would mistake every txid
 * (64 hex characters) for a hash and never match it.
 */
export function blind(entityRawOrBlinded: string, alreadyBlinded = false): string {
  const trimmed = entityRawOrBlinded.trim();
  if (alreadyBlinded) {
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      throw new IdentityError('invalid_blinded_hash', 'a blinded value must be a 64-character hex SHA-256', 400);
    }
    return trimmed.toLowerCase();
  }
  return crypto.createHash('sha256').update(trimmed).digest('hex');
}

export class WatchlistsService {
  private static instance: WatchlistsService;

  private constructor() {}

  public static getInstance(): WatchlistsService {
    if (!WatchlistsService.instance) {
      WatchlistsService.instance = new WatchlistsService();
    }
    return WatchlistsService.instance;
  }

  private get network(): string {
    return config.MEMPOOL.NETWORK;
  }

  private static requireEnum<T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      throw new IdentityError('invalid_' + field, `${field} must be one of ${allowed.join(', ')}`, 400);
    }
    return value;
  }

  private static requireText(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
      throw new IdentityError('invalid_' + field, `${field} must be 1 to ${max} characters`, 400);
    }
    return value.trim();
  }

  private toEntity(row: WatchlistEntityRow): WatchlistEntity {
    return { entity_id: row.entity_id, entity_type: row.entity_type as EntityType, blinded_hash: row.blinded_hash, label: row.label, added_at_utc: row.created_at };
  }

  private toRule(row: WatchlistRuleRow): WatchlistRule {
    return {
      rule_id: row.rule_id, watchlist_id: row.watchlist_id, condition_type: row.condition_type as ConditionType,
      threshold_value: row.threshold_value === null ? undefined : row.threshold_value, delivery_channel: row.delivery_channel as DeliveryChannel,
      webhook_id: row.webhook_id ?? undefined, enabled: row.enabled, rate_limit_per_hour: row.rate_limit_per_hour,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async hydrate(row: WatchlistRow): Promise<UserWatchlist> {
    const store = ownerStore();
    const [entities, rules] = await Promise.all([store.listEntities(row.watchlist_id), store.listRules(row.watchlist_id)]);
    return {
      watchlist_id: row.watchlist_id, owner_id: row.owner_id, network: row.network, name: row.name,
      privacy_mode: row.privacy_mode === 'encrypted' ? 'legacy-unverified' : row.privacy_mode,
      requested_privacy_mode: row.privacy_mode, encryption_verified: false,
      privacy_scope: 'Entity identifiers are SHA-256 hashes. Names and labels are stored as supplied. Hashes are not encryption or protection against identifier guessing. Client-supplied blinding does not authenticate an entity.',
      entities: entities.map(entity => this.toEntity(entity)), rules: rules.map(rule => this.toRule(rule)),
      created_at: row.created_at, updated_at: row.updated_at, version: row.version, storage: store.kind === 'mysql' ? 'durable' : 'memory',
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async createWatchlist(owner: AuthenticatedOwner, name: unknown, privacyMode: unknown = 'blinded'): Promise<UserWatchlist> {
    const store = ownerStore();
    const cleanName = WatchlistsService.requireText(name, 'name', WATCHLIST_LIMITS.nameLength);
    const mode = WatchlistsService.requireEnum(privacyMode, PRIVACY_MODES, 'privacy_mode');
    const now = new Date().toISOString();
    const row: WatchlistRow = { watchlist_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: this.network, name: cleanName, privacy_mode: mode, created_at: now, updated_at: now, version: 1 };
    if (!await store.insertWatchlistWithinQuota(row, WATCHLIST_LIMITS.perOwner)) {
      throw new IdentityError('quota', `an owner may keep at most ${WATCHLIST_LIMITS.perOwner} watchlists`, 409);
    }
    return this.hydrate(row);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWatchlists(owner: AuthenticatedOwner): Promise<UserWatchlist[]> {
    const rows = await ownerStore().listWatchlists(owner.owner_id, this.network);
    return Promise.all(rows.map(row => this.hydrate(row)));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWatchlistById(owner: AuthenticatedOwner, watchlistId: string): Promise<UserWatchlist | null> {
    const row = await ownerStore().getWatchlist(owner.owner_id, this.network, watchlistId);
    return row ? this.hydrate(row) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async addEntity(owner: AuthenticatedOwner, watchlistId: string, entityType: unknown, entityRawOrBlinded: unknown, label: unknown, alreadyBlinded = false): Promise<WatchlistEntity | null> {
    const store = ownerStore();
    const parent = await store.getWatchlist(owner.owner_id, this.network, watchlistId);
    if (!parent) { return null; }
    const type = WatchlistsService.requireEnum(entityType, ENTITY_TYPES, 'entity_type');
    const raw = WatchlistsService.requireText(entityRawOrBlinded, 'entity_raw_or_blinded', WATCHLIST_LIMITS.rawLength);
    const cleanLabel = label === undefined || label === null || label === '' ? 'Monitored Item' : WatchlistsService.requireText(label, 'label', WATCHLIST_LIMITS.labelLength);
    const row: WatchlistEntityRow = {
      entity_id: EventEnvelopeValidator.generateUuidV7(), watchlist_id: watchlistId, owner_id: owner.owner_id, network: this.network,
      entity_type: type, blinded_hash: blind(raw, alreadyBlinded), label: cleanLabel, created_at: new Date().toISOString(),
    };
    const outcome = await store.insertEntityWithinQuota(row, WATCHLIST_LIMITS.entitiesPerList);
    if (outcome === 'quota') {
      throw new IdentityError('quota', `a watchlist may hold at most ${WATCHLIST_LIMITS.entitiesPerList} entities`, 409);
    }
    if (outcome === 'duplicate') {
      throw new IdentityError('duplicate_entity', 'this entity is already on the watchlist', 409);
    }
    await store.touchWatchlist(watchlistId, row.created_at);
    return this.toEntity(row);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async addRule(owner: AuthenticatedOwner, watchlistId: string, conditionType: unknown, channel: unknown, thresholdValue?: unknown, webhookId?: unknown): Promise<WatchlistRule | null> {
    const store = ownerStore();
    const parent = await store.getWatchlist(owner.owner_id, this.network, watchlistId);
    if (!parent) { return null; }
    const condition = WatchlistsService.requireEnum(conditionType, CONDITION_TYPES, 'condition_type');
    const delivery = WatchlistsService.requireEnum(channel, DELIVERY_CHANNELS, 'delivery_channel');
    let threshold: number | null = null;
    if (thresholdValue !== undefined && thresholdValue !== null && thresholdValue !== '') {
      if (typeof thresholdValue !== 'number' && (typeof thresholdValue !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(thresholdValue))) {
        throw new IdentityError('invalid_threshold_value', 'threshold_value must be a non-negative decimal number', 400);
      }
      threshold = Number(thresholdValue);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1e15) {
        throw new IdentityError('invalid_threshold_value', 'threshold_value must be a finite non-negative number', 400);
      }
    }
    if (condition === 'feerate_cross' && threshold === null) {
      throw new IdentityError('invalid_threshold_value', 'feerate_cross needs threshold_value in sat/vB', 400);
    }
    let webhook: string | null = null;
    if (delivery === 'webhook') {
      if (typeof webhookId !== 'string' || !webhookId) {
        throw new IdentityError('invalid_webhook_id', 'webhook delivery needs webhook_id of a webhook you registered', 400);
      }
      const owned = await store.getWebhook(owner.owner_id, this.network, webhookId);
      if (!owned) {
        throw new IdentityError('invalid_webhook_id', 'webhook not found', 404);
      }
      webhook = owned.webhook_id;
    }
    const row: WatchlistRuleRow = {
      rule_id: EventEnvelopeValidator.generateUuidV7(), watchlist_id: watchlistId, owner_id: owner.owner_id, network: this.network,
      condition_type: condition, threshold_value: threshold, delivery_channel: delivery, webhook_id: webhook, enabled: true, rate_limit_per_hour: 20,
      created_at: new Date().toISOString(), version: 1,
    };
    if (!await store.insertRuleWithinQuota(row, WATCHLIST_LIMITS.rulesPerList)) {
      throw new IdentityError('quota', `a watchlist may hold at most ${WATCHLIST_LIMITS.rulesPerList} rules`, 409);
    }
    await store.touchWatchlist(watchlistId, row.created_at);
    return this.toRule(row);
  }

  private toNotification(row: NotificationRow): WatchlistNotification {
    return {
      notification_id: row.notification_id, watchlist_id: row.watchlist_id, rule_id: row.rule_id, event_id: row.event_id, title: row.title, message: row.message,
      severity: row.severity as WatchlistNotification['severity'], entity_type: row.entity_type, blinded_hash: row.blinded_hash,
      block_height: row.block_height, block_hash: row.block_hash, state: row.state, acknowledged: row.state === 'acknowledged', created_at_utc: row.created_at,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getNotifications(owner: AuthenticatedOwner, watchlistId: string | null, limit = 100): Promise<WatchlistNotification[] | null> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new IdentityError('invalid_limit', 'limit must be an integer from 1 to 500', 400);
    }
    const store = ownerStore();
    if (watchlistId !== null) {
      const parent = await store.getWatchlist(owner.owner_id, this.network, watchlistId);
      if (!parent) { return null; }
    }
    const rows = await store.listNotifications(owner.owner_id, this.network, watchlistId, Math.max(1, Math.min(500, limit)));
    return rows.map(row => this.toNotification(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async acknowledgeNotification(owner: AuthenticatedOwner, notificationId: string): Promise<boolean> {
    return ownerStore().acknowledgeNotification(owner.owner_id, this.network, notificationId, new Date().toISOString());
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteWatchlist(owner: AuthenticatedOwner, watchlistId: string): Promise<boolean> {
    return ownerStore().deleteWatchlist(owner.owner_id, this.network, watchlistId);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteEntity(owner: AuthenticatedOwner, watchlistId: string, entityId: string): Promise<boolean> {
    const deleted = await ownerStore().deleteEntity(owner.owner_id, this.network, watchlistId, entityId);
    if (deleted) { await ownerStore().touchWatchlist(watchlistId, new Date().toISOString()); }
    return deleted;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteRule(owner: AuthenticatedOwner, watchlistId: string, ruleId: string): Promise<boolean> {
    const deleted = await ownerStore().deleteRule(owner.owner_id, this.network, watchlistId, ruleId);
    if (deleted) { await ownerStore().touchWatchlist(watchlistId, new Date().toISOString()); }
    return deleted;
  }
}

export const watchlistsService = WatchlistsService.getInstance();
