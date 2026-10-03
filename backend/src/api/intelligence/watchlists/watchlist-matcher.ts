import * as crypto from 'crypto';
import config from '../../../config';
import logger from '../../../logger';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { developerIdentity } from '../identity/developer-identity';
import { NotificationRow, ownerStore, WatchlistEntityRow, WatchlistRuleRow } from '../identity/owner-store';

/**
 * Evaluates watchlist rules against what the main loop observed: confirmed
 * blocks (confirmation, value_transfer, feerate_cross, reorg_displaced) and
 * mempool replacements (rbf_replacement).
 *
 * Matching compares SHA-256 blinded hashes, so the matcher never learns
 * which address or txid an owner watches beyond the hash. Every finding is
 * persisted with a stable event ID, unique per rule, so a replayed block
 * cannot create it twice. A block seen again at a height already recorded
 * is a reorg: confirmations that the new block no longer contains are marked
 * displaced and, where a rule asks for it, reported as such.
 */
export const MATCHER_CONSUMER_ID = 'watchlist-matcher';

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

interface Finding {
  rule: WatchlistRuleRow;
  entity: WatchlistEntityRow | null;
  event_id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  entity_type: string;
  blinded_hash: string;
  block_height: number | null;
  block_hash: string | null;
}

export class WatchlistMatcher {
  private lastMedianFee: number | null = null;
  private recentBlocks = new Map<number, { hash: string; txidHashes: Set<string> }>();

  constructor(private readonly network: string = config.MEMPOOL.NETWORK) {}

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async record(finding: Finding, now: number): Promise<'inserted' | 'duplicate' | 'rate_limited'> {
    /* IMPLEMENTATION-HANDOFF [WP-BI-002] DEF-BI-002; COV-BI-002A/B/C.
     * Verified current-code reproduction: insertNotification succeeds, insertOutbox
     * throws, replay returns duplicate and leaves zero delivery rows indefinitely.
     * 1. Replace the split insertNotification/enqueueDelivery path with the atomic
     *    OwnerStore.recordNotificationWithDelivery contract specified beside the SQL
     *    implementation. Reuse the existing notification ID when an event replays.
     * 2. Couple any per-rule quota decision to that transaction; previously recorded
     *    events must still be reconciled when the hourly quota is reached. A retry
     *    cannot silently abandon delivery intent or advance a checkpoint before commit.
     * 3. Keep webhook owner/network checks at the durable boundary. Emit websocket
     *    notifications only after durable commit under WP-BI-004; acknowledgement of
     *    a source event must mean its required downstream work is durably recorded.
     * Dependencies: WP-BI-001; store portion of WP-BI-002; then WP-BI-003 worker.
     * Source: docs/api/OWNER-IDENTITY.md and MySQL 8.4 transaction/locking guidance.
     * Tests: extend watchlists.test.ts with the injected insertOutbox failure recorded
     *    in handoff reproductions/intelligence-current-source-results.json; acceptance
     *    requires restart/replay to leave exactly one notification and one intent.
     *    Also test duplicate blocks, rate-limit boundary, foreign targets and reorgs.
     * Command: cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/watchlists/watchlists.test.ts
     * MySQL crash fault and Signet consumer readback remain NOT TESTED. Rollback retains
     *    durable notifications/intents and resumes from the last committed checkpoint.
     */
    const store = ownerStore();
    const hourAgo = new Date(now - 3_600_000).toISOString();
    if ((await store.countNotificationsSince(finding.rule.rule_id, hourAgo)) >= finding.rule.rate_limit_per_hour) {
      return 'rate_limited';
    }
    const row: NotificationRow = {
      notification_id: EventEnvelopeValidator.generateUuidV7(),
      owner_id: finding.rule.owner_id,
      network: this.network,
      watchlist_id: finding.rule.watchlist_id,
      rule_id: finding.rule.rule_id,
      event_id: finding.event_id,
      title: finding.title,
      message: finding.message,
      severity: finding.severity,
      entity_type: finding.entity_type,
      blinded_hash: finding.blinded_hash,
      block_height: finding.block_height,
      block_hash: finding.block_hash,
      state: 'open',
      created_at: new Date(now).toISOString(),
      acknowledged_at: null,
    };
    const outcome = await store.insertNotification(row);
    if (outcome === 'inserted' && finding.rule.delivery_channel === 'webhook' && finding.rule.webhook_id) {
      await developerIdentity.enqueueDelivery(row.notification_id, finding.rule.webhook_id, now);
    }
    return outcome;
  }

