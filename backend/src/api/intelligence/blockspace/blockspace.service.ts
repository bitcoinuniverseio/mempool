import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import config from '../../../config';
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import { classifyTransaction } from '../protocols/protocol-activity';
import {
  BlockspaceSemanticClass,
  BlockspaceCompositionPoint,
  BlockspaceRegimeEvent,
  BlockspaceTxEvidence,
  BlockspaceOverview,
} from './blockspace.models';

/**
 * Blockspace composition measured from the blocks this backend processes.
 *
 * The revision this replaces answered every read with constants: a taxonomy
 * with invented shares, a time series of invented blocks, two invented fee
 * regimes and, for any txid whatsoever, "Simple Monetary Payment, 564 WU".
 * Every number here now comes from a transaction the main loop handed over,
 * classified by what its inputs, outputs and witnesses contain, and the
 * window each figure covers is reported with it.
 */

export class BlockspaceUnavailableError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface ClassDefinition {
  class_id: string;
  name: string;
  category: BlockspaceSemanticClass['category'];
  description: string;
}

/** Classes in priority order: a transaction is counted under the first that matches. */
export const CLASSES: ClassDefinition[] = [
  { class_id: 'class-coinbase', name: 'Coinbase', category: 'infrastructure', description: 'The block reward transaction.' },
  { class_id: 'class-inscription', name: 'Inscriptions', category: 'arbitrary_data', description: 'Transactions revealing an ordinals inscription envelope in a taproot witness.' },
  { class_id: 'class-runes', name: 'Runes', category: 'arbitrary_data', description: 'Transactions carrying a valid runestone in an OP_RETURN output.' },
  { class_id: 'class-op-return', name: 'Data Carriers', category: 'arbitrary_data', description: 'Transactions with an OP_RETURN output that is not a runestone.' },
  { class_id: 'class-coinjoin-like', name: 'Equal-Output Batches', category: 'monetary', description: 'Five or more inputs and five or more outputs of the same value, the shape of a coinjoin.' },
  { class_id: 'class-batched-payout', name: 'Batched Payouts', category: 'monetary', description: 'Ten or more outputs from few inputs, the shape of an exchange or pool payout.' },
  { class_id: 'class-consolidation', name: 'Consolidations', category: 'infrastructure', description: 'Five or more inputs into one or two outputs.' },
  { class_id: 'class-simple-payment', name: 'Simple Payments', category: 'monetary', description: 'At most two inputs and two outputs, no data.' },
  { class_id: 'class-other-monetary', name: 'Other Payments', category: 'monetary', description: 'Everything else that moves value without carrying data.' },
];

const REGIMES: { type: BlockspaceRegimeEvent['regime_type']; floor: number; driver: string }[] = [
  { type: 'extreme_congestion', floor: 100, driver: 'Median fee rate at or above 100 sat/vB' },
  { type: 'data_minting_spike', floor: 30, driver: 'Median fee rate between 30 and 100 sat/vB' },
  { type: 'monetary_standard', floor: 5, driver: 'Median fee rate between 5 and 30 sat/vB' },
  { type: 'consolidation_friendly', floor: 0, driver: 'Median fee rate below 5 sat/vB' },
];

export interface TxClassification {
  class_id: string;
  tags: string[];
}

export function classifyBlockspace(tx: TransactionExtended): TxClassification {
  const tags: string[] = [];
  const inputs = tx.vin?.length ?? 0;
  const outputs = tx.vout?.length ?? 0;
  if (tx.vin?.some(vin => vin.is_coinbase)) { return { class_id: 'class-coinbase', tags: ['coinbase'] }; }
  const protocols = classifyTransaction(tx);
  if (tx.vin?.some(vin => vin.sequence !== undefined && vin.sequence < 0xfffffffe)) { tags.push('rbf_signaling'); }
  if (tx.vin?.some(vin => (vin.witness?.length ?? 0) > 0)) { tags.push('segwit'); }
  if (protocols.ordinals) { tags.push(`inscriptions:${protocols.ordinals}`); }
  if (protocols.brc20) { tags.push(`brc20:${protocols.brc20}`); }
  if (protocols.runes) { tags.push(`runes_operations:${protocols.runes}`); }
  if (protocols.op_return) { tags.push(`op_return_outputs:${protocols.op_return}`); }
  tags.push(`inputs:${inputs}`, `outputs:${outputs}`);
  if (protocols.ordinals) { return { class_id: 'class-inscription', tags }; }
  if (protocols.runes) { return { class_id: 'class-runes', tags }; }
  if (protocols.op_return) { return { class_id: 'class-op-return', tags }; }
  const values = new Map<number, number>();
  for (const vout of tx.vout ?? []) { values.set(vout.value, (values.get(vout.value) ?? 0) + 1); }
  const largestEqualGroup = Math.max(0, ...values.values());
  if (inputs >= 5 && outputs >= 5 && largestEqualGroup >= 5) { tags.push(`equal_outputs:${largestEqualGroup}`); return { class_id: 'class-coinjoin-like', tags }; }
  if (outputs >= 10 && inputs <= 3) { return { class_id: 'class-batched-payout', tags }; }
  if (inputs >= 5 && outputs <= 2) { return { class_id: 'class-consolidation', tags }; }
  if (inputs <= 2 && outputs <= 2) { return { class_id: 'class-simple-payment', tags }; }
  return { class_id: 'class-other-monetary', tags };
}

