import * as crypto from 'crypto';
import config from '../../../config';
import logger from '../../../logger';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import mempoolBlocks from '../../mempool-blocks';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';

/**
 * Block templates from the sources this deployment actually has.
 *
 * The revision this replaces listed three sources (Core, Stratum V2, DATUM)
 * that were never contacted, seeded templates with txids like "tx-sample-01",
 * and compared any block hash against them with a fixed 15,000 sat delta.
 *
 * Two real sources exist here: Bitcoin Core's getblocktemplate over the
 * configured RPC, polled on a cold schedule and after each block, and this
 * backend's own next-block projection. A mined block is compared against
 * the latest template collected for its height; a block never observed has
 * no comparison. Stratum V2 and DATUM sources are not connected on this
 * deployment and are not listed.
 */

export type TemplateSourceType = 'core_gbt' | 'mempool_projection';

export interface TemplateSource {
  source_id: string;
  name: string;
  source_type: TemplateSourceType;
  endpoint: string;
  software_version: string;
  status: 'active' | 'degraded' | 'offline' | 'not_collected';
  last_template_at: string | null;
  last_error: string | null;
}

export interface CandidateTemplate {
  template_id: string;
  source_id: string;
  source_name: string;
  source_type: TemplateSourceType;
  height: number;
  prev_block_hash: string;
  tx_count: number;
  total_weight: number;
  total_fees_sats: number;
  sigops_count: number | null;
  coinbase_value_sats: number | null;
  fingerprint_hash: string;
  observed_at_utc: string;
  txids: string[];
}

export interface TemplateDiffResult {
  template_a_id: string;
  template_b_id: string;
  height: number;
  similarity_score: number;
  added_to_b: string[];
  removed_from_b: string[];
  reordered_count: number;
  fee_delta_sats: number;
  weight_delta: number;
  explanation: string;
}

export interface MinedBlockTemplateComparison {
  block_hash: string;
  height: number;
  mined_tx_count: number;
  mined_fees_sats: number;
  best_template_id: string;
  template_source_id: string;
  template_fees_sats: number;
  fee_differential_sats: number;
  omitted_txids: string[];
  unexpected_txids: string[];
  template_age_seconds: number;
  observed_difference_reason: string;
}

export class TemplateUnavailableError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

interface GetBlockTemplateResult {
  height: number;
  previousblockhash: string;
  transactions: { txid: string; hash: string; fee: number; weight: number; sigops?: number }[];
  coinbasevalue: number;
  weightlimit?: number;
}

export type TemplateFetcher = () => Promise<GetBlockTemplateResult>;
export type ProjectionReader = () => { transactionIds: string[]; totalFees: number; blockVSize: number; nTx: number } | null;

export const TEMPLATE_LIMITS = { templates: 200, comparisons: 200, pollMs: 120_000, txidsInResponse: 5000 } as const;

const fingerprint = (txids: string[]): string => crypto.createHash('sha256').update(txids.join(',')).digest('hex');

export class TemplateCollectorService {
  private static instance: TemplateCollectorService;
  private sources = new Map<string, TemplateSource>();
  private templates: CandidateTemplate[] = [];
  private comparisons = new Map<string, MinedBlockTemplateComparison>();
  private currentHeight: number | null = null;
  private currentParentHash: string | null = null;
  private tipRevision = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  // Signet templates require the client to declare the signet rule as well.
  public fetchCoreTemplate: TemplateFetcher = () => bitcoinClient.getBlockTemplate({ rules: config.MEMPOOL.NETWORK === 'signet' ? ['segwit', 'signet'] : ['segwit'] });
  public readProjection: ProjectionReader = () => mempoolBlocks.getMempoolBlocksWithTransactions()[0] ?? null;

  private constructor() {
    this.sources.set('src-core-gbt', {
      source_id: 'src-core-gbt', name: 'Bitcoin Core getblocktemplate', source_type: 'core_gbt',
      endpoint: `rpc://${config.CORE_RPC.HOST}:${config.CORE_RPC.PORT}`, software_version: 'unknown until first template', status: 'not_collected', last_template_at: null, last_error: null,
    });
    this.sources.set('src-mempool-projection', {
      source_id: 'src-mempool-projection', name: 'Universe next-block projection', source_type: 'mempool_projection',
      endpoint: 'internal://mempool-blocks', software_version: 'this backend', status: 'not_collected', last_template_at: null, last_error: null,
    });
  }

  public static getInstance(): TemplateCollectorService {
    if (!TemplateCollectorService.instance) {
      TemplateCollectorService.instance = new TemplateCollectorService();
    }
    return TemplateCollectorService.instance;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.templates = [];
    this.comparisons.clear();
    this.currentHeight = null;
    this.currentParentHash = null;
    this.tipRevision = 0;
    for (const source of this.sources.values()) { source.status = 'not_collected'; source.last_template_at = null; source.last_error = null; }
  }

