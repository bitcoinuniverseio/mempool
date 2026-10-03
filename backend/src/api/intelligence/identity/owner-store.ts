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

export interface WatchlistScriptRow { entity_id: string; owner_id: string; network: string; script_hash: string; derivation_index: number; }

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
  lease_token?: string | null;
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
  findApiKeyByHash(hash: string, network: string): Promise<ApiKeyRow | null>;
  listApiKeys(ownerId: string, network: string): Promise<ApiKeyRow[]>;
  countApiKeys(ownerId: string, network: string): Promise<number>;
  touchApiKey(keyId: string, at: string, network: string): Promise<void>;
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
  insertDescriptorWithinQuota(row: WatchlistEntityRow, scripts: WatchlistScriptRow[], limit: number): Promise<'inserted' | 'duplicate' | 'quota'>;
  listDescriptorScripts(network: string): Promise<WatchlistScriptRow[]>;
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
  recordNotificationWithDelivery(row: NotificationRow, webhookId: string | null, hourlyLimit: number): Promise<'inserted' | 'duplicate' | 'rate_limited'>;
  listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]>;
  listNotificationsAfter(ownerId: string, network: string, cursor: string | null, limit: number): Promise<NotificationRow[]>;
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
  completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string, leaseToken: string, network: string): Promise<boolean>;
  renewOutbox(outboxId: string, network: string, leaseToken: string, now: string, leaseUntil: string): Promise<boolean>;
  finishOutbox(row: OutboxRow, attempt: WebhookAttemptRow, state: OutboxRow['state'], nextAttemptAt: string): Promise<boolean>;
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
  public async findApiKeyByHash(hash: string, network: string): Promise<ApiKeyRow | null> {
    /* IMPLEMENTATION-HANDOFF [WP-BI-001] DEF-BI-001; COV-BI-001A/B.
     * Verified: this read ignores the stored network; the memory implementation
     * does the same. See developer-identity.ts authenticateKey for the shared contract.
     * 1. Change the OwnerStore signature to findApiKeyByHash(hash, network), bind both
     *    values in SQL, and implement identical filtering in MemoryOwnerStore.
     * 2. Scope touchApiKey to the authenticated network too; retain existing unique
     *    key_hash and row.network data. Add a migration only if an inspected query
     *    plan establishes an index need, not to duplicate credential records.
     * 3. Add a real-MySQL same-hash lookup regression across distinct requested
     *    networks and assert a wrong-network attempt cannot update last_used_at.
     * Dependency: WP-BI-001 auth contract and WP-FE-008 client key partition.
     * Test command: cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/identity/developer-identity.test.ts
     * Real-MySQL test prerequisites/commands remain to be supplied by the isolated DB
     *    fixture; no live database verification was performed during preparation.
     * Rollback preserves credential records and the network rejection boundary.
     */
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_api_keys WHERE key_hash = ? AND network = ? LIMIT 1', [hash, network]);
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
  public async touchApiKey(keyId: string, at: string, network: string): Promise<void> {
    await DB.query('UPDATE intelligence_api_keys SET last_used_at = ? WHERE key_id = ? AND network = ?', [toDate(at), keyId, network], 'silent');
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
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async insertWatchlistWithinQuota(row: WatchlistRow, limit: number): Promise<boolean> {
    return await this.quotaInsert(row,'intelligence_watchlists',['watchlist_id','owner_id','network','name','privacy_mode','created_at','updated_at','version'],[row.watchlist_id,row.owner_id,row.network,row.name,row.privacy_mode,toDate(row.created_at),toDate(row.updated_at),row.version],'owner_id = ? AND network = ?',[row.owner_id,row.network],limit)==='inserted';
  }
  public async insertEntityWithinQuota(row: WatchlistEntityRow, limit: number): Promise<'inserted'|'duplicate'|'quota'> {
    return this.quotaInsert(row,'intelligence_watchlist_entities',['entity_id','watchlist_id','owner_id','network','entity_type','blinded_hash','label','created_at'],[row.entity_id,row.watchlist_id,row.owner_id,row.network,row.entity_type,row.blinded_hash,row.label,toDate(row.created_at)],'watchlist_id = ? AND owner_id = ? AND network = ?',[row.watchlist_id,row.owner_id,row.network],limit,{where:'watchlist_id = ? AND entity_type = ? AND blinded_hash = ?',values:[row.watchlist_id,row.entity_type,row.blinded_hash]});
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async insertRuleWithinQuota(row: WatchlistRuleRow, limit: number): Promise<boolean> {
    return await this.quotaInsert(row,'intelligence_watchlist_rules',['rule_id','watchlist_id','owner_id','network','condition_type','threshold_value','delivery_channel','webhook_id','enabled','rate_limit_per_hour','created_at','version'],[row.rule_id,row.watchlist_id,row.owner_id,row.network,row.condition_type,row.threshold_value,row.delivery_channel,row.webhook_id,row.enabled?1:0,row.rate_limit_per_hour,toDate(row.created_at),row.version],'watchlist_id = ? AND owner_id = ? AND network = ?',[row.watchlist_id,row.owner_id,row.network],limit)==='inserted';
  }
  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
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
  public async insertDescriptorWithinQuota(row: WatchlistEntityRow, scripts: WatchlistScriptRow[], limit: number): Promise<'inserted' | 'duplicate' | 'quota'> {
    return DB.$transaction(/** @asyncUnsafe The database transaction owns rollback and callers handle rejection. */ async connection => {
      const query = (sql: string, values: unknown[]) => DB.query<any>(sql, values, 'debug', connection);
      const lock=createHash('sha256').update('owner-quota:'+JSON.stringify([row.owner_id,row.network])).digest('hex');
      await query('INSERT INTO intelligence_settings (name,value,created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=name',[lock,'quota-lock',new Date()]);
      await query('SELECT value FROM intelligence_settings WHERE name = ? FOR UPDATE',[lock]);
      const [parents] = await query('SELECT watchlist_id FROM intelligence_watchlists WHERE watchlist_id = ? AND owner_id = ? AND network = ? FOR UPDATE', [row.watchlist_id,row.owner_id,row.network]);
      if (!parents.length) throw new Error('Watchlist unavailable');
      const [existing] = await query('SELECT entity_id FROM intelligence_watchlist_entities WHERE watchlist_id = ? AND entity_type = ? AND blinded_hash = ?', [row.watchlist_id,row.entity_type,row.blinded_hash]);
      if (existing.length) return 'duplicate';
      const [counts] = await query('SELECT COUNT(*) AS n FROM intelligence_watchlist_entities WHERE watchlist_id = ?', [row.watchlist_id]);
      if (Number(counts[0].n) >= limit) return 'quota';
      await query('INSERT INTO intelligence_watchlist_entities (entity_id, watchlist_id, owner_id, network, entity_type, blinded_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [row.entity_id,row.watchlist_id,row.owner_id,row.network,row.entity_type,row.blinded_hash,row.label,toDate(row.created_at)]);
      for (const script of scripts) await query('INSERT INTO intelligence_watchlist_entity_scripts (entity_id,owner_id,network,script_hash,derivation_index) VALUES (?, ?, ?, ?, ?)', [row.entity_id,row.owner_id,row.network,script.script_hash,script.derivation_index]);
      return 'inserted';
    });
  }
  /** @asyncUnsafe Callers handle database failure. */
  public async listDescriptorScripts(network: string): Promise<WatchlistScriptRow[]> {
    const [rows]: any[] = await DB.query('SELECT s.* FROM intelligence_watchlist_entity_scripts s JOIN intelligence_watchlist_entities e ON e.entity_id = s.entity_id AND e.network = s.network AND e.owner_id = s.owner_id WHERE s.network = ?', [network]);
    return rows.map((row: any) => ({...row, derivation_index:Number(row.derivation_index)}));
  }

  /** @asyncUnsafe Callers handle database failure. */
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
    /* IMPLEMENTATION-HANDOFF [WP-BI-002] DEF-BI-002; COV-BI-002A/B/C.
     * Verified: WatchlistMatcher.record commits this INSERT before a separate
     * insertOutbox; failure between them permanently loses webhook work on replay.
     * Requirement: docs/api/OWNER-IDENTITY.md Webhooks; MySQL 8.4 transaction semantics.
     * 1. Add OwnerStore.recordNotificationWithDelivery (PROPOSED NEW method), with
     *    the notification and optional verified webhook target in one DB transaction.
     *    Lock/resolve the existing row by (rule_id,event_id), retain its notification_id,
     *    verify owner/network equality with rule and webhook, and insert missing
     *    outbox intent under the existing unique (notification_id,webhook_id) key.
     * 2. Mirror atomic outcomes in MemoryOwnerStore. Return inserted/duplicate and
     *    durable delivery intent separately so the matcher advances only after commit.
     *    Do not treat duplicate notification insertion as permission to skip intent.
     * 3. Reconcile existing webhook-rule notifications lacking outbox rows in bounded,
     *    owner/network-scoped batches; dry-run counts first and exclude disabled or
     *    missing targets with an operator-visible reason. Never mark them delivered.
     * Dependencies: WP-BI-001 owner scope; WP-BI-003 fenced delivery follows this commit.
     * Tests: watchlists/watchlists.test.ts and PROPOSED NEW
     *    identity/owner-store-outbox.integration.test.ts. Inject rollback before/after
     *    each statement; replay the block after restart; expect one notification and
     *    one intent, one receiver-side effect by notification_id, foreign target denied.
     * Existing command: cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/watchlists/watchlists.test.ts
     * MySQL crash/restart and Signet UI-to-receiver acceptance are NOT TESTED.
     * Rollback: stop producers/consumers, retain intent rows and reconciliation cursor;
     *    never delete audit history or re-send an already acknowledged delivery blindly.
     */
    return DB.$transaction(/** @asyncUnsafe The database transaction owns rollback and callers handle rejection. */ async connection => {
      const lock=createHash('sha256').update('owner-quota:'+JSON.stringify([row.owner_id,row.network])).digest('hex');
      await DB.query('INSERT INTO intelligence_settings (name,value,created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=name',[lock,'quota-lock',new Date()],'debug',connection);
      await DB.query('SELECT value FROM intelligence_settings WHERE name = ? FOR UPDATE',[lock],'debug',connection);
    const [result]: any[] = await DB.query(
      `INSERT IGNORE INTO intelligence_notifications (notification_id, owner_id, network, watchlist_id, rule_id, event_id, title, message, severity, entity_type, blinded_hash, block_height, block_hash, state, created_at, acknowledged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.notification_id, row.owner_id, row.network, row.watchlist_id, row.rule_id, row.event_id, row.title, row.message, row.severity, row.entity_type, row.blinded_hash, row.block_height, row.block_hash, row.state, toDate(row.created_at), toDate(row.acknowledged_at)], 'debug', connection,
    );
    return Number(result?.affectedRows ?? 0) > 0 ? 'inserted' : 'duplicate';
    });
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async recordNotificationWithDelivery(row: NotificationRow, webhookId: string | null, hourlyLimit: number): Promise<'inserted' | 'duplicate' | 'rate_limited'> {
    return DB.$transaction(/** @asyncUnsafe The database transaction owns rollback and callers handle rejection. */ async connection => {
      const query = (sql: string, values: unknown[]) => DB.query<any>(sql, values, 'debug', connection);
      // Serialize allocation through commit for this owner's stream. AUTO_INCREMENT
      // alone does not order commits from concurrent rule transactions.
      const ownerLock=createHash('sha256').update('owner-quota:'+JSON.stringify([row.owner_id,row.network])).digest('hex');
      await query('INSERT INTO intelligence_settings (name,value,created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name=name',[ownerLock,'quota-lock',new Date()]);
      await query('SELECT value FROM intelligence_settings WHERE name = ? FOR UPDATE',[ownerLock]);
      // The rule lock serializes quota decisions and registration changes across workers.
      const [rules] = await query('SELECT * FROM intelligence_watchlist_rules WHERE rule_id = ? AND owner_id = ? AND network = ? AND watchlist_id = ? FOR UPDATE', [row.rule_id, row.owner_id, row.network, row.watchlist_id]);
      if (!rules.length || !rules[0].enabled) throw new Error('Notification rule unavailable');
      if (webhookId) {
        const [targets] = await query('SELECT webhook_id FROM intelligence_webhooks WHERE webhook_id = ? AND owner_id = ? AND network = ? AND active = 1 FOR UPDATE', [webhookId, row.owner_id, row.network]);
        if (!targets.length || rules[0].webhook_id !== webhookId || rules[0].delivery_channel !== 'webhook') throw new Error('Notification delivery target unavailable');
      }
      const [existing] = await query('SELECT * FROM intelligence_notifications WHERE rule_id = ? AND event_id = ? FOR UPDATE', [row.rule_id, row.event_id]);
      if (existing.length && (existing[0].owner_id !== row.owner_id || existing[0].network !== row.network)) throw new Error('Notification scope mismatch');
      let id = existing[0]?.notification_id;
      if (!id) {
        const [counts] = await query('SELECT COUNT(*) AS n FROM intelligence_notifications WHERE rule_id = ? AND network = ? AND created_at >= ?', [row.rule_id, row.network, new Date(Date.parse(row.created_at) - 3600000)]);
        if (Number(counts[0].n) >= Math.min(hourlyLimit,Number(rules[0].rate_limit_per_hour))) return 'rate_limited';
        id = row.notification_id;
        await query(`INSERT INTO intelligence_notifications (notification_id, owner_id, network, watchlist_id, rule_id, event_id, title, message, severity, entity_type, blinded_hash, block_height, block_hash, state, created_at, acknowledged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, row.owner_id, row.network, row.watchlist_id, row.rule_id, row.event_id, row.title, row.message, row.severity, row.entity_type, row.blinded_hash, row.block_height, row.block_hash, row.state, toDate(row.created_at), toDate(row.acknowledged_at)]);
      }
      if (webhookId) await query(`INSERT INTO intelligence_delivery_outbox (outbox_id, notification_id, webhook_id, network, state, attempt_count, next_attempt_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?) ON DUPLICATE KEY UPDATE outbox_id = outbox_id`, [randomUUID(), id, webhookId, row.network, toDate(row.created_at), toDate(row.created_at), toDate(row.created_at)]);
      return existing.length ? 'duplicate' : 'inserted';
    });
  }

  /** @asyncUnsafe Callers handle database failure. */
  public async listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]> {
    const [rows]: any[] = watchlistId
      ? await DB.query('SELECT * FROM intelligence_notifications WHERE owner_id = ? AND network = ? AND watchlist_id = ? ORDER BY created_at DESC LIMIT ?', [ownerId, network, watchlistId, limit])
      : await DB.query('SELECT * FROM intelligence_notifications WHERE owner_id = ? AND network = ? ORDER BY created_at DESC LIMIT ?', [ownerId, network, limit]);
    return (rows ?? []).map((row: any) => this.notification(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  /** Operator repair: inspect first; only eligible missing intents are reconciled. */
  /** @asyncUnsafe The caller handles database rejection. */
  public async reconcileNotificationDeliveries(network: string, limit = 100, dryRun = true): Promise<{eligible:number;repaired:number;excluded:number}> {
    if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new Error('Invalid reconciliation bound');
    const [rows]: any[] = await DB.query(`SELECT n.*, r.webhook_id AS target, r.enabled AS rule_enabled, r.rate_limit_per_hour, w.active AS target_active, w.owner_id AS target_owner, w.network AS target_network FROM intelligence_notifications n JOIN intelligence_watchlist_rules r ON r.rule_id = n.rule_id AND r.owner_id = n.owner_id AND r.network = n.network LEFT JOIN intelligence_webhooks w ON w.webhook_id = r.webhook_id LEFT JOIN intelligence_delivery_outbox o ON o.notification_id = n.notification_id AND o.webhook_id = r.webhook_id WHERE n.network = ? AND r.delivery_channel = 'webhook' AND o.outbox_id IS NULL ORDER BY n.notification_sequence LIMIT ?`,[network,limit]);
    const result={eligible:0,repaired:0,excluded:0};
    for(const row of rows){
      if(!row.rule_enabled||!row.target_active||row.target_owner!==row.owner_id||row.target_network!==row.network){result.excluded++;continue;}
      result.eligible++;
      if(!dryRun){await this.recordNotificationWithDelivery(this.notification(row),row.target,Number(row.rate_limit_per_hour));result.repaired++;}
    }
    return result;
  }

  /** @asyncUnsafe The caller handles database rejection. */
  public async listNotificationsAfter(ownerId: string, network: string, cursor: string | null, limit: number): Promise<NotificationRow[]> {
    let sequence: string | number = 0;
    if (cursor) {
      const [owned]: any[] = await DB.query('SELECT notification_sequence FROM intelligence_notifications WHERE notification_id = ? AND owner_id = ? AND network = ?', [cursor,ownerId,network]);
      if (!owned.length) throw new Error('invalid_notification_cursor');
      sequence = owned[0].notification_sequence;
    }
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_notifications WHERE owner_id = ? AND network = ? AND notification_sequence > ? ORDER BY notification_sequence LIMIT ?', [ownerId,network,sequence,limit]);
    return rows.map((row: any)=>this.notification(row));
  }
  /** @asyncUnsafe The caller handles database rejection. */
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
      attempt_count: Number(row.attempt_count), next_attempt_at: fromDate(row.next_attempt_at) as string, lease_until: fromDate(row.lease_until), lease_token: row.lease_token ?? null,
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
    /* IMPLEMENTATION-HANDOFF [WP-BI-003] DEF-BI-003; COV-BI-003A/B/C/D.
     * Verified: SQL stores a lease_token, outbox() discards it, and completeOutbox
     * updates by ID alone. An old worker can overwrite a new worker's delivered state.
     * See developer-identity.ts processOutbox/httpsTransport for the expired-batch cause.
     * 1. Include lease_token in OutboxRow and every SQL/memory mapping. Claim only
     *    immediately executable rows and return the fresh token plus lease expiry.
     * 2. Add token-fenced renewal and completion: WHERE outbox_id=?, network=?,
     *    state='pending', lease_token=? and lease still current. Require affectedRows=1;
     *    on zero, stop processing and report lost lease without altering newer state.
     * 3. Reserve/increment attempt_number under the same fence and persist the attempt
     *    outcome with completion atomically; uphold the existing unique outbox/attempt
     *    index. A stale completion must never regress a terminal state or consume retry
     *    budget twice. Match MemoryOwnerStore behavior and preserve receiver deduplication.
     * Dependencies: WP-BI-002 durable intent first; existing migration already defines
     *    lease_token. Inspect legacy pending rows before enabling the new worker.
     * Governing source: MySQL 8.4 locking reads, docs/api/OWNER-IDENTITY.md leased outbox.
     * Tests: extend identity/developer-identity.test.ts; PROPOSED NEW
     *    identity/owner-store-outbox.integration.test.ts with two DB connections,
     *    expired A/reclaimed B/B-success/A-late-failure, crash before completion and
     *    exactly one receiver-side notification effect. No public-chain fault injection.
     * Command for existing suite: cd backend && ./node_modules/.bin/jest --runInBand
     *    --coverage=false --runTestsByPath src/api/intelligence/identity/developer-identity.test.ts
     * Rollback: drain/fence all workers before version change; retain attempts and tokens.
     */
    await DB.query("UPDATE intelligence_delivery_outbox SET state = 'failed', last_error = 'attempt_limit_recovery', lease_token = NULL, lease_until = NULL, updated_at = ? WHERE network = ? AND state = 'pending' AND attempt_count >= 8 AND (lease_until IS NULL OR lease_until < ?)",[toDate(now),network,toDate(now)]);
    const token = randomUUID();
    // Two statements: lease the due rows under a fresh token, then read back exactly those rows.
    await DB.query(
      `UPDATE intelligence_delivery_outbox SET lease_until = ?, lease_token = ?, updated_at = ?, attempt_count = attempt_count + 1
       WHERE network = ? AND state = 'pending' AND attempt_count < 8 AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?) LIMIT ?`,
      [toDate(leaseUntil), token, toDate(now), network, toDate(now), toDate(now), limit],
    );
    const [rows]: any[] = await DB.query('SELECT * FROM intelligence_delivery_outbox WHERE lease_token = ? LIMIT ?', [token, limit]);
    return (rows ?? []).map((row: any) => this.outbox(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string, leaseToken: string, network: string): Promise<boolean> {
    const [result]: any[] = await DB.query("UPDATE intelligence_delivery_outbox SET state = ?, next_attempt_at = ?, lease_until = NULL, lease_token = NULL, last_error = ?, updated_at = ? WHERE outbox_id = ? AND network = ? AND state = 'pending' AND lease_token = ? AND lease_until > ? AND attempt_count = ?", [state, toDate(nextAttemptAt), lastError, toDate(at), outboxId, network, leaseToken, toDate(at), attemptCount]);
    return result.affectedRows === 1;
  }

  /** @asyncUnsafe Callers handle database failure. */
  public async renewOutbox(outboxId: string, network: string, leaseToken: string, now: string, leaseUntil: string): Promise<boolean> {
    const [result]: any[] = await DB.query("UPDATE intelligence_delivery_outbox SET lease_until = ? WHERE outbox_id = ? AND network = ? AND state = 'pending' AND lease_token = ? AND lease_until > ?", [toDate(leaseUntil), outboxId, network, leaseToken, toDate(now)]);
    return result.affectedRows === 1;
  }

  public async finishOutbox(row: OutboxRow, attempt: WebhookAttemptRow, state: OutboxRow['state'], nextAttemptAt: string): Promise<boolean> {
    return DB.$transaction(/** @asyncUnsafe The database transaction owns rollback and callers handle rejection. */ async connection => {
      // Preserve the actual outcome even when a later worker owns completion.
      await DB.query(`INSERT INTO intelligence_webhook_attempts (attempt_id, outbox_id, webhook_id, event_id, attempt_number, started_at, finished_at, status_code, success, response_digest, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE attempt_id = attempt_id`, [attempt.attempt_id, attempt.outbox_id, attempt.webhook_id, attempt.event_id, attempt.attempt_number, toDate(attempt.started_at), toDate(attempt.finished_at), attempt.status_code, attempt.success ? 1 : 0, attempt.response_digest, attempt.error_code], 'debug', connection);
      const [result]: any[] = await DB.query("UPDATE intelligence_delivery_outbox SET state = ?, next_attempt_at = ?, lease_until = NULL, lease_token = NULL, last_error = ?, updated_at = ? WHERE outbox_id = ? AND network = ? AND state = 'pending' AND lease_token = ? AND lease_until > ? AND attempt_count = ?", [state, toDate(nextAttemptAt), attempt.error_code, toDate(attempt.finished_at), row.outbox_id, row.network, row.lease_token, toDate(attempt.finished_at), attempt.attempt_number], 'debug', connection);
      return result.affectedRows === 1;
    });
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
  private notificationSequence = 0;
  private notificationOrder = new Map<string,number>();
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
  public async findApiKeyByHash(hash: string, network: string): Promise<ApiKeyRow | null> { for (const key of this.keys.values()) { if (key.key_hash === hash && key.network === network) { return this.clone(key); } } return null; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async listApiKeys(ownerId: string, network: string): Promise<ApiKeyRow[]> { return [...this.keys.values()].filter(k => k.owner_id === ownerId && k.network === network).map(k => this.clone(k)); }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async countApiKeys(ownerId: string, network: string): Promise<number> { return [...this.keys.values()].filter(k => k.owner_id === ownerId && k.network === network && !k.revoked_at).length; }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async touchApiKey(keyId: string, at: string, network: string): Promise<void> { const key = this.keys.get(keyId); if (key && key.network === network) { key.last_used_at = at; } }
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
  private scripts = new Map<string, WatchlistScriptRow[]>();
  public async insertDescriptorWithinQuota(row: WatchlistEntityRow, scripts: WatchlistScriptRow[], limit: number): Promise<'inserted' | 'duplicate' | 'quota'> {
    const parent = this.watchlists.get(row.watchlist_id);
    if (!parent || parent.owner_id !== row.owner_id || parent.network !== row.network) throw new Error('Watchlist unavailable');
    const rows = [...this.entities.values()].filter(value => value.watchlist_id === row.watchlist_id);
    if (rows.some(value => value.entity_type === row.entity_type && value.blinded_hash === row.blinded_hash)) return 'duplicate';
    if (rows.length >= limit) return 'quota';
    this.entities.set(row.entity_id,this.clone(row)); this.scripts.set(row.entity_id,this.clone(scripts)); return 'inserted';
  }
  /** @asyncUnsafe Callers handle database failure. */
  public async listDescriptorScripts(network: string): Promise<WatchlistScriptRow[]> { return [...this.scripts.values()].flat().filter(row=>row.network===network && this.entities.has(row.entity_id)).map(row=>this.clone(row)); }

  /** @asyncUnsafe Callers handle database failure. */
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
    this.notifications.set(row.notification_id, this.clone(row)); this.notificationOrder.set(row.notification_id,++this.notificationSequence); return 'inserted';
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async recordNotificationWithDelivery(row: NotificationRow, webhookId: string | null, hourlyLimit: number): Promise<'inserted' | 'duplicate' | 'rate_limited'> {
    const rule = this.rules.get(row.rule_id);
    if (!rule || !rule.enabled || rule.owner_id !== row.owner_id || rule.network !== row.network || rule.watchlist_id !== row.watchlist_id) throw new Error('Notification rule unavailable');
    if (webhookId) {
      const target = this.webhooks.get(webhookId);
      if (!target || !target.active || target.owner_id !== row.owner_id || target.network !== row.network || rule.webhook_id !== webhookId || rule.delivery_channel !== 'webhook') throw new Error('Notification delivery target unavailable');
    }
    const existing = [...this.notifications.values()].find(value => value.rule_id === row.rule_id && value.event_id === row.event_id);
    if (existing && (existing.owner_id !== row.owner_id || existing.network !== row.network)) throw new Error('Notification scope mismatch');
    if (!existing && [...this.notifications.values()].filter(value => value.rule_id === row.rule_id && Date.parse(value.created_at) >= Date.parse(row.created_at) - 3600000).length >= hourlyLimit) return 'rate_limited';
    const notification = existing ?? this.clone(row);
    // No await between validation and both map writes: all-or-nothing in process.
    if (webhookId && ![...this.outbox.values()].some(value => value.notification_id === notification.notification_id && value.webhook_id === webhookId)) {
      const intent: OutboxRow = { outbox_id: randomUUID(), notification_id: notification.notification_id, webhook_id: webhookId, network: row.network, state: 'pending', attempt_count: 0, next_attempt_at: row.created_at, lease_until: null, last_error: null, created_at: row.created_at, updated_at: row.created_at };
      this.outbox.set(intent.outbox_id, intent);
    }
    if (!existing) { this.notifications.set(row.notification_id, notification); this.notificationOrder.set(row.notification_id,++this.notificationSequence); }
    return existing ? 'duplicate' : 'inserted';
  }

  /** @asyncUnsafe Callers handle database failure. */
  public async listNotifications(ownerId: string, network: string, watchlistId: string | null, limit: number): Promise<NotificationRow[]> {
    return [...this.notifications.values()].filter(n => n.owner_id === ownerId && n.network === network && (watchlistId === null || n.watchlist_id === watchlistId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(n => this.clone(n));
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  /** @asyncUnsafe The caller handles database rejection. */
  public async listNotificationsAfter(ownerId: string, network: string, cursor: string | null, limit: number): Promise<NotificationRow[]> {
    if (cursor) { const row=this.notifications.get(cursor);if(!row||row.owner_id!==ownerId||row.network!==network)throw new Error('invalid_notification_cursor'); }
    return [...this.notifications.values()].filter(row=>row.owner_id===ownerId&&row.network===network&&(!cursor||(this.notificationOrder.get(row.notification_id)??0)>(this.notificationOrder.get(cursor)??0))).sort((a,b)=>(this.notificationOrder.get(a.notification_id)??0)-(this.notificationOrder.get(b.notification_id)??0)).slice(0,limit).map(row=>this.clone(row));
  }
  /** @asyncUnsafe The caller handles database rejection. */
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
    for(const row of this.outbox.values())if(row.network===network&&row.state==='pending'&&row.attempt_count>=8&&(!row.lease_until||row.lease_until<now))Object.assign(row,{state:'failed',last_error:'attempt_limit_recovery',lease_token:null,lease_until:null,updated_at:now});
    const claimed: OutboxRow[] = [];
    for (const o of this.outbox.values()) {
      if (claimed.length >= limit) { break; }
      if (o.network === network && o.state === 'pending' && o.attempt_count < 8 && o.next_attempt_at <= now && (o.lease_until === null || o.lease_until < now)) {
        o.lease_until = leaseUntil; o.lease_token = randomUUID(); o.attempt_count++; claimed.push(this.clone(o));
      }
    }
    return claimed;
  }
  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async completeOutbox(outboxId: string, state: 'delivered' | 'failed' | 'pending', attemptCount: number, nextAttemptAt: string, lastError: string | null, at: string, leaseToken: string, network: string): Promise<boolean> {
    const row = this.outbox.get(outboxId);
    if (!row || row.network !== network || row.state !== 'pending' || row.lease_token !== leaseToken || !row.lease_until || row.lease_until <= at || row.attempt_count !== attemptCount) return false;
    Object.assign(row, { state, next_attempt_at: nextAttemptAt, lease_until: null, lease_token: null, last_error: lastError, updated_at: at });
    return true;
  }
  /** @asyncUnsafe Callers handle database failure. */
  public async renewOutbox(outboxId: string, network: string, leaseToken: string, now: string, leaseUntil: string): Promise<boolean> {
    const row = this.outbox.get(outboxId);
    if (!row || row.network !== network || row.state !== 'pending' || row.lease_token !== leaseToken || !row.lease_until || row.lease_until <= now) return false;
    row.lease_until = leaseUntil;
    return true;
  }
  public async finishOutbox(row: OutboxRow, attempt: WebhookAttemptRow, state: OutboxRow['state'], nextAttemptAt: string): Promise<boolean> {
    if (!this.attempts.some(value => value.outbox_id === attempt.outbox_id && value.attempt_number === attempt.attempt_number)) this.attempts.push(this.clone(attempt));
    return this.completeOutbox(row.outbox_id, state, attempt.attempt_number, nextAttemptAt, attempt.error_code, attempt.finished_at, row.lease_token ?? '', row.network);
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
