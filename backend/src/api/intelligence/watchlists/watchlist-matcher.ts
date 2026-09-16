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
