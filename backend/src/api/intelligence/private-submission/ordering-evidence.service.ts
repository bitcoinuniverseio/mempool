import config from '../../../config';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import { RelayCollectorService, relayCollectorService, RelayEvidenceError } from '../relay/relay-collector.service';
import { CandidateTemplate, TemplateCollectorService, templateCollectorService } from '../templates/template-collector.service';
import { OrderingEvidenceState, TransactionOrderingEvidence } from './private-submission.models';

/**
 * Ordering evidence: how a mined block's transaction order relates to the
 * candidate templates this backend recorded for that height and to the
 * relay collector's first-seen observations.
 *
 * Blocks reach this service through the block observation hub, the same
 * path the template collector uses. For each mined transaction the
 * evidence names what was observed: seen in the mempool before inclusion,
 * present in a recorded template, both, or neither. A height with no
 * recorded template is 'no-template-observed', which is a statement about
 * this backend's coverage and not about the block.
 */

export const ORDERING_LIMITS = { blocks: 50, transactionsPerBlock: 10_000, findingsPerBlock: 200 } as const;

export interface RecordedBlockTransaction {
  txid: string;
  position: number;
  fee: number;
  vsize: number;
  effective_feerate_sats_vb: number | null;
  /** Inputs that spend outputs of transactions earlier in the same block. */
  dependency_txids: string[];
}

export interface RecordedBlock {
  block_hash: string;
  height: number;
  previous_block_hash: string;
  mined_timestamp_utc: string;
  observed_at_utc: string;
  transactions: RecordedBlockTransaction[];
  /** The templates recorded for this height and parent, snapshotted at block receipt. */
  templates: Array<{ template_id: string; source_id: string; observed_at_utc: string; positions: Map<string, number> }>;
  truncated: boolean;
}

export type TemplateCoverage = 'template-observed' | 'no-template-observed';

export interface BlockOrderingEvidence {
  block_hash: string;
  height: number;
  mined_timestamp_utc: string;
  network: string;
  template_coverage: TemplateCoverage;
  templates_compared: string[];
  sensor: { observer_id: string | null; observers: 1 };
  transactions: TransactionOrderingEvidence[];
  truncated: boolean;
  scope: string;
}

export interface OrderingFindings {
  network: string;
  state: 'observed' | 'no-blocks-observed';
  findings: TransactionOrderingEvidence[];
  coverage: Array<{ block_hash: string; height: number; template_coverage: TemplateCoverage; transactions: number; findings: number }>;
  retention: { blocks: number; retained_blocks: number };
  scope: string;
}

export interface OrderingReaders {
  templatesForHeight: (height: number) => CandidateTemplate[];
  firstSeen: (txid: string) => { first_observed_utc: string; source_id: string } | null;
}

export class OrderingEvidenceError extends Error {
  constructor(public readonly code: 'block-not-observed' | 'transaction-not-observed', message: string, public readonly status = 404) {
    super(message);
  }
}

const SCOPE = 'One owned observer: this backend\'s mempool poll (first-seen) and the templates its owned Core node and projection produced for the height. Other nodes\' views, miner intent and private submission channels are not observed; findings describe recorded differences, not causes.';

function ownedReaders(relay: Pick<RelayCollectorService, 'getPropagationForTx'>, templates: Pick<TemplateCollectorService, 'getTemplatesForHeight'>): OrderingReaders {
  return {
    templatesForHeight: height => templates.getTemplatesForHeight(height),
    firstSeen: txid => {
      try {
        const record = relay.getPropagationForTx(txid);
        return { first_observed_utc: record.first_observed_utc, source_id: record.source_id };
      } catch (e) {
        if (e instanceof RelayEvidenceError) { return null; }
        throw e;
      }
    },
  };
}

export class OrderingEvidenceService {
  private blocks = new Map<string, RecordedBlock>();
  private byTxid = new Map<string, string>();

  constructor(private readonly readers: OrderingReaders = ownedReaders(relayCollectorService, templateCollectorService), private readonly network: string = config.MEMPOOL.NETWORK) {}