  private remember(template: CandidateTemplate): void {
    this.templates.push(template);
    if (this.templates.length > TEMPLATE_LIMITS.templates) { this.templates.shift(); }
  }

  /** One getblocktemplate call; the outcome is recorded on the source either way. */
  public async collectCoreTemplate(now?: number): Promise<CandidateTemplate | null> {
    const source = this.sources.get('src-core-gbt') as TemplateSource;
    const requestedTipRevision = this.tipRevision;
    try {
      const result = await this.fetchCoreTemplate();
      const observedAt = now ?? Date.now();
      if (requestedTipRevision !== this.tipRevision &&
        (result.height !== this.currentHeight || result.previousblockhash !== this.currentParentHash)) {
        source.status = 'degraded';
        source.last_error = 'Template response crossed a tip change and targets the previous parent.';
        return null;
      }
      const txids = result.transactions.map(tx => tx.txid);
      const template: CandidateTemplate = {
        template_id: `tmpl-core-${result.height}-${observedAt}`, source_id: source.source_id, source_name: source.name, source_type: 'core_gbt',
        height: result.height, prev_block_hash: result.previousblockhash, tx_count: txids.length,
        total_weight: result.transactions.reduce((sum, tx) => sum + (tx.weight ?? 0), 0),
        total_fees_sats: result.transactions.reduce((sum, tx) => sum + (tx.fee ?? 0), 0),
        sigops_count: result.transactions.every(tx => typeof tx.sigops === 'number') ? result.transactions.reduce((sum, tx) => sum + (tx.sigops ?? 0), 0) : null,
        coinbase_value_sats: result.coinbasevalue ?? null, fingerprint_hash: fingerprint(txids), observed_at_utc: new Date(observedAt).toISOString(), txids,
      };
      this.remember(template);
      source.status = 'active';
      source.last_template_at = template.observed_at_utc;
      source.last_error = null;
      this.currentHeight = result.height;
      this.currentParentHash = result.previousblockhash;
      return template;
    } catch (error) {
      source.status = 'offline';
      source.last_error = error instanceof Error ? error.message : String(error);
      logger.debug(`template collector: getblocktemplate failed: ${source.last_error}`);
      return null;
    }
  }

  /** This backend's own projection of the next block, as a template. */
  public collectProjection(now = Date.now()): CandidateTemplate | null {
    const source = this.sources.get('src-mempool-projection') as TemplateSource;
    const projection = this.readProjection();
    if (!projection || this.currentHeight === null || this.currentParentHash === null) {
      source.status = 'not_collected';
      source.last_error = projection ? 'height unknown until Core answered getblocktemplate' : 'no projection available yet';
      return null;
    }
    const txids = projection.transactionIds;
    const template: CandidateTemplate = {
      template_id: `tmpl-projection-${this.currentHeight}-${now}`, source_id: source.source_id, source_name: source.name, source_type: 'mempool_projection',
      height: this.currentHeight, prev_block_hash: this.currentParentHash, tx_count: projection.nTx,
      total_weight: projection.blockVSize * 4, total_fees_sats: Math.round(projection.totalFees), sigops_count: null, coinbase_value_sats: null,
      fingerprint_hash: fingerprint(txids), observed_at_utc: new Date(now).toISOString(), txids,
    };
    this.remember(template);
    source.status = 'active';
    source.last_template_at = template.observed_at_utc;
    source.last_error = null;
    return template;
  }

  public async collect(now?: number): Promise<void> {
    if (this.polling) { return; }
    this.polling = true;
    try {
      await this.collectCoreTemplate(now);
      this.collectProjection(now);
    } finally {
      this.polling = false;
    }
  }

  public startPolling(intervalMs: number = TEMPLATE_LIMITS.pollMs): void {
    if (this.pollTimer) { return; }
    this.pollTimer = setInterval(() => { this.collect().catch(() => undefined); }, intervalMs);
    this.pollTimer.unref?.();
    // The first poll waits for the main loop to have authenticated and filled the mempool.
    setTimeout(() => { this.collect().catch(() => undefined); }, 30_000).unref?.();
  }

