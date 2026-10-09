import { eventBus } from '../events/intelligence-event-bus';
import { EventEnvelopeValidator } from '../events/event-envelope';
import * as crypto from 'crypto';
import config from '../../../config';
import logger from '../../../logger';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import mempoolBlocks from '../../mempool-blocks';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import { TaskDrain } from '../../task-drain';

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

export interface TemplateObservationContext {
  schema: 'universe-template-observation-context-v1';
  chain: 'bitcoin';
  network: string;
  genesis_hash: string;
  block_one_hash: string;
  signet_challenge: string | null;
  checkpoint: { height: number; block_hash: string };
  observed_at_utc: string;
  provenance: 'bitcoin-core-gbt' | 'backend-mempool-projection';
  input_core_template_id: string | null;
}

export interface TemplateSource {
  source_id: string;
  name: string;
  source_type: TemplateSourceType;
  endpoint: null;
  software_version: string | null;
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
  total_weight: number | null;
  configured_network?: string;
  observation_context?: TemplateObservationContext | null;
  weight_basis?: 'core-transaction-weights' | 'vsize-derived-estimate';
  estimated_weight?: number | null;
  total_fees_sats: number;
  sigops_count: number | null;
  coinbase_value_sats: number | null;
  fingerprint_hash: string;
  observed_at_utc: string;
  txids: string[];
  txids_returned_count?: number;
  txids_truncated?: boolean;
}

export interface TemplateDiffResult {
  template_a_id: string;
  template_b_id: string;
  height: number;
  similarity_score: number;
  added_to_b: string[];
  removed_from_b: string[];
  reordered_count: number;
  fee_delta_sats: number | null;
  weight_delta: number | null;
  observation_context_a: TemplateObservationContext | null;
  observation_context_b: TemplateObservationContext | null;
  comparison_context: 'same-observed-context' | 'different-observed-context' | 'unavailable';
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

export type TemplateFetcher = (signal?: AbortSignal, network?: string) => Promise<GetBlockTemplateResult>;
export type ProjectionReader = () => { transactionIds: string[]; totalFees: number; blockVSize: number; nTx: number } | null;

export const TEMPLATE_LIMITS = { templates: 200, comparisons: 200, pollMs: 120_000, txidsInResponse: 5000 } as const;

const fingerprint = (txids: string[]): string => crypto.createHash('sha256').update(txids.join(',')).digest('hex');
// Bitcoin MAX_MONEY, in exact safe integer atomic units (also used by Esplora validation).
const MAX_MONEY = 21_000_000 * 100_000_000;
const money = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_MONEY;

export class TemplateCollectorService {
  private static instance: TemplateCollectorService;
  private sources = new Map<string, TemplateSource>();
  private templates: CandidateTemplate[] = [];
  private comparisons = new Map<string, MinedBlockTemplateComparison>();
  private currentHeight: number | null = null;
  private currentParentHash: string | null = null;
  private tipRevision = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private initialPollTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readonly work = new TaskDrain();
  private polling = false;
  private currentContext: TemplateObservationContext | null = null;
  private lastCoreTemplateId: string | null = null;

  // Signet templates require the client to declare the signet rule as well.
  public fetchCoreTemplate: TemplateFetcher = (signal, network = config.MEMPOOL.NETWORK) => bitcoinClient.rpc.call('getblocktemplate', [{ rules: network === 'signet' ? ['segwit', 'signet'] : ['segwit'] }], { signal });
  public readProjection: ProjectionReader = () => mempoolBlocks.getMempoolBlocksWithTransactions()[0] ?? null;