  /** @asyncUnsafe Rules grouped by watchlist, only enabled ones. */
  private async rulesByWatchlist(): Promise<Map<string, WatchlistRuleRow[]>> {
    const grouped = new Map<string, WatchlistRuleRow[]>();
    for (const rule of await ownerStore().listEnabledRules(this.network)) {
      const list = grouped.get(rule.watchlist_id) ?? [];
      list.push(rule);
      grouped.set(rule.watchlist_id, list);
    }
    return grouped;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  private async entitiesByHash(entityType: string): Promise<Map<string, WatchlistEntityRow[]>> {
    const grouped = new Map<string, WatchlistEntityRow[]>();
    for (const entity of await ownerStore().listEntitiesByType(this.network, entityType)) {
      const list = grouped.get(entity.blinded_hash) ?? [];
      list.push(entity);
      grouped.set(entity.blinded_hash, list);
    }
    return grouped;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): Promise<{ inserted: number; duplicates: number; displaced: number }> {
    /* IMPLEMENTATION-HANDOFF [WP-BI-004] DEF-BI-004; COV-BI-004A/B/C/D/E.
     * Verified: addEntity accepts outpoint/descriptor but this matcher loads only
     * txid/address. addRule accepts websocket but record has no websocket dispatch.
     * Public outpoint/descriptor selectors are in frontend watchlists.component.ts.
     * 1. After the registration contract beside WatchlistsService.addEntity, hash
     *    normalized txid:vout for observed outputs and vin spent outpoints, and match
     *    outpoint confirmation/value-transfer rules with an explicit received/spent
     *    direction. Use per-rule/per-outpoint stable event IDs to avoid duplicates.
     * 2. Match registered descriptor-child script hashes against output scriptpubkey
     *    and input prevout.scriptpubkey. Preserve the parent entity ID, derivation
     *    index, integer sats, block hash and network for readback and reorg displacement.
     *    Do not attempt to expand a SHA-256 descriptor hash or infer wallet ownership.
     * 3. Persist first through WP-BI-002. Wire websocket rules to PROPOSED NEW
     *    watchlists/watchlist-stream.ts, authenticated by requireOwner('watchlists'),
     *    with owner/network filtering, notification-ID resume cursor, bounded buffers,
     *    disconnect cleanup and durable catch-up. Update addRule response/capabilities.
     * Dependencies: WP-BI-001, WP-BI-002, WP-FE-007; shared transport WP-BI-005 only
     *    when NATS is selected. No unauthenticated global notification publication.
     * Sources: docs/api/OWNER-IDENTITY.md; BIP380 public descriptor syntax; BIP141
     *    scriptPubKey matching; existing advertised entity and delivery contracts.
     * Tests: extend watchlists.test.ts plus PROPOSED NEW watchlists/watchlist-stream.test.ts.
     *    Independently assert outpoint create/spend, ranged descriptor receive/spend,
     *    duplicates, restart/reorg, wrong owner/network, websocket reconnect/cursor and
     *    REST readback. Run cd backend && ./node_modules/.bin/jest --runInBand
     *    --coverage=false --runTestsByPath src/api/intelligence/watchlists/watchlists.test.ts
     * Final acceptance: real Signet observed payments reach each selected consumer.
     * Rollback preserves child registrations and cursor state; never mark opaque
     *    legacy descriptors monitored until the user resubmits verified public scripts.
     */
    const store = ownerStore();
    const rules = await this.rulesByWatchlist();
    const findings: Finding[] = [];
    const txidHashes = new Set<string>();
    for (const tx of transactions) { txidHashes.add(sha256(tx.txid)); }

    // A height seen before with another hash is a reorg of that height.
    let displaced = 0;
    const checkpoint = await store.getCheckpoint(MATCHER_CONSUMER_ID, this.network);
    const previous = this.recentBlocks.get(block.height);
    if ((previous && previous.hash !== block.id) || (checkpoint && block.height <= checkpoint.block_height && !previous)) {
      for (const notification of await store.listNotificationsAtHeight(this.network, block.height)) {
        if (notification.block_hash === block.id) { continue; }
        if (notification.entity_type === 'txid' && txidHashes.has(notification.blinded_hash)) { continue; }
        await store.displaceNotification(notification.notification_id);
        displaced++;
        for (const rule of rules.get(notification.watchlist_id) ?? []) {
          if (rule.condition_type !== 'reorg_displaced') { continue; }
          findings.push({
            rule, entity: null, event_id: `${block.id}:displaced:${notification.notification_id}`,
            title: 'Confirmation displaced by reorg', message: `Block ${block.height} was replaced by ${block.id}; a watched ${notification.entity_type} is no longer confirmed there.`,
            severity: 'critical', entity_type: notification.entity_type, blinded_hash: notification.blinded_hash, block_height: block.height, block_hash: block.id,
          });
        }
      }
    }

    if (rules.size > 0) {
      const watchedTxids = await this.entitiesByHash('txid');
      const watchedAddresses = await this.entitiesByHash('address');
      for (const tx of transactions) {
        const txidHash = sha256(tx.txid);
        for (const entity of watchedTxids.get(txidHash) ?? []) {
          for (const rule of rules.get(entity.watchlist_id) ?? []) {
            if (rule.condition_type !== 'confirmation') { continue; }
            findings.push({
              rule, entity, event_id: `${block.id}:${tx.txid}:confirmation`, title: 'Transaction confirmed',
              message: `${entity.label} confirmed in block ${block.height}.`, severity: 'info', entity_type: 'txid', blinded_hash: txidHash, block_height: block.height, block_hash: block.id,
            });
          }
        }
        if (watchedAddresses.size === 0) { continue; }
        for (let index = 0; index < (tx.vout ?? []).length; index++) {
          const vout = tx.vout[index];
          if (!vout.scriptpubkey_address) { continue; }
          const addressHash = sha256(vout.scriptpubkey_address);
          for (const entity of watchedAddresses.get(addressHash) ?? []) {
            for (const rule of rules.get(entity.watchlist_id) ?? []) {
              if (rule.condition_type !== 'value_transfer') { continue; }
              if (rule.threshold_value !== null && vout.value < rule.threshold_value) { continue; }
              findings.push({
                rule, entity, event_id: `${block.id}:${tx.txid}:${index}:received`, title: 'Value received',
                message: `${entity.label} received ${vout.value} sats in block ${block.height}.`, severity: 'info', entity_type: 'address', blinded_hash: addressHash, block_height: block.height, block_hash: block.id,
              });
            }
          }
        }
        for (let index = 0; index < (tx.vin ?? []).length; index++) {
          const address = tx.vin[index].prevout?.scriptpubkey_address;
          if (!address) { continue; }
          const addressHash = sha256(address);
          for (const entity of watchedAddresses.get(addressHash) ?? []) {
            for (const rule of rules.get(entity.watchlist_id) ?? []) {
              if (rule.condition_type !== 'value_transfer') { continue; }
              const value = tx.vin[index].prevout?.value ?? 0;
              if (rule.threshold_value !== null && value < rule.threshold_value) { continue; }
              findings.push({
                rule, entity, event_id: `${block.id}:${tx.txid}:${index}:spent`, title: 'Value spent',
                message: `${entity.label} spent ${value} sats in block ${block.height}.`, severity: 'warning', entity_type: 'address', blinded_hash: addressHash, block_height: block.height, block_hash: block.id,
              });
            }
          }
        }
      }

      const median = block.extras?.medianFee;
      if (typeof median === 'number' && this.lastMedianFee !== null) {
        for (const list of rules.values()) {
          for (const rule of list) {
            if (rule.condition_type !== 'feerate_cross' || rule.threshold_value === null) { continue; }
            const threshold = rule.threshold_value;
            const crossedUp = this.lastMedianFee < threshold && median >= threshold;
            const crossedDown = this.lastMedianFee >= threshold && median < threshold;
            if (!crossedUp && !crossedDown) { continue; }
            findings.push({
              rule, entity: null, event_id: `${block.id}:feerate_cross:${threshold}`, title: crossedUp ? 'Fee rate rose past threshold' : 'Fee rate fell below threshold',
              message: `Median fee rate ${median.toFixed(1)} sat/vB in block ${block.height} (was ${this.lastMedianFee.toFixed(1)}), threshold ${threshold}.`,
              severity: crossedUp ? 'warning' : 'info', entity_type: 'feerate_threshold', blinded_hash: sha256(String(threshold)), block_height: block.height, block_hash: block.id,
            });
          }
        }
      }
    }
    if (typeof block.extras?.medianFee === 'number') { this.lastMedianFee = block.extras.medianFee; }

    let inserted = 0;
    let duplicates = 0;
    for (const finding of findings) {
      const outcome = await this.record(finding, now);
      if (outcome === 'inserted') { inserted++; } else if (outcome === 'duplicate') { duplicates++; }
    }

    this.recentBlocks.set(block.height, { hash: block.id, txidHashes });
    for (const height of this.recentBlocks.keys()) {
      if (height < block.height - 100) { this.recentBlocks.delete(height); }
    }
    await store.saveCheckpoint({ consumer_id: MATCHER_CONSUMER_ID, network: this.network, block_height: block.height, block_hash: block.id, updated_at: new Date(now).toISOString() });
    if (inserted || displaced) { logger.debug(`watchlist matcher: block ${block.height} produced ${inserted} notifications, ${displaced} displaced`); }
    return { inserted, duplicates, displaced };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async observeReplacement(replacedTxid: string, replacementTxid: string, now = Date.now()): Promise<number> {
    const rules = await this.rulesByWatchlist();
    if (rules.size === 0) { return 0; }
    const hash = sha256(replacedTxid);
    let inserted = 0;
    for (const entity of (await this.entitiesByHash('txid')).get(hash) ?? []) {
      for (const rule of rules.get(entity.watchlist_id) ?? []) {
        if (rule.condition_type !== 'rbf_replacement') { continue; }
        const outcome = await this.record({
          rule, entity, event_id: `${replacedTxid}:replaced_by:${replacementTxid}`, title: 'Transaction replaced',
          message: `${entity.label} was replaced in the mempool by ${replacementTxid}.`, severity: 'warning', entity_type: 'txid', blinded_hash: hash, block_height: null, block_hash: null,
        }, now);
        if (outcome === 'inserted') { inserted++; }
      }
    }
    return inserted;
  }
}

export const watchlistMatcher = new WatchlistMatcher();