  /** Called from the block hub with the mined block and its transactions in block order. */
  public observeBlock(block: BlockExtended, transactions: TransactionExtended[], now = Date.now()): RecordedBlock {
    const inBlock = new Set(transactions.map(tx => tx.txid));
    const ordered = transactions.filter(tx => !tx.vin?.some(vin => vin.is_coinbase));
    const truncated = ordered.length > ORDERING_LIMITS.transactionsPerBlock;
    const recorded: RecordedBlockTransaction[] = ordered.slice(0, ORDERING_LIMITS.transactionsPerBlock).map((tx, index) => ({
      txid: tx.txid,
      position: index + 1,
      fee: tx.fee ?? 0,
      vsize: tx.vsize ?? (tx.weight ? Math.ceil(tx.weight / 4) : 0),
      effective_feerate_sats_vb: typeof tx.effectiveFeePerVsize === 'number' && Number.isFinite(tx.effectiveFeePerVsize) ? tx.effectiveFeePerVsize : null,
      dependency_txids: [...new Set((tx.vin ?? []).map(vin => vin.txid).filter((id): id is string => typeof id === 'string' && inBlock.has(id)))],
    }));
    const templates = this.readers.templatesForHeight(block.height)
      .filter(template => template.prev_block_hash === block.previousblockhash && Date.parse(template.observed_at_utc) <= now)
      .map(template => ({ template_id: template.template_id, source_id: template.source_id, observed_at_utc: template.observed_at_utc, positions: new Map(template.txids.map((txid, index) => [txid, index + 1])) }));
    const record: RecordedBlock = {
      block_hash: block.id,
      height: block.height,
      previous_block_hash: block.previousblockhash,
      mined_timestamp_utc: new Date(block.timestamp * 1000).toISOString(),
      observed_at_utc: new Date(now).toISOString(),
      transactions: recorded,
      templates,
      truncated,
    };
    this.blocks.delete(block.id);
    this.blocks.set(block.id, record);
    for (const tx of recorded) { this.byTxid.set(tx.txid, block.id); }
    while (this.blocks.size > ORDERING_LIMITS.blocks) {
      const oldest = this.blocks.keys().next().value as string;
      for (const tx of this.blocks.get(oldest)?.transactions ?? []) { if (this.byTxid.get(tx.txid) === oldest) { this.byTxid.delete(tx.txid); } }
      this.blocks.delete(oldest);
    }
    return record;
  }

  private evidenceFor(block: RecordedBlock, tx: RecordedBlockTransaction): TransactionOrderingEvidence {
    const seen = this.readers.firstSeen(tx.txid);
    const minedAt = Date.parse(block.mined_timestamp_utc);
    const seenBefore = seen !== null && Date.parse(seen.first_observed_utc) <= minedAt;
    const inTemplates = block.templates.filter(template => template.positions.has(tx.txid));
    const earliestTemplate = inTemplates.length ? inTemplates.reduce((a, b) => (Date.parse(b.observed_at_utc) < Date.parse(a.observed_at_utc) ? b : a)) : null;
    const hasTemplates = block.templates.length > 0;
    let reordered = false;
    if (earliestTemplate) {
      // Relative order against the template: the block placed this transaction ahead of
      // one the template placed before it (both in both), so the block moved it earlier.
      const templatePosition = earliestTemplate.positions.get(tx.txid) as number;
      reordered = block.transactions.some(other => other.position > tx.position && (earliestTemplate.positions.get(other.txid) ?? Infinity) < templatePosition);
    }
    let state: OrderingEvidenceState;
    if (!hasTemplates) {
      state = 'insufficient_coverage';
    } else if (tx.dependency_txids.length) {
      state = 'dependency_required_order';
    } else if (reordered) {
      state = 'ordering_changed_between_template_and_block';
    } else if (seenBefore && inTemplates.length) {
      state = 'publicly_observed_before_inclusion';
    } else if (!seenBefore && inTemplates.length) {
      state = 'observed_only_in_template';
    } else if (seenBefore) {
      state = 'publicly_observed_before_inclusion';
    } else {
      state = 'included_without_public_observation';
    }
    const feerate = tx.vsize > 0 ? Math.round((tx.fee / tx.vsize) * 100) / 100 : 0;
    return {
      txid: tx.txid,
      block_hash: block.block_hash,
      block_height: block.height,
      block_position: tx.position,
      first_sensor_seen_utc: seen?.first_observed_utc,
      first_template_seen_utc: earliestTemplate?.observed_at_utc,
      private_receipt_timestamp_utc: undefined,
      mined_timestamp_utc: block.mined_timestamp_utc,
      evidence_state: state,
      fee_sats_vb: feerate,
      package_feerate_sats_vb: tx.effective_feerate_sats_vb ?? feerate,
      dependency_txids: tx.dependency_txids,
      is_ordering_sensitive: tx.dependency_txids.length > 0 || reordered,
      protocol_impact_description: reordered ? 'The block placed this transaction earlier than the recorded template did relative to at least one other transaction both contained.' : undefined,
      confidence_rating: hasTemplates && seen ? 'high' : hasTemplates || seen ? 'medium' : 'low',
      template_coverage: hasTemplates ? 'template-observed' : 'no-template-observed',
      template_ids: inTemplates.map(template => template.template_id),
      template_position: earliestTemplate ? earliestTemplate.positions.get(tx.txid) ?? null : null,
      sensor_observer_id: seen?.source_id ?? null,
    };
  }