interface BlockTally {
  height: number;
  hash: string;
  timestamp: number;
  weight: number;
  fees: number;
  medianFee: number | null;
  observedAt: string;
  perClass: Record<string, { transactions: number; weight: number; fees: number }>;
}

const DAY_SECONDS = 86_400;

export class BlockspaceService {
  private static instance: BlockspaceService;
  private tallies: BlockTally[] = [];
  private regimes: BlockspaceRegimeEvent[] = [];
  private maxBlocks = 288;

  private constructor() {}

  public static getInstance(): BlockspaceService {
    if (!BlockspaceService.instance) {
      BlockspaceService.instance = new BlockspaceService();
    }
    return BlockspaceService.instance;
  }

  /** Test seam. */
  public reset(): void {
    this.tallies = [];
    this.regimes = [];
  }

  public observeBlock(block: BlockExtended, transactions: TransactionExtended[]): void {
    const tally: BlockTally = {
      height: block.height, hash: block.id, timestamp: block.timestamp, weight: block.weight,
      fees: block.extras?.totalFees ?? transactions.reduce((sum, tx) => sum + (tx.fee ?? 0), 0),
      medianFee: typeof block.extras?.medianFee === 'number' ? block.extras.medianFee : null,
      observedAt: new Date().toISOString(),
      perClass: {},
    };
    for (const definition of CLASSES) { tally.perClass[definition.class_id] = { transactions: 0, weight: 0, fees: 0 }; }
    for (const tx of transactions) {
      const { class_id } = classifyBlockspace(tx);
      const entry = tally.perClass[class_id];
      entry.transactions += 1;
      entry.weight += tx.weight ?? 0;
      entry.fees += tx.fee ?? 0;
    }
    this.tallies = this.tallies.filter(existing => existing.height < block.height);
    this.tallies.push(tally);
    if (this.tallies.length > this.maxBlocks) { this.tallies = this.tallies.slice(-this.maxBlocks); }
    // Derive regimes from the same retained branch as composition. Replacement
    // blocks must remove the fee regimes caused by the orphaned tallies too.
    this.regimes = [];
    for (const retained of this.tallies) this.updateRegimes(retained);
  }

  private regimeFor(medianFee: number): { type: BlockspaceRegimeEvent['regime_type']; driver: string } {
    return REGIMES.find(regime => medianFee >= regime.floor) ?? REGIMES[REGIMES.length - 1];
  }

  /** A regime is a run of consecutive observed blocks whose median fee rate falls in one band. */
  private updateRegimes(tally: BlockTally): void {
    if (tally.medianFee === null) { return; }
    const regime = this.regimeFor(tally.medianFee);
    const current = this.regimes[0];
    if (current && current.end_height === undefined && current.regime_type === regime.type) {
      const fees = this.tallies.filter(item => item.height >= current.start_height && item.height <= tally.height)
        .map(item => item.medianFee).filter((fee): fee is number => fee !== null).sort((a, b) => a - b);
      const middle = Math.floor(fees.length / 2);
      current.median_feerate = fees.length % 2 ? fees[middle] : (fees[middle - 1] + fees[middle]) / 2;
      return;
    }
    if (current && current.end_height === undefined) { current.end_height = tally.height - 1; }
    this.regimes.unshift({
      regime_id: `regime-${config.MEMPOOL.NETWORK}-${tally.height}`, network: config.MEMPOOL.NETWORK, start_height: tally.height,
      regime_type: regime.type, median_feerate: tally.medianFee, primary_demand_driver: regime.driver, detected_at: tally.observedAt,
    });
    if (this.regimes.length > 50) { this.regimes = this.regimes.slice(0, 50); }
  }