  public stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  /** Called from the block hub: compares the mined block with the latest template for its height. */
  public observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): MinedBlockTemplateComparison | null {
    this.tipRevision++;
    this.currentHeight = block.height + 1;
    this.currentParentHash = block.id;
    const candidates = this.templates.filter(template => template.height === block.height &&
      template.prev_block_hash === block.previousblockhash && Date.parse(template.observed_at_utc) <= now);
    const best = candidates.length ? candidates.reduce((a, b) => (b.total_fees_sats > a.total_fees_sats ? b : a)) : null;
    const minedTxids = transactions.filter(tx => !tx.vin?.some(vin => vin.is_coinbase)).map(tx => tx.txid);
    const minedFees = block.extras?.totalFees ?? transactions.reduce((sum, tx) => sum + (tx.fee ?? 0), 0);
    if (!best) {
      this.currentHeight = block.height + 1;
      return null;
    }
    const templateSet = new Set(best.txids);
    const minedSet = new Set(minedTxids);
    const comparison: MinedBlockTemplateComparison = {
      block_hash: block.id, height: block.height, mined_tx_count: minedTxids.length, mined_fees_sats: minedFees,
      best_template_id: best.template_id, template_source_id: best.source_id, template_fees_sats: best.total_fees_sats,
      fee_differential_sats: minedFees - best.total_fees_sats,
      omitted_txids: best.txids.filter(txid => !minedSet.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      unexpected_txids: minedTxids.filter(txid => !templateSet.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      template_age_seconds: Math.max(0, Math.round((now - Date.parse(best.observed_at_utc)) / 1000)),
      observed_difference_reason: 'Set difference against the highest-fee observed template for the identical height and parent before block receipt; no cause is inferred.',
    };
    this.comparisons.set(block.id, comparison);
    if (this.comparisons.size > TEMPLATE_LIMITS.comparisons) {
      const oldest = this.comparisons.keys().next().value;
      if (oldest) { this.comparisons.delete(oldest); }
    }
    this.currentHeight = block.height + 1;
    void now;
    return comparison;
  }

  public getSources(): TemplateSource[] {
    return [...this.sources.values()];
  }

  public getTemplatesForHeight(height?: number): CandidateTemplate[] {
    const list = height === undefined ? this.templates : this.templates.filter(template => template.height === height);
    return list.map(template => ({ ...template, txids: template.txids.slice(0, TEMPLATE_LIMITS.txidsInResponse) }));
  }

  public getTemplateById(templateId: string): CandidateTemplate | null {
    return this.templates.find(template => template.template_id === templateId) ?? null;
  }

  public computeTemplateDiff(templateAId: string, templateBId: string): TemplateDiffResult | null {
    const a = this.getTemplateById(templateAId);
    const b = this.getTemplateById(templateBId);
    if (!a || !b) { return null; }
    const setA = new Set(a.txids);
    const setB = new Set(b.txids);
    const common = a.txids.filter(txid => setB.has(txid));
    const positionInB = new Map(b.txids.map((txid, index) => [txid, index]));
    let reordered = 0;
    let lastPosition = -1;
    for (const txid of common) {
      const position = positionInB.get(txid) as number;
      if (position < lastPosition) { reordered++; }
      lastPosition = Math.max(lastPosition, position);
    }
    return {
      template_a_id: a.template_id, template_b_id: b.template_id, height: a.height,
      similarity_score: Number((common.length / Math.max(1, Math.max(a.txids.length, b.txids.length))).toFixed(4)),
      added_to_b: b.txids.filter(txid => !setA.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      removed_from_b: a.txids.filter(txid => !setB.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      reordered_count: reordered, fee_delta_sats: b.total_fees_sats - a.total_fees_sats, weight_delta: b.total_weight - a.total_weight,
      explanation: a.height === b.height && a.prev_block_hash === b.prev_block_hash
        ? 'Both templates extend the same parent; differences are selection and ordering differences between the two sources at their observation times.'
        : 'The templates target different heights or parent blocks and are not directly comparable.',
    };
  }

  public compareMinedBlock(blockHash: string): MinedBlockTemplateComparison | null {
    return this.comparisons.get(blockHash) ?? null;
  }

  public getPolicyFingerprints(): Array<{ source_id: string; source_name: string; fingerprint_hash: string | null; height: number | null; tx_selection_heuristic: string; observed_at_utc: string | null }> {
    return this.getSources().map(source => {
      const latest = [...this.templates].reverse().find(template => template.source_id === source.source_id) ?? null;
      return {
        source_id: source.source_id, source_name: source.name, fingerprint_hash: latest?.fingerprint_hash ?? null, height: latest?.height ?? null,
        tx_selection_heuristic: source.source_type === 'core_gbt' ? 'Bitcoin Core ancestor-feerate block assembly' : 'Universe ancestor-set projection over this backend mempool',
        observed_at_utc: latest?.observed_at_utc ?? null,
      };
    });
  }
}

export const templateCollectorService = TemplateCollectorService.getInstance();