  private constructor() {
    this.sources.set('src-core-gbt', {
      source_id: 'src-core-gbt', name: 'Bitcoin Core getblocktemplate', source_type: 'core_gbt',
      endpoint: null, software_version: null, status: 'not_collected', last_template_at: null, last_error: null,
    });
    this.sources.set('src-mempool-projection', {
      source_id: 'src-mempool-projection', name: 'Universe next-block projection', source_type: 'mempool_projection',
      endpoint: null, software_version: null, status: 'not_collected', last_template_at: null, last_error: null,
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
    this.currentContext = null;
    this.lastCoreTemplateId = null;
    for (const source of this.sources.values()) { source.status = 'not_collected'; source.last_template_at = null; source.last_error = null; }
  }

  /** @asyncUnsafe Collection callers report publication failure. */
  private async remember(template: CandidateTemplate): Promise<void> {
    /* IMPLEMENTATION-HANDOFF [WP-BI-005] DEF-BI-005; COV-BI-005E.
     * Collection awaits eventBus publication before retaining the template.
     * Transport retention/replay and receiver effects remain separate obligations;
     * broker deduplication is bounded and is not permanent exactly-once delivery.
     * 1. Create an event envelope from the validated template using configured
     *    network, stable source/template identity, observed time and integer amounts.
     *    Persist publication intent or await broker acknowledgement under WP-BI-005;
     *    refactor collectCoreTemplate/collectProjection/collect together so failure
     *    never reports durable stream delivery. Preserve the existing source state.
     * 2. Publish exactly once logically by stable event ID (transport may redeliver),
     *    expose replay/retention bounds, and omit credentials/internal RPC endpoint
     *    details from public events. Maintain separate Core and projection provenance.
     * 3. Extend templates.test.ts and events integration tests: real collection ->
     *    publication -> GET /templates/stream -> reconnect readback; duplicate poll,
     *    tip change and broker outage must have explicit non-success outcomes.
     * Dependencies: WP-BI-005 provider and corrected route/wildcards. Existing command:
     *    cd backend && ./node_modules/.bin/jest --runInBand --coverage=false
     *    --runTestsByPath src/api/intelligence/templates/templates.test.ts
     * Isolated Core/Signet stream acceptance is NOT TESTED. Rollback retains published
     *    envelopes/cursors and stops producers before an incompatible schema downgrade.
     */
    const envelope = EventEnvelopeValidator.createEnvelope({ network: template.configured_network ?? config.MEMPOOL.NETWORK, event_type: 'observed', entity_type: 'template', entity_id: template.template_id, source_id: template.source_id,
      source_software: template.source_type === 'core_gbt' ? 'Bitcoin Core getblocktemplate' : 'Universe Explorer next-block projection',
      source_version: 'unknown', observed_at_utc: template.observed_at_utc, payload: { template } });
    if (!await eventBus.publish(EventEnvelopeValidator.buildSubject(envelope.network, 'template', 'observed'), envelope)) throw new Error('Template publication unavailable');
    this.templates.push({ ...template, txids: [...template.txids] });
    if (this.templates.length > TEMPLATE_LIMITS.templates) { this.templates.shift(); }
  }

  /** Fresh Core facts only; this is not an address-index readiness attestation. */
  private async observeCore<T>(network: string, acquire: (signal: AbortSignal) => Promise<T>): Promise<{ value: T; context: TemplateObservationContext | null }> {
    const controller = new AbortController();
    const timeout = Math.min(15000, config.CORE_RPC.TIMEOUT || 15000);
    const deadline = Date.now() + timeout;
    const active = () => { if (controller.signal.aborted || Date.now() >= deadline) throw new Error('Source deadline'); };
    let timer: NodeJS.Timeout | undefined;
    /** @asyncUnsafe The owning collection catches every observation failure. */
    const operation = async () => {
      // An injected fetcher without a native reader provides no observed identity.
      if (!bitcoinClient.rpc?.call) return { value: await acquire(controller.signal), context: null };
      /** @asyncUnsafe Propagates into the bounded observation and collection catch. */
      const rpc = async (method: string, params: unknown[] = []) => {
        active();
        const value = await bitcoinClient.rpc.call(method, params, { signal: controller.signal });
        active(); return value;
      };
      const before = await rpc('getblockchaininfo');
      const chains: Record<string, string> = { mainnet: 'main', testnet: 'test', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };
      const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
      if (before?.chain !== chains[network] || before.initialblockdownload !== false || !Number.isSafeInteger(before.blocks) || before.blocks < 1 || !hash(before.bestblockhash)) throw new Error('Invalid Core identity');
      const challenge = network === 'signet' ? before.signet_challenge : null;
      if (network === 'signet' && (typeof challenge !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(challenge) || (process.env.UNIVERSE_SIGNET_CHALLENGE && challenge !== process.env.UNIVERSE_SIGNET_CHALLENGE))) throw new Error('Invalid Signet identity');
      /** @asyncUnsafe Propagates into the bounded observation and collection catch. */
      const acquireBounded = async () => { active(); const result = await acquire(controller.signal); active(); return result; };
      const [genesis, blockOne, checkpoint, value] = await Promise.all([
        rpc('getblockhash', [0]), rpc('getblockhash', [1]), rpc('getblockhash', [before.blocks]),
        acquireBounded(),
      ]);
      const after = await rpc('getblockchaininfo');
      if (!hash(genesis) || !hash(blockOne) || checkpoint !== before.bestblockhash || after.chain !== before.chain || after.blocks !== before.blocks || after.bestblockhash !== before.bestblockhash || after.initialblockdownload !== false || (network === 'signet' && after.signet_challenge !== challenge)) throw new Error('Core observation crossed a source change');
      const context: TemplateObservationContext = Object.freeze({ schema: 'universe-template-observation-context-v1', chain: 'bitcoin', network, genesis_hash: genesis, block_one_hash: blockOne, signet_challenge: challenge,
        checkpoint: Object.freeze({ height: before.blocks, block_hash: checkpoint }), observed_at_utc: new Date().toISOString(), provenance: 'bitcoin-core-gbt', input_core_template_id: null });
      return { value, context };
    };
    try {
      return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Source deadline')); }, timeout); })]);
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  }

  public getCurrentObservationContext(): TemplateObservationContext | null {
    return this.currentContext?.network === config.MEMPOOL.NETWORK ? this.currentContext : null;
  }

  /** One getblocktemplate call; the outcome is recorded on the source either way. */
  public async collectCoreTemplate(now?: number): Promise<CandidateTemplate | null> {
    const source = this.sources.get('src-core-gbt') as TemplateSource;
    const requestedTipRevision = this.tipRevision;
    const network = config.MEMPOOL.NETWORK;
    try {
      const { value: result, context } = await this.observeCore(network, signal => this.fetchCoreTemplate(signal, network));
      const atomic = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
      if (!result || !atomic(result.height) || result.height < 1 || typeof result.previousblockhash !== 'string' || !/^[a-f0-9]{64}$/.test(result.previousblockhash) || !Array.isArray(result.transactions) || result.transactions.length > 100000 || !money(result.coinbasevalue)) throw new Error('Invalid template scalars');
      const unique = new Set<string>();
      for (const tx of result.transactions) {
        if (!tx || !/^[a-f0-9]{64}$/.test(tx.txid) || unique.has(tx.txid) || !money(tx.fee) || !atomic(tx.weight) || (tx.sigops !== undefined && !atomic(tx.sigops))) throw new Error('Invalid template transaction');
        unique.add(tx.txid);
      }
      if (!atomic(result.transactions.reduce((sum, tx) => sum + tx.weight, 0)) || !money(result.transactions.reduce((sum, tx) => sum + tx.fee, 0))) throw new Error('Invalid template totals');
      if (result.transactions.every(tx => tx.sigops !== undefined) && !atomic(result.transactions.reduce((sum, tx) => sum + (tx.sigops ?? 0), 0))) throw new Error('Invalid template sigops total');
      if (context && (result.height !== context.checkpoint.height + 1 || result.previousblockhash !== context.checkpoint.block_hash)) throw new Error('Template parent does not match Core');
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
        configured_network: network, observation_context: context, weight_basis: 'core-transaction-weights', estimated_weight: null,
        total_weight: result.transactions.reduce((sum, tx) => sum + tx.weight, 0),
        total_fees_sats: result.transactions.reduce((sum, tx) => sum + tx.fee, 0),
        sigops_count: result.transactions.every(tx => typeof tx.sigops === 'number') ? result.transactions.reduce((sum, tx) => sum + (tx.sigops ?? 0), 0) : null,
        coinbase_value_sats: result.coinbasevalue ?? null, fingerprint_hash: fingerprint(txids), observed_at_utc: new Date(observedAt).toISOString(), txids,
      };
      await this.remember(template);
      if (requestedTipRevision !== this.tipRevision || network !== config.MEMPOOL.NETWORK) {
        source.status = 'degraded'; source.last_error = 'Captured template acknowledged after selected tip changed';
        return template;
      }
      source.status = 'active';
      source.last_template_at = template.observed_at_utc;
      source.last_error = null;
      this.currentHeight = result.height;
      this.currentParentHash = result.previousblockhash;
      this.currentContext = context;
      this.lastCoreTemplateId = template.template_id;
      return template;
    } catch (error) {
      source.status = 'offline';
      source.last_error = 'Core template observation unavailable';
      this.currentContext = null;
      this.lastCoreTemplateId = null;
      logger.debug('template collector: Core template observation unavailable');
      return null;
    }
  }

  /** This backend's own projection of the next block, as a template. */
  /** @asyncUnsafe Collection callers report publication failure. */
  public async collectProjection(now?: number): Promise<CandidateTemplate | null> {
    const source = this.sources.get('src-mempool-projection') as TemplateSource;
    let projection: ReturnType<ProjectionReader>;
    try { projection = this.readProjection(); }
    catch { source.status = 'degraded'; source.last_error = 'Projection data unavailable'; return null; }
    if (!projection || this.currentHeight === null || this.currentParentHash === null) {
      source.status = 'not_collected';
      source.last_error = projection ? 'height unknown until Core answered getblocktemplate' : 'no projection available yet';
      return null;
    }
    const network = config.MEMPOOL.NETWORK;
    const revision = this.tipRevision;
    const validProjection = (value: NonNullable<ReturnType<ProjectionReader>>) => Array.isArray(value.transactionIds) && value.transactionIds.length <= 100000 && Number.isSafeInteger(value.nTx) && value.nTx === value.transactionIds.length && Number.isSafeInteger(value.blockVSize * 4) && value.blockVSize >= 0 && money(value.totalFees) && new Set(value.transactionIds).size === value.transactionIds.length && value.transactionIds.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    let context: TemplateObservationContext | null;
    try {
      const observation = await this.observeCore(network, async () => this.readProjection());
      if (!observation.value || !validProjection(observation.value) || revision !== this.tipRevision || (observation.context && (this.currentHeight !== observation.context.checkpoint.height + 1 || this.currentParentHash !== observation.context.checkpoint.block_hash))) throw new Error('Projection parent changed');
      projection = observation.value;
      const input = this.lastCoreTemplateId ? this.getTemplateById(this.lastCoreTemplateId) : null;
      const inputId = input?.configured_network === network && input.height === this.currentHeight && input.prev_block_hash === this.currentParentHash ? input.template_id : null;
      context = observation.context ? Object.freeze({ ...observation.context, provenance: 'backend-mempool-projection', input_core_template_id: inputId }) : null;
    } catch { source.status = 'degraded'; source.last_error = 'Projection source observation unavailable'; return null; }
    const observedAt = now ?? Date.now();
    const txids = projection.transactionIds;
    const template: CandidateTemplate = {
      template_id: `tmpl-projection-${this.currentHeight}-${observedAt}`, source_id: source.source_id, source_name: source.name, source_type: 'mempool_projection',
      height: this.currentHeight, prev_block_hash: this.currentParentHash, tx_count: projection.nTx,
      configured_network: network, observation_context: context, weight_basis: 'vsize-derived-estimate', estimated_weight: projection.blockVSize * 4,
      total_weight: null, total_fees_sats: projection.totalFees, sigops_count: null, coinbase_value_sats: null,
      fingerprint_hash: fingerprint(txids), observed_at_utc: new Date(observedAt).toISOString(), txids: [...txids],
    };
    await this.remember(template);
    if (revision !== this.tipRevision || network !== config.MEMPOOL.NETWORK || template.height !== this.currentHeight || template.prev_block_hash !== this.currentParentHash) {
      source.status = 'degraded'; source.last_error = 'Captured projection acknowledged after selected tip changed';
      return template;
    }
    source.status = 'active';
    source.last_template_at = template.observed_at_utc;
    source.last_error = null;
    return template;
  }

  public collect(now?: number): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return this.work.track(this.executeCollection(now));
  }

  /** @asyncUnsafe The polling and event owners handle collection failures. */
  private async executeCollection(now?: number): Promise<void> {
    if (this.polling) { return; }
    this.polling = true;
    try {
      await this.collectCoreTemplate(now);
      await this.collectProjection(now);
    } finally {
      this.polling = false;
    }
  }

  public startPolling(intervalMs: number = TEMPLATE_LIMITS.pollMs): void {
    if (this.pollTimer || this.stopping) { return; }
    this.pollTimer = setInterval(() => { this.collect().catch(() => undefined); }, intervalMs);
    this.pollTimer.unref?.();
    // The first poll waits for the main loop to have authenticated and filled the mempool.
    this.initialPollTimer = setTimeout(() => { this.collect().catch(() => undefined); }, 30_000);
    this.initialPollTimer.unref?.();
  }

  public stopPolling(): void {
    this.stopping = true;
    if (this.initialPollTimer) { clearTimeout(this.initialPollTimer); this.initialPollTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  public drain(): Promise<void> { return this.work.drain(); }

  /** Called from the block hub: compares the mined block with the latest template for its height. */
  public observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): MinedBlockTemplateComparison | null {
    this.tipRevision++;
    this.currentContext = null;
    this.lastCoreTemplateId = null;
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
    return [...this.sources.values()].map(source => ({ ...source }));
  }

  public getTemplatesForHeight(height?: number): CandidateTemplate[] {
    const list = height === undefined ? this.templates : this.templates.filter(template => template.height === height);
    return list.map(template => ({ ...template, txids: template.txids.slice(0, TEMPLATE_LIMITS.txidsInResponse), txids_returned_count: Math.min(template.txids.length, TEMPLATE_LIMITS.txidsInResponse), txids_truncated: template.txids.length > TEMPLATE_LIMITS.txidsInResponse }));
  }

  public getTemplateById(templateId: string): CandidateTemplate | null {
    const template = this.templates.find(candidate => candidate.template_id === templateId);
    return template ? { ...template, txids: [...template.txids] } : null;
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
    const ca = a.observation_context ?? null, cb = b.observation_context ?? null;
    const comparable = !!ca && !!cb && ca.network === cb.network && ca.genesis_hash === cb.genesis_hash && ca.block_one_hash === cb.block_one_hash && ca.signet_challenge === cb.signet_challenge && ca.checkpoint.height === cb.checkpoint.height && ca.checkpoint.block_hash === cb.checkpoint.block_hash && a.height === b.height && a.prev_block_hash === b.prev_block_hash;
    return {
      template_a_id: a.template_id, template_b_id: b.template_id, height: a.height,
      similarity_score: Number((common.length / Math.max(1, Math.max(a.txids.length, b.txids.length))).toFixed(4)),
      added_to_b: b.txids.filter(txid => !setA.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      removed_from_b: a.txids.filter(txid => !setB.has(txid)).slice(0, TEMPLATE_LIMITS.txidsInResponse),
      observation_context_a: ca, observation_context_b: cb, comparison_context: !ca || !cb ? 'unavailable' : comparable ? 'same-observed-context' : 'different-observed-context',
      reordered_count: reordered, fee_delta_sats: comparable ? b.total_fees_sats - a.total_fees_sats : null, weight_delta: comparable && a.total_weight !== null && b.total_weight !== null ? b.total_weight - a.total_weight : null,
      explanation: comparable
        ? 'Both templates extend the same parent; differences are selection and ordering differences between the two sources at their observation times.'
        : 'Observed context is unavailable or differs; listed transaction set differences are raw observations, not a comparable policy or numeric fee/weight comparison.',
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
