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
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
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
  weight: number | null;
  fees: number | null;
  previousHash: string | null;
  transactionsComplete: boolean | null;
  medianFee: number | null;
  observedAt: string;
  perClass: Record<string, { transactions: number; weight: number | null; fees: number | null }>;
}

const DAY_SECONDS = 86_400;
const amount = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null;
const feeRate = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const sumKnown = (values: Array<number | null>): number | null => {
  if (values.some(v => v === null)) return null;
  const sum = values.reduce<number>((total, v) => total + v!, 0);
  return Number.isSafeInteger(sum) ? sum : null;
};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

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
    if (!hash(block.id) || amount(block.height) === null || amount(block.timestamp) === null || !Array.isArray(transactions) || transactions.some(tx => !tx || !Array.isArray(tx.vin) || !Array.isArray(tx.vout))) return;
    const tally: BlockTally = {
      height: block.height, hash: block.id, timestamp: block.timestamp, weight: amount(block.weight),
      fees: amount(block.extras?.totalFees) ?? sumKnown(transactions.map(tx => amount(tx.fee))),
      previousHash: hash(block.previousblockhash) ? block.previousblockhash : null,
      transactionsComplete: amount(block.tx_count) === null ? null : block.tx_count === transactions.length,
      medianFee: feeRate(block.extras?.medianFee),
      observedAt: new Date().toISOString(),
      perClass: {},
    };
    for (const definition of CLASSES) { tally.perClass[definition.class_id] = { transactions: 0, weight: 0, fees: 0 }; }
    for (const tx of transactions) {
      const { class_id } = classifyBlockspace(tx);
      const entry = tally.perClass[class_id];
      entry.transactions += 1;
      entry.weight = sumKnown([entry.weight, amount(tx.weight)]);
      entry.fees = sumKnown([entry.fees, amount(tx.fee)]);
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
    const previous = this.tallies.find(item => item.height === tally.height - 1);
    if ((!previous || tally.medianFee === null) && this.regimes[0]?.end_height === undefined && this.regimes[0]) this.regimes[0].end_height = tally.height - 1;
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
    const totalWeight = sumKnown(window.map(tally => tally.weight));
    const totalFees = sumKnown(window.map(tally => tally.fees));
    const share = (part: number | null, whole: number | null): number | null => part === null || whole === null ? null : whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
    return CLASSES.map(definition => {
      const totals = window.reduce((sum, tally) => {
        const entry = tally.perClass[definition.class_id];
        return { transactions: sum.transactions + entry.transactions, weight: sumKnown([sum.weight, entry.weight]), fees: sumKnown([sum.fees, entry.fees]) };
      }, { transactions: 0, weight: 0 as number | null, fees: 0 as number | null });
      return {
        class_id: definition.class_id, name: definition.name, category: definition.category, description: definition.description,
        weight_share_percentage: share(totals.weight, totalWeight), fee_share_percentage: share(totals.fees, totalFees), tx_count_24h: totals.transactions,
      };
    });
  }

  public getComposition(limit = 24): BlockspaceCompositionPoint[] {
    const window = this.window();
    const sum = (tally: BlockTally, category: BlockspaceSemanticClass['category']): number | null => {
      const classes = CLASSES.filter(definition => definition.category === category);
      return classes.length ? sumKnown(classes.map(definition => tally.perClass[definition.class_id].weight)) : null;
    };
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
    const middle = Math.floor(medians.length / 2);
    const median = medians.length ? medians.length % 2 ? medians[middle] : (medians[middle - 1] + medians[middle]) / 2 : null;
    const tip = window[window.length - 1];
    let contiguous: boolean | null = true;
    for (let index = 1; index < this.tallies.length; index++) {
      const current = this.tallies[index], prior = this.tallies[index - 1];
      if (current.height !== prior.height + 1 || current.previousHash !== null && current.previousHash !== prior.hash) { contiguous = false; break; }
      if (current.previousHash === null) contiguous = null;
    }
    const complete = this.tallies.some(t => t.transactionsComplete === false) ? false : this.tallies.every(t => t.transactionsComplete === true) ? true : null;
    const spansDay = this.tallies[0].timestamp <= tip.timestamp - DAY_SECONDS;
    return {
      network: config.MEMPOOL.NETWORK,
      current_regime: tip.medianFee === null ? null : this.regimes[0] ?? null,
      median_feerate_24h: median,
      fee_metric: 'median_of_observed_block_median_feerates',
      taxonomy_classes: this.getTaxonomy(),
      composition_timeseries: this.getComposition(24),
      window: { blocks: window.length, from_height: window[0].height, to_height: tip.height, covers_24h: !spansDay || contiguous === false || complete === false ? false : contiguous === true && complete === true ? true : null,
        contiguous, transactions_complete: complete, median_fee_observations: medians.length, time_basis: 'block_timestamp_relative_to_observed_tip' },
      checkpoint: { height: tip.height, hash: tip.hash },
      last_updated: tip.observedAt,
    };
  }

  /** Classifies one transaction fetched from the owned index; null when the index does not have it. */
  public async getTxSemantics(txid: string): Promise<BlockspaceTxEvidence | null> {
    if (typeof txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txid)) throw new BlockspaceUnavailableError('invalid-input', 'A 32-byte hexadecimal transaction ID is required.', 400);
    txid = txid.toLowerCase();
    let tx: TransactionExtended;
    try { tx = await bitcoinApi.$getRawTransaction(txid, false, true) as TransactionExtended; }
    catch (error: any) {
      if (error?.response?.status === 404 && error.response.data === 'Transaction not found') return null;
      throw new BlockspaceUnavailableError('unavailable-bitcoin-reader', 'The owned Bitcoin reader could not establish transaction evidence.');
    }
    if (!tx || tx.txid !== txid || !Array.isArray(tx.vin) || !Array.isArray(tx.vout) || !tx.vin.length || !tx.vout.length) throw new BlockspaceUnavailableError('malformed-transaction-source', 'The owned reader returned incomplete or mismatched transaction evidence.');
    const { class_id, tags } = classifyBlockspace(tx);
    const definition = CLASSES.find(entry => entry.class_id === class_id) as ClassDefinition;
    const weight = amount(tx.weight), fee = amount(tx.fee);
    const vsize = weight === null || weight === 0 ? null : Math.ceil(weight / 4);
    const confirmed = typeof tx.status?.confirmed === 'boolean' ? tx.status.confirmed : null;
    return {
      txid, primary_class: definition.name, class_id, secondary_tags: tags, weight, fee_sats: fee,
      feerate_sats_vb: vsize !== null && fee !== null ? Math.round((fee / vsize) * 100) / 100 : null,
      evidence_summary: `${definition.description} Observed ${tx.vin?.length ?? 0} input(s) and ${tx.vout?.length ?? 0} output(s).`,
      confirmed, block_height: confirmed === true ? amount(tx.status.block_height) : null,
    };
  }
}

export const blockspaceService = BlockspaceService.getInstance();