  public getTransactionOrdering(txid: string): TransactionOrderingEvidence {
    const blockHash = this.byTxid.get(txid.toLowerCase());
    const block = blockHash ? this.blocks.get(blockHash) : undefined;
    const tx = block?.transactions.find(entry => entry.txid === txid.toLowerCase());
    if (!block || !tx) {
      throw new OrderingEvidenceError('transaction-not-observed', `No block retained by this backend (last ${ORDERING_LIMITS.blocks}) contains that transaction; ordering evidence exists only for mined transactions this observer recorded.`);
    }
    return this.evidenceFor(block, tx);
  }

  public getBlockOrdering(blockHash: string): BlockOrderingEvidence {
    const block = this.blocks.get(blockHash.toLowerCase());
    if (!block) {
      throw new OrderingEvidenceError('block-not-observed', `This backend has not recorded that block (it retains the last ${ORDERING_LIMITS.blocks} it processed).`);
    }
    const transactions = block.transactions.map(tx => this.evidenceFor(block, tx));
    return {
      block_hash: block.block_hash,
      height: block.height,
      mined_timestamp_utc: block.mined_timestamp_utc,
      network: this.network,
      template_coverage: block.templates.length ? 'template-observed' : 'no-template-observed',
      templates_compared: block.templates.map(template => template.template_id),
      sensor: { observer_id: transactions.find(tx => tx.sensor_observer_id)?.sensor_observer_id ?? null, observers: 1 },
      transactions,
      truncated: block.truncated,
      scope: SCOPE,
    };
  }

  /** Notable differences across retained blocks, with per-block coverage so absence of findings is never mistaken for absence of data. */
  public listOrderingFindings(): OrderingFindings {
    const notable: OrderingEvidenceState[] = ['ordering_changed_between_template_and_block', 'observed_only_in_template', 'included_without_public_observation', 'dependency_required_order'];
    const findings: TransactionOrderingEvidence[] = [];
    const coverage: OrderingFindings['coverage'] = [];
    for (const block of [...this.blocks.values()].reverse()) {
      const evidence = block.transactions.map(tx => this.evidenceFor(block, tx)).filter(entry => notable.includes(entry.evidence_state)).slice(0, ORDERING_LIMITS.findingsPerBlock);
      findings.push(...evidence);
      coverage.push({ block_hash: block.block_hash, height: block.height, template_coverage: block.templates.length ? 'template-observed' : 'no-template-observed', transactions: block.transactions.length, findings: evidence.length });
    }
    return {
      network: this.network,
      state: this.blocks.size ? 'observed' : 'no-blocks-observed',
      findings,
      coverage,
      retention: { blocks: ORDERING_LIMITS.blocks, retained_blocks: this.blocks.size },
      scope: SCOPE,
    };
  }

  /** Test seam. */
  public resetForTests(): void {
    this.blocks.clear();
    this.byTxid.clear();
  }
}

export const orderingEvidenceService = new OrderingEvidenceService();
