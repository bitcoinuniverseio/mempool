import { createHash, randomUUID } from 'crypto';
import config from '../../../config';
import DB from '../../../database';
import logger from '../../../logger';

/**
 * Durable, owner-scoped state for the intelligence surfaces: API keys,
 * webhooks, watchlists, saved queries, graph cases, notifications and the
 * webhook delivery outbox.
 *
 * Every row carries owner_id and network. Reads always predicate on both, so
 * a foreign resource ID answers "not found" rather than someone else's data.
 * The MySQL store is the source of truth on a deployment with a database;
 * the memory store exists for tests and for a database-less deployment,
 * which reports its state as not durable.
 */

export interface ApiKeyRow {
  key_id: string;
  owner_id: string;
  network: string;
  key_prefix: string;
  key_hash: string;
  hash_version: number;
  name: string;
  scopes: string[];
  rate_limit: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface WebhookRow {
  webhook_id: string;
  owner_id: string;
  network: string;
  url: string;
  secret_ciphertext: string;
  key_version: number;
  event_filters: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WatchlistRow {
  watchlist_id: string;
  owner_id: string;
  network: string;
  name: string;
  privacy_mode: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface WatchlistEntityRow {
  entity_id: string;
  watchlist_id: string;
  owner_id: string;
  network: string;
  entity_type: string;
  blinded_hash: string;
  label: string;
  created_at: string;
}

export interface WatchlistRuleRow {
  rule_id: string;
  watchlist_id: string;
  owner_id: string;
  network: string;
  condition_type: string;
  threshold_value: number | null;
  delivery_channel: string;
  webhook_id: string | null;
  enabled: boolean;
  rate_limit_per_hour: number;
  created_at: string;
  version: number;
}

export interface SavedQueryRow {
  query_id: string;
  owner_id: string;
  network: string;
  title: string;
  sql_text: string;
  created_at: string;
  updated_at: string;
}

export interface GraphCaseRow {
  case_id: string;
  owner_id: string;
  network: string;
  document: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  notification_id: string;
  owner_id: string;
  network: string;
  watchlist_id: string;
  rule_id: string;
  event_id: string;
  title: string;
  message: string;
  severity: string;
  entity_type: string;
  blinded_hash: string;
  block_height: number | null;
  block_hash: string | null;
  state: 'open' | 'acknowledged' | 'displaced';
  created_at: string;
  acknowledged_at: string | null;
}

export interface OutboxRow {
  outbox_id: string;
  notification_id: string;
  webhook_id: string;
  network: string;
  state: 'pending' | 'delivered' | 'failed';
  attempt_count: number;
  next_attempt_at: string;
  lease_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookAttemptRow {
  attempt_id: string;
  outbox_id: string;
  webhook_id: string;
  event_id: string;
  attempt_number: number;
  started_at: string;
  finished_at: string;
  status_code: number | null;
  success: boolean;
  response_digest: string | null;
  error_code: string | null;
}

export interface KnowledgeLabelRow {
  label_id: string;
  owner_id: string;
  network: string;
  entity_type: string;
  entity_id: string;
  status: string;
  document: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeAuditRow {
  audit_id: string;
  label_id: string;
  network: string;
  action: string;
  actor_owner_id: string;
  summary: string;
  created_at: string;
}

export interface MatcherCheckpoint {
  consumer_id: string;
  network: string;
  block_height: number;
  block_hash: string;
  updated_at: string;
}

export interface OwnerStore {
  readonly kind: 'mysql' | 'memory';

  getSetting(name: string): Promise<string | null>;
  /** Writes only when absent; returns the value now stored. */
  setSettingIfAbsent(name: string, value: string): Promise<string>;

  insertApiKey(row: ApiKeyRow): Promise<void>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRow | null>;
  listApiKeys(ownerId: string, network: string): Promise<ApiKeyRow[]>;
  countApiKeys(ownerId: string, network: string): Promise<number>;
  touchApiKey(keyId: string, at: string): Promise<void>;
  revokeApiKey(ownerId: string, network: string, keyId: string, at: string): Promise<boolean>;

  insertWebhook(row: WebhookRow): Promise<void>;
  listWebhooks(ownerId: string, network: string): Promise<WebhookRow[]>;
  getWebhook(ownerId: string, network: string, webhookId: string): Promise<WebhookRow | null>;
  getWebhookById(network: string, webhookId: string): Promise<WebhookRow | null>;
  countWebhooks(ownerId: string, network: string): Promise<number>;

  insertWatchlist(row: WatchlistRow): Promise<void>;
  insertWatchlistWithinQuota(row: WatchlistRow, limit: number): Promise<boolean>;
  listWatchlists(ownerId: string, network: string): Promise<WatchlistRow[]>;
  getWatchlist(ownerId: string, network: string, watchlistId: string): Promise<WatchlistRow | null>;
  countWatchlists(ownerId: string, network: string): Promise<number>;
  deleteWatchlist(ownerId: string, network: string, watchlistId: string): Promise<boolean>;
  touchWatchlist(watchlistId: string, at: string): Promise<void>;

  insertEntity(row: WatchlistEntityRow): Promise<'inserted' | 'duplicate'>;
  insertEntityWithinQuota(row: WatchlistEntityRow, limit: number): Promise<'inserted' | 'duplicate' | 'quota'>;
  listEntities(watchlistId: string): Promise<WatchlistEntityRow[]>;
  countEntities(watchlistId: string): Promise<number>;
  deleteEntity(ownerId: string, network: string, watchlistId: string, entityId: string): Promise<boolean>;
  /** Entities across every enabled watchlist of the network, for the matcher. */
  listEntitiesByType(network: string, entityType: string): Promise<WatchlistEntityRow[]>;

  insertRule(row: WatchlistRuleRow): Promise<void>;
  insertRuleWithinQuota(row: WatchlistRuleRow, limit: number): Promise<boolean>;
  listRules(watchlistId: string): Promise<WatchlistRuleRow[]>;
  countRules(watchlistId: string): Promise<number>;
  deleteRule(ownerId: string, network: string, watchlistId: string, ruleId: string): Promise<boolean>;
  listEnabledRules(network: string): Promise<WatchlistRuleRow[]>;

  insertSavedQuery(row: SavedQueryRow): Promise<void>;
  insertSavedQueryWithinQuota(row: SavedQueryRow, limit: number): Promise<boolean>;
  listSavedQueries(ownerId: string, network: string, limit: number, before?: string): Promise<SavedQueryRow[]>;
  countSavedQueries(ownerId: string, network: string): Promise<number>;

  insertGraphCase(row: GraphCaseRow): Promise<void>;
  updateGraphCase(ownerId: string, network: string, caseId: string, document: Record<string, unknown>, at: string): Promise<boolean>;
  listGraphCases(ownerId: string, network: string): Promise<GraphCaseRow[]>;
  getGraphCase(ownerId: string, network: string, caseId: string): Promise<GraphCaseRow | null>;
  deleteGraphCase(ownerId: string, network: string, caseId: string): Promise<boolean>;
  countGraphCases(ownerId: string, network: string): Promise<number>;

  insertNotification(row: NotificationRow): Promise<'inserted' | 'duplicate'>;
  listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]>;
  countNotificationsSince(ruleId: string, since: string): Promise<number>;
  acknowledgeNotification(ownerId: string, network: string, notificationId: string, at: string): Promise<boolean>;
  listNotificationsAtHeight(network: string, blockHeight: number): Promise<NotificationRow[]>;
  displaceNotification(notificationId: string): Promise<void>;

  insertKnowledgeLabel(row: KnowledgeLabelRow): Promise<void>;
  updateKnowledgeLabel(network: string, labelId: string, status: string, document: Record<string, unknown>, at: string): Promise<boolean>;
  listKnowledgeLabels(network: string, limit: number): Promise<KnowledgeLabelRow[]>;
  findKnowledgeLabelsByEntity(network: string, entityId: string): Promise<KnowledgeLabelRow[]>;
  getKnowledgeLabel(network: string, labelId: string): Promise<KnowledgeLabelRow | null>;
  countKnowledgeLabels(ownerId: string, network: string): Promise<number>;
  insertKnowledgeAudit(row: KnowledgeAuditRow): Promise<void>;
  listKnowledgeAudit(network: string, limit: number): Promise<KnowledgeAuditRow[]>;

  getCheckpoint(consumerId: string, network: string): Promise<MatcherCheckpoint | null>;
  saveCheckpoint(checkpoint: MatcherCheckpoint): Promise<void>;

  insertOutbox(row: OutboxRow): Promise<'inserted' | 'duplicate'>;
  /** Claims due pending rows with a lease, so two workers never deliver the same row. */
  claimOutbox(network: string, now: string, leaseUntil: string, limit: number): Promise<OutboxRow[]>;
  completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string): Promise<void>;
  insertAttempt(row: WebhookAttemptRow): Promise<void>;
  listAttempts(webhookId: string, limit: number): Promise<WebhookAttemptRow[]>;
  getNotificationById(network: string, notificationId: string): Promise<NotificationRow | null>;
}

const toDate = (iso: string | null): Date | null => (iso === null ? null : new Date(iso));
const fromDate = (value: unknown): string | null => {
  if (value === null || value === undefined) { return null; }
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
};
const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) { return fallback; }
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  if (Buffer.isBuffer(value)) { try { return JSON.parse(value.toString('utf8')) as T; } catch { return fallback; } }
  return value as T;
};

export class MysqlOwnerStore implements OwnerStore {
  public readonly kind = 'mysql' as const;

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSetting(name: string): Promise<string | null> {
    const [rows]: any[] = await DB.query('SELECT value FROM intelligence_settings WHERE name = ? LIMIT 1', [name]);
    return rows?.length ? String(rows[0].value) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async setSettingIfAbsent(name: string, value: string): Promise<string> {
    await DB.query('INSERT IGNORE INTO intelligence_settings (name, value, created_at) VALUES (?, ?, ?)', [name, value, new Date()]);
    return (await this.getSetting(name)) ?? value;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertApiKey(row: ApiKeyRow): Promise<void> {
    await DB.query(
      `INSERT INTO intelligence_api_keys (key_id, owner_id, network, key_prefix, key_hash, hash_version, name, scopes_json, rate_limit, expires_at, created_at, last_used_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.key_id, row.owner_id, row.network, row.key_prefix, row.key_hash, row.hash_version, row.name, JSON.stringify(row.scopes), row.rate_limit, toDate(row.expires_at), toDate(row.created_at), toDate(row.last_used_at), toDate(row.revoked_at)],
    );
  }

  private apiKey(row: any): ApiKeyRow {
    return {
      key_id: row.key_id, owner_id: row.owner_id, network: row.network, key_prefix: row.key_prefix, key_hash: row.key_hash,
      hash_version: Number(row.hash_version), name: row.name, scopes: parseJson<string[]>(row.scopes_json, []), rate_limit: Number(row.rate_limit),
      expires_at: fromDate(row.expires_at), created_at: fromDate(row.created_at) as string, last_used_at: fromDate(row.last_used_at), revoked_at: fromDate(row.revoked_at),
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findApiKeyByHash(hash: string): Promise<ApiKeyRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_api_keys WHERE key_hash = ? LIMIT 1', [hash]);
    return rows?.length ? this.apiKey(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listApiKeys(ownerId: string, network: string): Promise<ApiKeyRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_api_keys WHERE owner_id = ? AND network = ? ORDER BY created_at DESC LIMIT 200', [ownerId, network]);
    return (rows ?? []).map((row: any) => this.apiKey(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countApiKeys(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_api_keys WHERE owner_id = ? AND network = ? AND revoked_at IS NULL', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async touchApiKey(keyId: string, at: string): Promise<void> {
    await DB.query('UPDATE intelligence_api_keys SET last_used_at = ? WHERE key_id = ?', [toDate(at), keyId], 'silent');
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async revokeApiKey(ownerId: string, network: string, keyId: string, at: string): Promise<boolean> {
    const [result]: any[] = await DB.query('UPDATE intelligence_api_keys SET revoked_at = ? WHERE key_id = ? AND owner_id = ? AND network = ? AND revoked_at IS NULL', [toDate(at), keyId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  private webhook(row: any): WebhookRow {
    return {
      webhook_id: row.webhook_id, owner_id: row.owner_id, network: row.network, url: row.url, secret_ciphertext: row.secret_ciphertext,
      key_version: Number(row.key_version), event_filters: parseJson<string[]>(row.event_filters_json, []), active: Boolean(row.active),
      created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertWebhook(row: WebhookRow): Promise<void> {
    await DB.query(
      `INSERT INTO intelligence_webhooks (webhook_id, owner_id, network, url, secret_ciphertext, key_version, event_filters_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.webhook_id, row.owner_id, row.network, row.url, row.secret_ciphertext, row.key_version, JSON.stringify(row.event_filters), row.active ? 1 : 0, toDate(row.created_at), toDate(row.updated_at)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listWebhooks(ownerId: string, network: string): Promise<WebhookRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_webhooks WHERE owner_id = ? AND network = ? ORDER BY created_at DESC LIMIT 200', [ownerId, network]);
    return (rows ?? []).map((row: any) => this.webhook(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWebhook(ownerId: string, network: string, webhookId: string): Promise<WebhookRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_webhooks WHERE webhook_id = ? AND owner_id = ? AND network = ? LIMIT 1', [webhookId, ownerId, network]);
    return rows?.length ? this.webhook(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWebhookById(network: string, webhookId: string): Promise<WebhookRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_webhooks WHERE webhook_id = ? AND network = ? LIMIT 1', [webhookId, network]);
    return rows?.length ? this.webhook(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countWebhooks(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_webhooks WHERE owner_id = ? AND network = ?', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** Cross-process quota serialization uses one existing settings row per owner/network. */
  private async quotaInsert(row: {owner_id:string;network:string}, table: string, columns: string[], values: unknown[], scope: string, scopeValues: unknown[], limit: number, duplicate?: {where:string;values:unknown[]}): Promise<'inserted'|'duplicate'|'quota'> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100000)throw new Error('Invalid store quota');
    const lock=createHash('sha256').update('owner-quota:'+JSON.stringify([row.owner_id,row.network])).digest('hex');
    const queries:any[]=[
      {query:'INSERT INTO intelligence_settings (name, value, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = name',params:[lock,'quota-lock',new Date()]},
      {query:'SELECT value FROM intelligence_settings WHERE name = ? FOR UPDATE',params:[lock]},
    ];
    if(duplicate)queries.push({query:'SELECT 1 AS found FROM '+table+' WHERE '+duplicate.where+' LIMIT 1',params:duplicate.values});
    queries.push({query:'INSERT INTO '+table+' ('+columns.join(', ')+') SELECT '+values.map(()=>'?').join(', ')+' WHERE (SELECT COUNT(*) FROM '+table+' WHERE '+scope+') < ?'+(duplicate?' AND NOT EXISTS (SELECT 1 FROM '+table+' WHERE '+duplicate.where+')':''),params:[...values,...scopeValues,limit,...(duplicate?.values??[])]});
    const results:any[]=await DB.$atomicQuery(queries);
    if(Number(results[results.length-1]?.[0]?.affectedRows)===1)return 'inserted';
    if(duplicate&&results[2]?.[0]?.length)return 'duplicate';
    return 'quota';
  }
  public async insertWatchlistWithinQuota(row: WatchlistRow, limit: number): Promise<boolean> {
    return await this.quotaInsert(row,'intelligence_watchlists',['watchlist_id','owner_id','network','name','privacy_mode','created_at','updated_at','version'],[row.watchlist_id,row.owner_id,row.network,row.name,row.privacy_mode,toDate(row.created_at),toDate(row.updated_at),row.version],'owner_id = ? AND network = ?',[row.owner_id,row.network],limit)==='inserted';
  }
  public async insertEntityWithinQuota(row: WatchlistEntityRow, limit: number): Promise<'inserted'|'duplicate'|'quota'> {
    return this.quotaInsert(row,'intelligence_watchlist_entities',['entity_id','watchlist_id','owner_id','network','entity_type','blinded_hash','label','created_at'],[row.entity_id,row.watchlist_id,row.owner_id,row.network,row.entity_type,row.blinded_hash,row.label,toDate(row.created_at)],'watchlist_id = ? AND owner_id = ? AND network = ?',[row.watchlist_id,row.owner_id,row.network],limit,{where:'watchlist_id = ? AND entity_type = ? AND blinded_hash = ?',values:[row.watchlist_id,row.entity_type,row.blinded_hash]});
  }
  public async insertRuleWithinQuota(row: WatchlistRuleRow, limit: number): Promise<boolean> {
    return await this.quotaInsert(row,'intelligence_watchlist_rules',['rule_id','watchlist_id','owner_id','network','condition_type','threshold_value','delivery_channel','webhook_id','enabled','rate_limit_per_hour','created_at','version'],[row.rule_id,row.watchlist_id,row.owner_id,row.network,row.condition_type,row.threshold_value,row.delivery_channel,row.webhook_id,row.enabled?1:0,row.rate_limit_per_hour,toDate(row.created_at),row.version],'watchlist_id = ? AND owner_id = ? AND network = ?',[row.watchlist_id,row.owner_id,row.network],limit)==='inserted';
  }
  public async insertSavedQueryWithinQuota(row: SavedQueryRow, limit: number): Promise<boolean> {
    return await this.quotaInsert(row,'intelligence_saved_queries',['query_id','owner_id','network','title','sql_text','created_at','updated_at'],[row.query_id,row.owner_id,row.network,row.title,row.sql_text,toDate(row.created_at),toDate(row.updated_at)],'owner_id = ? AND network = ?',[row.owner_id,row.network],limit)==='inserted';
  }

  private watchlist(row: any): WatchlistRow {
    return {
      watchlist_id: row.watchlist_id, owner_id: row.owner_id, network: row.network, name: row.name, privacy_mode: row.privacy_mode,
      created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string, version: Number(row.version),
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertWatchlist(row: WatchlistRow): Promise<void> {
    await DB.query(
      'INSERT INTO intelligence_watchlists (watchlist_id, owner_id, network, name, privacy_mode, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.watchlist_id, row.owner_id, row.network, row.name, row.privacy_mode, toDate(row.created_at), toDate(row.updated_at), row.version],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listWatchlists(ownerId: string, network: string): Promise<WatchlistRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlists WHERE owner_id = ? AND network = ? ORDER BY updated_at DESC LIMIT 200', [ownerId, network]);
    return (rows ?? []).map((row: any) => this.watchlist(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWatchlist(ownerId: string, network: string, watchlistId: string): Promise<WatchlistRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlists WHERE watchlist_id = ? AND owner_id = ? AND network = ? LIMIT 1', [watchlistId, ownerId, network]);
    return rows?.length ? this.watchlist(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countWatchlists(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_watchlists WHERE owner_id = ? AND network = ?', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteWatchlist(ownerId: string, network: string, watchlistId: string): Promise<boolean> {
    const [result]: any[] = await DB.query('DELETE FROM intelligence_watchlists WHERE watchlist_id = ? AND owner_id = ? AND network = ?', [watchlistId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async touchWatchlist(watchlistId: string, at: string): Promise<void> {
    await DB.query('UPDATE intelligence_watchlists SET updated_at = ?, version = version + 1 WHERE watchlist_id = ?', [toDate(at), watchlistId]);
  }

  private entity(row: any): WatchlistEntityRow {
    return {
      entity_id: row.entity_id, watchlist_id: row.watchlist_id, owner_id: row.owner_id, network: row.network, entity_type: row.entity_type,
      blinded_hash: row.blinded_hash, label: row.label, created_at: fromDate(row.created_at) as string,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertEntity(row: WatchlistEntityRow): Promise<'inserted' | 'duplicate'> {
    const [result]: any[] = await DB.query(
      'INSERT IGNORE INTO intelligence_watchlist_entities (entity_id, watchlist_id, owner_id, network, entity_type, blinded_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.entity_id, row.watchlist_id, row.owner_id, row.network, row.entity_type, row.blinded_hash, row.label, toDate(row.created_at)],
    );
    return Number(result?.affectedRows ?? 0) > 0 ? 'inserted' : 'duplicate';
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEntities(watchlistId: string): Promise<WatchlistEntityRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlist_entities WHERE watchlist_id = ? ORDER BY created_at ASC LIMIT 1000', [watchlistId]);
    return (rows ?? []).map((row: any) => this.entity(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countEntities(watchlistId: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_watchlist_entities WHERE watchlist_id = ?', [watchlistId]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteEntity(ownerId: string, network: string, watchlistId: string, entityId: string): Promise<boolean> {
    const [result]: any[] = await DB.query('DELETE FROM intelligence_watchlist_entities WHERE entity_id = ? AND watchlist_id = ? AND owner_id = ? AND network = ?', [entityId, watchlistId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEntitiesByType(network: string, entityType: string): Promise<WatchlistEntityRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlist_entities WHERE network = ? AND entity_type = ? LIMIT 100000', [network, entityType]);
    return (rows ?? []).map((row: any) => this.entity(row));
  }

  private rule(row: any): WatchlistRuleRow {
    return {
      rule_id: row.rule_id, watchlist_id: row.watchlist_id, owner_id: row.owner_id, network: row.network, condition_type: row.condition_type,
      threshold_value: row.threshold_value === null || row.threshold_value === undefined ? null : Number(row.threshold_value),
      delivery_channel: row.delivery_channel, webhook_id: row.webhook_id ?? null, enabled: Boolean(row.enabled), rate_limit_per_hour: Number(row.rate_limit_per_hour),
      created_at: fromDate(row.created_at) as string, version: Number(row.version),
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertRule(row: WatchlistRuleRow): Promise<void> {
    await DB.query(
      `INSERT INTO intelligence_watchlist_rules (rule_id, watchlist_id, owner_id, network, condition_type, threshold_value, delivery_channel, webhook_id, enabled, rate_limit_per_hour, created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.rule_id, row.watchlist_id, row.owner_id, row.network, row.condition_type, row.threshold_value, row.delivery_channel, row.webhook_id, row.enabled ? 1 : 0, row.rate_limit_per_hour, toDate(row.created_at), row.version],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listRules(watchlistId: string): Promise<WatchlistRuleRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlist_rules WHERE watchlist_id = ? ORDER BY created_at ASC LIMIT 200', [watchlistId]);
    return (rows ?? []).map((row: any) => this.rule(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countRules(watchlistId: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_watchlist_rules WHERE watchlist_id = ?', [watchlistId]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteRule(ownerId: string, network: string, watchlistId: string, ruleId: string): Promise<boolean> {
    const [result]: any[] = await DB.query('DELETE FROM intelligence_watchlist_rules WHERE rule_id = ? AND watchlist_id = ? AND owner_id = ? AND network = ?', [ruleId, watchlistId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEnabledRules(network: string): Promise<WatchlistRuleRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_watchlist_rules WHERE network = ? AND enabled = 1 LIMIT 100000', [network]);
    return (rows ?? []).map((row: any) => this.rule(row));
  }

  private savedQuery(row: any): SavedQueryRow {
    return { query_id: row.query_id, owner_id: row.owner_id, network: row.network, title: row.title, sql_text: row.sql_text, created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertSavedQuery(row: SavedQueryRow): Promise<void> {
    await DB.query(
      'INSERT INTO intelligence_saved_queries (query_id, owner_id, network, title, sql_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [row.query_id, row.owner_id, row.network, row.title, row.sql_text, toDate(row.created_at), toDate(row.updated_at)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listSavedQueries(ownerId: string, network: string, limit: number, before?: string): Promise<SavedQueryRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_saved_queries WHERE owner_id = ? AND network = ?' + (before ? ' AND query_id < ?' : '') + ' ORDER BY query_id DESC LIMIT ?', before ? [ownerId, network, before, limit] : [ownerId, network, limit]);
    return (rows ?? []).map((row: any) => this.savedQuery(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countSavedQueries(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_saved_queries WHERE owner_id = ? AND network = ?', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  private graphCase(row: any): GraphCaseRow {
    return { case_id: row.case_id, owner_id: row.owner_id, network: row.network, document: parseJson<Record<string, unknown>>(row.document, {}), created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertGraphCase(row: GraphCaseRow): Promise<void> {
    await DB.query(
      'INSERT INTO intelligence_graph_cases (case_id, owner_id, network, document, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.case_id, row.owner_id, row.network, JSON.stringify(row.document), toDate(row.created_at), toDate(row.updated_at)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateGraphCase(ownerId: string, network: string, caseId: string, document: Record<string, unknown>, at: string): Promise<boolean> {
    const [result]: any[] = await DB.query('UPDATE intelligence_graph_cases SET document = ?, updated_at = ? WHERE case_id = ? AND owner_id = ? AND network = ?', [JSON.stringify(document), toDate(at), caseId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listGraphCases(ownerId: string, network: string): Promise<GraphCaseRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_graph_cases WHERE owner_id = ? AND network = ? ORDER BY updated_at DESC LIMIT 200', [ownerId, network]);
    return (rows ?? []).map((row: any) => this.graphCase(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getGraphCase(ownerId: string, network: string, caseId: string): Promise<GraphCaseRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_graph_cases WHERE case_id = ? AND owner_id = ? AND network = ? LIMIT 1', [caseId, ownerId, network]);
    return rows?.length ? this.graphCase(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteGraphCase(ownerId: string, network: string, caseId: string): Promise<boolean> {
    const [result]: any[] = await DB.query('DELETE FROM intelligence_graph_cases WHERE case_id = ? AND owner_id = ? AND network = ?', [caseId, ownerId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countGraphCases(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_graph_cases WHERE owner_id = ? AND network = ?', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  private notification(row: any): NotificationRow {
    return {
      notification_id: row.notification_id, owner_id: row.owner_id, network: row.network, watchlist_id: row.watchlist_id, rule_id: row.rule_id, event_id: row.event_id,
      title: row.title, message: row.message, severity: row.severity, entity_type: row.entity_type, blinded_hash: row.blinded_hash,
      block_height: row.block_height === null || row.block_height === undefined ? null : Number(row.block_height), block_hash: row.block_hash ?? null,
      state: row.state, created_at: fromDate(row.created_at) as string, acknowledged_at: fromDate(row.acknowledged_at),
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertNotification(row: NotificationRow): Promise<'inserted' | 'duplicate'> {
    const [result]: any[] = await DB.query(
      `INSERT IGNORE INTO intelligence_notifications (notification_id, owner_id, network, watchlist_id, rule_id, event_id, title, message, severity, entity_type, blinded_hash, block_height, block_hash, state, created_at, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.notification_id, row.owner_id, row.network, row.watchlist_id, row.rule_id, row.event_id, row.title, row.message, row.severity, row.entity_type, row.blinded_hash, row.block_height, row.block_hash, row.state, toDate(row.created_at), toDate(row.acknowledged_at)],
    );
    return Number(result?.affectedRows ?? 0) > 0 ? 'inserted' : 'duplicate';
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]> {
    const [rows]: any[] = watchlistId
      ? await DB.query('SELECT * FROM intelligence_notifications WHERE owner_id = ? AND network = ? AND watchlist_id = ? ORDER BY created_at DESC LIMIT ?', [ownerId, network, watchlistId, limit])
      : await DB.query('SELECT * FROM intelligence_notifications WHERE owner_id = ? AND network = ? ORDER BY created_at DESC LIMIT ?', [ownerId, network, limit]);
    return (rows ?? []).map((row: any) => this.notification(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countNotificationsSince(ruleId: string, since: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_notifications WHERE rule_id = ? AND created_at >= ?', [ruleId, toDate(since)]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async acknowledgeNotification(ownerId: string, network: string, notificationId: string, at: string): Promise<boolean> {
    const [result]: any[] = await DB.query(
      `UPDATE intelligence_notifications SET state = 'acknowledged', acknowledged_at = ? WHERE notification_id = ? AND owner_id = ? AND network = ? AND state = 'open'`,
      [toDate(at), notificationId, ownerId, network],
    );
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listNotificationsAtHeight(network: string, blockHeight: number): Promise<NotificationRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_notifications WHERE network = ? AND block_height = ? LIMIT 10000', [network, blockHeight]);
    return (rows ?? []).map((row: any) => this.notification(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async displaceNotification(notificationId: string): Promise<void> {
    await DB.query(`UPDATE intelligence_notifications SET state = 'displaced' WHERE notification_id = ?`, [notificationId]);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getNotificationById(network: string, notificationId: string): Promise<NotificationRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_notifications WHERE notification_id = ? AND network = ? LIMIT 1', [notificationId, network]);
    return rows?.length ? this.notification(rows[0]) : null;
  }

  private knowledgeLabel(row: any): KnowledgeLabelRow {
    return { label_id: row.label_id, owner_id: row.owner_id, network: row.network, entity_type: row.entity_type, entity_id: row.entity_id, status: row.status, document: parseJson<Record<string, unknown>>(row.document, {}), created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertKnowledgeLabel(row: KnowledgeLabelRow): Promise<void> {
    await DB.query(
      'INSERT INTO intelligence_knowledge_labels (label_id, owner_id, network, entity_type, entity_id, status, document, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [row.label_id, row.owner_id, row.network, row.entity_type, row.entity_id, row.status, JSON.stringify(row.document), toDate(row.created_at), toDate(row.updated_at)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateKnowledgeLabel(network: string, labelId: string, status: string, document: Record<string, unknown>, at: string): Promise<boolean> {
    const [result]: any[] = await DB.query('UPDATE intelligence_knowledge_labels SET status = ?, document = ?, updated_at = ? WHERE label_id = ? AND network = ?', [status, JSON.stringify(document), toDate(at), labelId, network]);
    return Number(result?.affectedRows ?? 0) > 0;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listKnowledgeLabels(network: string, limit: number): Promise<KnowledgeLabelRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_knowledge_labels WHERE network = ? ORDER BY updated_at DESC LIMIT ?', [network, limit]);
    return (rows ?? []).map((row: any) => this.knowledgeLabel(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findKnowledgeLabelsByEntity(network: string, entityId: string): Promise<KnowledgeLabelRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_knowledge_labels WHERE network = ? AND entity_id = ? ORDER BY updated_at DESC LIMIT 50', [network, entityId]);
    return (rows ?? []).map((row: any) => this.knowledgeLabel(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getKnowledgeLabel(network: string, labelId: string): Promise<KnowledgeLabelRow | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_knowledge_labels WHERE label_id = ? AND network = ? LIMIT 1', [labelId, network]);
    return rows?.length ? this.knowledgeLabel(rows[0]) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countKnowledgeLabels(ownerId: string, network: string): Promise<number> {
    const [rows]: any[] = await DB.query('SELECT COUNT(*) AS n FROM intelligence_knowledge_labels WHERE owner_id = ? AND network = ?', [ownerId, network]);
    return Number(rows?.[0]?.n ?? 0);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertKnowledgeAudit(row: KnowledgeAuditRow): Promise<void> {
    await DB.query(
      'INSERT INTO intelligence_knowledge_audit (audit_id, label_id, network, action, actor_owner_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [row.audit_id, row.label_id, row.network, row.action, row.actor_owner_id, row.summary, toDate(row.created_at)],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listKnowledgeAudit(network: string, limit: number): Promise<KnowledgeAuditRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_knowledge_audit WHERE network = ? ORDER BY created_at DESC LIMIT ?', [network, limit]);
    return (rows ?? []).map((row: any) => ({ audit_id: row.audit_id, label_id: row.label_id, network: row.network, action: row.action, actor_owner_id: row.actor_owner_id, summary: row.summary, created_at: fromDate(row.created_at) as string }));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getCheckpoint(consumerId: string, network: string): Promise<MatcherCheckpoint | null> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_matcher_checkpoints WHERE consumer_id = ? AND network = ? LIMIT 1', [consumerId, network]);
    if (!rows?.length) { return null; }
    return { consumer_id: rows[0].consumer_id, network: rows[0].network, block_height: Number(rows[0].block_height), block_hash: rows[0].block_hash, updated_at: fromDate(rows[0].updated_at) as string };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async saveCheckpoint(checkpoint: MatcherCheckpoint): Promise<void> {
    await DB.query(
      `INSERT INTO intelligence_matcher_checkpoints (consumer_id, network, block_height, block_hash, updated_at) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE block_height = VALUES(block_height), block_hash = VALUES(block_hash), updated_at = VALUES(updated_at)`,
      [checkpoint.consumer_id, checkpoint.network, checkpoint.block_height, checkpoint.block_hash, toDate(checkpoint.updated_at)],
    );
  }

  private outbox(row: any): OutboxRow {
    return {
      outbox_id: row.outbox_id, notification_id: row.notification_id, webhook_id: row.webhook_id, network: row.network, state: row.state,
      attempt_count: Number(row.attempt_count), next_attempt_at: fromDate(row.next_attempt_at) as string, lease_until: fromDate(row.lease_until),
      last_error: row.last_error ?? null, created_at: fromDate(row.created_at) as string, updated_at: fromDate(row.updated_at) as string,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertOutbox(row: OutboxRow): Promise<'inserted' | 'duplicate'> {
    const [result]: any[] = await DB.query(
      `INSERT IGNORE INTO intelligence_delivery_outbox (outbox_id, notification_id, webhook_id, network, state, attempt_count, next_attempt_at, lease_until, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.outbox_id, row.notification_id, row.webhook_id, row.network, row.state, row.attempt_count, toDate(row.next_attempt_at), toDate(row.lease_until), row.last_error, toDate(row.created_at), toDate(row.updated_at)],
    );
    return Number(result?.affectedRows ?? 0) > 0 ? 'inserted' : 'duplicate';
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async claimOutbox(network: string, now: string, leaseUntil: string, limit: number): Promise<OutboxRow[]> {
    const token = randomUUID();
    // Two statements: lease the due rows under a fresh token, then read back exactly those rows.
    await DB.query(
      `UPDATE intelligence_delivery_outbox SET lease_until = ?, lease_token = ?, updated_at = ?
       WHERE network = ? AND state = 'pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?) LIMIT ?`,
      [toDate(leaseUntil), token, toDate(now), network, toDate(now), toDate(now), limit],
    );
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_delivery_outbox WHERE lease_token = ? LIMIT ?', [token, limit]);
    return (rows ?? []).map((row: any) => this.outbox(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string): Promise<void> {
    await DB.query(
      'UPDATE intelligence_delivery_outbox SET state = ?, attempt_count = ?, next_attempt_at = ?, lease_until = NULL, lease_token = NULL, last_error = ?, updated_at = ? WHERE outbox_id = ?',
      [state, attemptCount, toDate(nextAttemptAt), lastError, toDate(at), outboxId],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertAttempt(row: WebhookAttemptRow): Promise<void> {
    await DB.query(
      `INSERT INTO intelligence_webhook_attempts (attempt_id, outbox_id, webhook_id, event_id, attempt_number, started_at, finished_at, status_code, success, response_digest, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.attempt_id, row.outbox_id, row.webhook_id, row.event_id, row.attempt_number, toDate(row.started_at), toDate(row.finished_at), row.status_code, row.success ? 1 : 0, row.response_digest, row.error_code],
    );
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listAttempts(webhookId: string, limit: number): Promise<WebhookAttemptRow[]> {
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_webhook_attempts WHERE webhook_id = ? ORDER BY started_at DESC LIMIT ?', [webhookId, limit]);
    return (rows ?? []).map((row: any) => ({
      attempt_id: row.attempt_id, outbox_id: row.outbox_id, webhook_id: row.webhook_id, event_id: row.event_id, attempt_number: Number(row.attempt_number),
      started_at: fromDate(row.started_at) as string, finished_at: fromDate(row.finished_at) as string, status_code: row.status_code === null ? null : Number(row.status_code),
      success: Boolean(row.success), response_digest: row.response_digest ?? null, error_code: row.error_code ?? null,
    }));
  }
}

/** Process-local store: tests and database-less deployments. Nothing here survives a restart. */
export class MemoryOwnerStore implements OwnerStore {
  public readonly kind = 'memory' as const;
  private settings = new Map<string, string>();
  private keys = new Map<string, ApiKeyRow>();
  private webhooks = new Map<string, WebhookRow>();
  private watchlists = new Map<string, WatchlistRow>();
  private entities = new Map<string, WatchlistEntityRow>();
  private rules = new Map<string, WatchlistRuleRow>();
  private queries = new Map<string, SavedQueryRow>();
  private cases = new Map<string, GraphCaseRow>();
  private notifications = new Map<string, NotificationRow>();
  private checkpoints = new Map<string, MatcherCheckpoint>();
  private knowledgeLabels = new Map<string, KnowledgeLabelRow>();
  private knowledgeAudit: KnowledgeAuditRow[] = [];
  private outbox = new Map<string, OutboxRow>();
  private attempts: WebhookAttemptRow[] = [];

  private clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getSetting(name: string): Promise<string | null> { return this.settings.get(name) ?? null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async setSettingIfAbsent(name: string, value: string): Promise<string> { if (!this.settings.has(name)) { this.settings.set(name, value); } return this.settings.get(name) as string; }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertApiKey(row: ApiKeyRow): Promise<void> { this.keys.set(row.key_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findApiKeyByHash(hash: string): Promise<ApiKeyRow | null> { for (const key of this.keys.values()) { if (key.key_hash === hash) { return this.clone(key); } } return null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listApiKeys(ownerId: string, network: string): Promise<ApiKeyRow[]> { return [...this.keys.values()].filter(k => k.owner_id === ownerId && k.network === network).map(k => this.clone(k)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countApiKeys(ownerId: string, network: string): Promise<number> { return [...this.keys.values()].filter(k => k.owner_id === ownerId && k.network === network && !k.revoked_at).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async touchApiKey(keyId: string, at: string): Promise<void> { const key = this.keys.get(keyId); if (key) { key.last_used_at = at; } }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async revokeApiKey(ownerId: string, network: string, keyId: string, at: string): Promise<boolean> {
    const key = this.keys.get(keyId);
    if (!key || key.owner_id !== ownerId || key.network !== network || key.revoked_at) { return false; }
    key.revoked_at = at; return true;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertWebhook(row: WebhookRow): Promise<void> { this.webhooks.set(row.webhook_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listWebhooks(ownerId: string, network: string): Promise<WebhookRow[]> { return [...this.webhooks.values()].filter(w => w.owner_id === ownerId && w.network === network).map(w => this.clone(w)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWebhook(ownerId: string, network: string, webhookId: string): Promise<WebhookRow | null> { const w = this.webhooks.get(webhookId); return w && w.owner_id === ownerId && w.network === network ? this.clone(w) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWebhookById(network: string, webhookId: string): Promise<WebhookRow | null> { const w = this.webhooks.get(webhookId); return w && w.network === network ? this.clone(w) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countWebhooks(ownerId: string, network: string): Promise<number> { return (await this.listWebhooks(ownerId, network)).length; }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertWatchlist(row: WatchlistRow): Promise<void> { this.watchlists.set(row.watchlist_id, this.clone(row)); }
  public async insertWatchlistWithinQuota(row: WatchlistRow, limit: number): Promise<boolean> {
    if([...this.watchlists.values()].filter(value=>value.owner_id===row.owner_id&&value.network===row.network).length>=limit)return false;
    if(this.watchlists.has(row.watchlist_id))throw new Error('Duplicate watchlist ID');this.watchlists.set(row.watchlist_id,this.clone(row));return true;
  }
  public async insertEntityWithinQuota(row: WatchlistEntityRow, limit: number): Promise<'inserted'|'duplicate'|'quota'> {
    const rows=[...this.entities.values()].filter(value=>value.watchlist_id===row.watchlist_id&&value.owner_id===row.owner_id&&value.network===row.network);
    if(rows.some(value=>value.entity_type===row.entity_type&&value.blinded_hash===row.blinded_hash))return 'duplicate';
    if(rows.length>=limit)return 'quota';if(this.entities.has(row.entity_id))throw new Error('Duplicate entity ID');this.entities.set(row.entity_id,this.clone(row));return 'inserted';
  }
  public async insertRuleWithinQuota(row: WatchlistRuleRow, limit: number): Promise<boolean> {
    if([...this.rules.values()].filter(value=>value.watchlist_id===row.watchlist_id&&value.owner_id===row.owner_id&&value.network===row.network).length>=limit)return false;
    if(this.rules.has(row.rule_id))throw new Error('Duplicate rule ID');this.rules.set(row.rule_id,this.clone(row));return true;
  }
  public async insertSavedQueryWithinQuota(row: SavedQueryRow, limit: number): Promise<boolean> {
    if([...this.queries.values()].filter(value=>value.owner_id===row.owner_id&&value.network===row.network).length>=limit)return false;
    if(this.queries.has(row.query_id))throw new Error('Duplicate saved-query ID');this.queries.set(row.query_id,this.clone(row));return true;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listWatchlists(ownerId: string, network: string): Promise<WatchlistRow[]> { return [...this.watchlists.values()].filter(w => w.owner_id === ownerId && w.network === network).map(w => this.clone(w)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getWatchlist(ownerId: string, network: string, watchlistId: string): Promise<WatchlistRow | null> { const w = this.watchlists.get(watchlistId); return w && w.owner_id === ownerId && w.network === network ? this.clone(w) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countWatchlists(ownerId: string, network: string): Promise<number> { return (await this.listWatchlists(ownerId, network)).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteWatchlist(ownerId: string, network: string, watchlistId: string): Promise<boolean> {
    const w = this.watchlists.get(watchlistId);
    if (!w || w.owner_id !== ownerId || w.network !== network) { return false; }
    this.watchlists.delete(watchlistId);
    for (const [id, entity] of this.entities) { if (entity.watchlist_id === watchlistId) { this.entities.delete(id); } }
    for (const [id, rule] of this.rules) { if (rule.watchlist_id === watchlistId) { this.rules.delete(id); } }
    return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async touchWatchlist(watchlistId: string, at: string): Promise<void> { const w = this.watchlists.get(watchlistId); if (w) { w.updated_at = at; w.version += 1; } }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertEntity(row: WatchlistEntityRow): Promise<'inserted' | 'duplicate'> {
    for (const entity of this.entities.values()) {
      if (entity.watchlist_id === row.watchlist_id && entity.entity_type === row.entity_type && entity.blinded_hash === row.blinded_hash) { return 'duplicate'; }
    }
    this.entities.set(row.entity_id, this.clone(row)); return 'inserted';
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEntities(watchlistId: string): Promise<WatchlistEntityRow[]> { return [...this.entities.values()].filter(e => e.watchlist_id === watchlistId).map(e => this.clone(e)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countEntities(watchlistId: string): Promise<number> { return (await this.listEntities(watchlistId)).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteEntity(ownerId: string, network: string, watchlistId: string, entityId: string): Promise<boolean> {
    const e = this.entities.get(entityId);
    if (!e || e.watchlist_id !== watchlistId || e.owner_id !== ownerId || e.network !== network) { return false; }
    this.entities.delete(entityId);
    return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEntitiesByType(network: string, entityType: string): Promise<WatchlistEntityRow[]> { return [...this.entities.values()].filter(e => e.network === network && e.entity_type === entityType).map(e => this.clone(e)); }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertRule(row: WatchlistRuleRow): Promise<void> { this.rules.set(row.rule_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listRules(watchlistId: string): Promise<WatchlistRuleRow[]> { return [...this.rules.values()].filter(r => r.watchlist_id === watchlistId).map(r => this.clone(r)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countRules(watchlistId: string): Promise<number> { return (await this.listRules(watchlistId)).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteRule(ownerId: string, network: string, watchlistId: string, ruleId: string): Promise<boolean> {
    const r = this.rules.get(ruleId);
    if (!r || r.watchlist_id !== watchlistId || r.owner_id !== ownerId || r.network !== network) { return false; }
    this.rules.delete(ruleId);
    return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listEnabledRules(network: string): Promise<WatchlistRuleRow[]> { return [...this.rules.values()].filter(r => r.network === network && r.enabled).map(r => this.clone(r)); }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertSavedQuery(row: SavedQueryRow): Promise<void> { this.queries.set(row.query_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listSavedQueries(ownerId: string, network: string, limit: number, before?: string): Promise<SavedQueryRow[]> { return [...this.queries.values()].filter(q => q.owner_id === ownerId && q.network === network && (!before || q.query_id < before)).sort((a,b)=>b.query_id.localeCompare(a.query_id)).slice(0, limit).map(q => this.clone(q)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countSavedQueries(ownerId: string, network: string): Promise<number> { return (await this.listSavedQueries(ownerId, network, 100000)).length; }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertGraphCase(row: GraphCaseRow): Promise<void> { this.cases.set(row.case_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateGraphCase(ownerId: string, network: string, caseId: string, document: Record<string, unknown>, at: string): Promise<boolean> {
    const c = this.cases.get(caseId);
    if (!c || c.owner_id !== ownerId || c.network !== network) { return false; }
    c.document = this.clone(document); c.updated_at = at; return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listGraphCases(ownerId: string, network: string): Promise<GraphCaseRow[]> { return [...this.cases.values()].filter(c => c.owner_id === ownerId && c.network === network).map(c => this.clone(c)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getGraphCase(ownerId: string, network: string, caseId: string): Promise<GraphCaseRow | null> { const c = this.cases.get(caseId); return c && c.owner_id === ownerId && c.network === network ? this.clone(c) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteGraphCase(ownerId: string, network: string, caseId: string): Promise<boolean> { const c = this.cases.get(caseId); if (!c || c.owner_id !== ownerId || c.network !== network) { return false; } this.cases.delete(caseId); return true; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countGraphCases(ownerId: string, network: string): Promise<number> { return (await this.listGraphCases(ownerId, network)).length; }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertNotification(row: NotificationRow): Promise<'inserted' | 'duplicate'> {
    for (const n of this.notifications.values()) { if (n.rule_id === row.rule_id && n.event_id === row.event_id) { return 'duplicate'; } }
    this.notifications.set(row.notification_id, this.clone(row)); return 'inserted';
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]> {
    return [...this.notifications.values()].filter(n => n.owner_id === ownerId && n.network === network && (watchlistId === null || n.watchlist_id === watchlistId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(n => this.clone(n));
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countNotificationsSince(ruleId: string, since: string): Promise<number> { return [...this.notifications.values()].filter(n => n.rule_id === ruleId && n.created_at >= since).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async acknowledgeNotification(ownerId: string, network: string, notificationId: string, at: string): Promise<boolean> {
    const n = this.notifications.get(notificationId);
    if (!n || n.owner_id !== ownerId || n.network !== network || n.state !== 'open') { return false; }
    n.state = 'acknowledged'; n.acknowledged_at = at; return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listNotificationsAtHeight(network: string, blockHeight: number): Promise<NotificationRow[]> { return [...this.notifications.values()].filter(n => n.network === network && n.block_height === blockHeight).map(n => this.clone(n)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async displaceNotification(notificationId: string): Promise<void> { const n = this.notifications.get(notificationId); if (n) { n.state = 'displaced'; } }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getNotificationById(network: string, notificationId: string): Promise<NotificationRow | null> { const n = this.notifications.get(notificationId); return n && n.network === network ? this.clone(n) : null; }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertKnowledgeLabel(row: KnowledgeLabelRow): Promise<void> { this.knowledgeLabels.set(row.label_id, this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateKnowledgeLabel(network: string, labelId: string, status: string, document: Record<string, unknown>, at: string): Promise<boolean> {
    const row = this.knowledgeLabels.get(labelId);
    if (!row || row.network !== network) { return false; }
    row.status = status; row.document = this.clone(document); row.updated_at = at; return true;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listKnowledgeLabels(network: string, limit: number): Promise<KnowledgeLabelRow[]> { return [...this.knowledgeLabels.values()].filter(r => r.network === network).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, limit).map(r => this.clone(r)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async findKnowledgeLabelsByEntity(network: string, entityId: string): Promise<KnowledgeLabelRow[]> { return [...this.knowledgeLabels.values()].filter(r => r.network === network && r.entity_id === entityId).map(r => this.clone(r)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getKnowledgeLabel(network: string, labelId: string): Promise<KnowledgeLabelRow | null> { const r = this.knowledgeLabels.get(labelId); return r && r.network === network ? this.clone(r) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countKnowledgeLabels(ownerId: string, network: string): Promise<number> { return [...this.knowledgeLabels.values()].filter(r => r.owner_id === ownerId && r.network === network).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertKnowledgeAudit(row: KnowledgeAuditRow): Promise<void> { this.knowledgeAudit.unshift(this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listKnowledgeAudit(network: string, limit: number): Promise<KnowledgeAuditRow[]> { return this.knowledgeAudit.filter(r => r.network === network).slice(0, limit).map(r => this.clone(r)); }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getCheckpoint(consumerId: string, network: string): Promise<MatcherCheckpoint | null> { const c = this.checkpoints.get(`${consumerId}:${network}`); return c ? this.clone(c) : null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async saveCheckpoint(checkpoint: MatcherCheckpoint): Promise<void> { this.checkpoints.set(`${checkpoint.consumer_id}:${checkpoint.network}`, this.clone(checkpoint)); }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertOutbox(row: OutboxRow): Promise<'inserted' | 'duplicate'> {
    for (const o of this.outbox.values()) { if (o.notification_id === row.notification_id && o.webhook_id === row.webhook_id) { return 'duplicate'; } }
    this.outbox.set(row.outbox_id, this.clone(row)); return 'inserted';
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async claimOutbox(network: string, now: string, leaseUntil: string, limit: number): Promise<OutboxRow[]> {
    const claimed: OutboxRow[] = [];
    for (const o of this.outbox.values()) {
      if (claimed.length >= limit) { break; }
      if (o.network === network && o.state === 'pending' && o.next_attempt_at <= now && (o.lease_until === null || o.lease_until < now)) {
        o.lease_until = leaseUntil; claimed.push(this.clone(o));
      }
    }
    return claimed;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string): Promise<void> {
    const o = this.outbox.get(outboxId);
    if (o) { o.state = state; o.attempt_count = attemptCount; o.next_attempt_at = nextAttemptAt; o.lease_until = null; o.last_error = lastError; o.updated_at = at; }
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async insertAttempt(row: WebhookAttemptRow): Promise<void> { this.attempts.push(this.clone(row)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listAttempts(webhookId: string, limit: number): Promise<WebhookAttemptRow[]> { return this.attempts.filter(a => a.webhook_id === webhookId).slice(-limit).reverse().map(a => this.clone(a)); }
}

let selected: OwnerStore | null = null;

export function ownerStore(): OwnerStore {
  if (!selected) {
    if (config.DATABASE.ENABLED === true) {
      selected = new MysqlOwnerStore();
    } else {
      logger.warn('Intelligence owner state is kept in memory because config.DATABASE.ENABLED is false; keys, watchlists and notifications do not survive a restart.');
      selected = new MemoryOwnerStore();
    }
  }
  return selected;
}

/** Test seam: swap the store for a process-local one. */
export function useOwnerStore(store: OwnerStore | null): void {
  selected = store;
}