  private window(): BlockTally[] {
    if (this.tallies.length === 0) { throw new BlockspaceUnavailableError('no-observed-blocks', 'No block has been observed by this backend yet; blockspace composition is measured from processed blocks.'); }
    const tip = this.tallies[this.tallies.length - 1];
    return this.tallies.filter(tally => tally.timestamp >= tip.timestamp - DAY_SECONDS);
  }

  public getTaxonomy(): BlockspaceSemanticClass[] {
    const window = this.window();
    const totalWeight = window.reduce((sum, tally) => sum + tally.weight, 0);
    const totalFees = window.reduce((sum, tally) => sum + tally.fees, 0);
    const share = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
    return CLASSES.map(definition => {
      const totals = window.reduce((sum, tally) => {
        const entry = tally.perClass[definition.class_id];
        return { transactions: sum.transactions + entry.transactions, weight: sum.weight + entry.weight, fees: sum.fees + entry.fees };
      }, { transactions: 0, weight: 0, fees: 0 });
      return {
        class_id: definition.class_id, name: definition.name, category: definition.category, description: definition.description,
        weight_share_percentage: share(totals.weight, totalWeight), fee_share_percentage: share(totals.fees, totalFees), tx_count_24h: totals.transactions,
      };
    });
  }

  public getComposition(limit = 24): BlockspaceCompositionPoint[] {
    const window = this.window();
    const sum = (tally: BlockTally, category: BlockspaceSemanticClass['category']): number =>
      CLASSES.filter(definition => definition.category === category).reduce((total, definition) => total + tally.perClass[definition.class_id].weight, 0);
    return window.slice(-Math.max(1, Math.min(288, limit))).reverse().map(tally => ({
      block_height: tally.height, timestamp_utc: new Date(tally.timestamp * 1000).toISOString(), total_weight: tally.weight, total_fee_sats: tally.fees,
      monetary_weight: sum(tally, 'monetary'), layer2_weight: sum(tally, 'layer2'), arbitrary_data_weight: sum(tally, 'arbitrary_data'),
      consolidation_weight: tally.perClass['class-consolidation'].weight,
    }));
  }

  public getRegimes(): BlockspaceRegimeEvent[] {
    this.window();
    return this.regimes;
  }

  public getOverview(): BlockspaceOverview {
    const window = this.window();
    const medians = window.map(tally => tally.medianFee).filter((value): value is number => value !== null).sort((a, b) => a - b);
    const median = medians.length ? medians[Math.floor(medians.length / 2)] : 0;
    const tip = window[window.length - 1];
    return {
      network: config.MEMPOOL.NETWORK,
      current_regime: this.regimes[0] ?? null,
      median_feerate_24h: median,
      taxonomy_classes: this.getTaxonomy(),
      composition_timeseries: this.getComposition(24),
      window: { blocks: window.length, from_height: window[0].height, to_height: tip.height, covers_24h: this.tallies[0].timestamp <= tip.timestamp - DAY_SECONDS },
      checkpoint: { height: tip.height, hash: tip.hash },
      last_updated: new Date().toISOString(),
    };
  }

  /** Classifies one transaction fetched from the owned index; null when the index does not have it. */
  public async getTxSemantics(txid: string): Promise<BlockspaceTxEvidence | null> {
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) { return null; }
    let tx: TransactionExtended;
    try { tx = await bitcoinApi.$getRawTransaction(txid) as TransactionExtended; } catch { return null; }
    const { class_id, tags } = classifyBlockspace(tx);
    const definition = CLASSES.find(entry => entry.class_id === class_id) as ClassDefinition;
    const vsize = Math.ceil((tx.weight ?? 0) / 4);
    return {
      txid, primary_class: definition.name, class_id, secondary_tags: tags, weight: tx.weight ?? 0, fee_sats: tx.fee ?? 0,
      feerate_sats_vb: vsize > 0 ? Math.round(((tx.fee ?? 0) / vsize) * 100) / 100 : 0,
      evidence_summary: `${definition.description} Observed ${tx.vin?.length ?? 0} input(s) and ${tx.vout?.length ?? 0} output(s).`,
      confirmed: Boolean(tx.status?.confirmed), block_height: tx.status?.confirmed ? (tx.status.block_height ?? null) : null,
    };
  }
}

export const blockspaceService = BlockspaceService.getInstance();
