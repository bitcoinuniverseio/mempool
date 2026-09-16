// Protocol activity measured from the blocks this backend processes.
//
// Every block that reaches the main loop passes through observeBlock with its
// full transactions. For each transaction the observer decodes what is
// actually there: a runestone in an OP_RETURN output, inscription envelopes
// in taproot witnesses, BRC-20 bodies inside those envelopes, plain
// OP_RETURN outputs. Counts, weight and fees are summed per block and kept
// in a bounded rolling window. Metrics are reported together with the exact
// window they cover; nothing is extrapolated to a day the backend did not see.
import { BlockExtended, TransactionExtended } from '../../../mempool.interfaces';
import { decodeRunestone } from './runestone';
import { parseBrc20, parseInscriptionEnvelopes } from './inscription-envelope';

export const OBSERVED_PROTOCOLS = ['runes', 'ordinals', 'brc20', 'op_return'] as const;
export type ObservedProtocol = typeof OBSERVED_PROTOCOLS[number];

interface ProtocolTally {
  transactions: number;
  weight: number;
  fees: number;
  /** Runes edicts, inscriptions, BRC-20 operations, OP_RETURN outputs. */
  operations: number;
}

export interface BlockObservation {
  height: number;
  hash: string;
  timestamp: number;
  transactions: number;
  weight: number;
  fees: number;
  protocols: Record<ObservedProtocol, ProtocolTally>;
}

export interface ProtocolActivityMetrics {
  protocol_id: string;
  network: string;
  source: 'backend-block-observer';
  tx_count: number;
  operation_count: number;
  weight_share_percent: number;
  fee_share_percent: number;
  window: {
    blocks: number;
    from_height: number;
    to_height: number;
    from_timestamp: number;
    to_timestamp: number;
    covers_24h: boolean;
  };
  checkpoint: { height: number; hash: string };
  completeness: 'complete' | 'partial';
  generated_at: string;
}

const DAY_SECONDS = 24 * 60 * 60;

function emptyTally(): ProtocolTally {
  return { transactions: 0, weight: 0, fees: 0, operations: 0 };
}

function witnessScripts(tx: TransactionExtended): Buffer[] {
  const scripts: Buffer[] = [];
  for (const vin of tx.vin ?? []) {
    const witness = vin.witness;
    if (!witness || witness.length < 2) { continue; }
    const hasAnnex = witness[witness.length - 1].startsWith('50');
    if (witness.length <= (hasAnnex ? 2 : 1)) { continue; }
    const script = witness[witness.length - (hasAnnex ? 3 : 2)];
    if (script && /^[0-9a-f]*$/i.test(script) && script.length % 2 === 0) {
      scripts.push(Buffer.from(script, 'hex'));
    }
  }
  return scripts;
}

/** Which protocols a single transaction carries, and how many operations of each. */
export function classifyTransaction(tx: TransactionExtended): Partial<Record<ObservedProtocol, number>> {
  const found: Partial<Record<ObservedProtocol, number>> = {};
  for (const vout of tx.vout ?? []) {
    if (vout.scriptpubkey_type !== 'op_return' || !vout.scriptpubkey) { continue; }
    found.op_return = (found.op_return ?? 0) + 1;
    const runestone = decodeRunestone(Buffer.from(vout.scriptpubkey, 'hex'));
    if (runestone && runestone.flaws.length === 0) {
      const operations = runestone.edicts.length + (runestone.etching ? 1 : 0) + (runestone.mint ? 1 : 0);
      found.runes = (found.runes ?? 0) + Math.max(operations, 1);
    }
  }
  for (const script of witnessScripts(tx)) {
    const envelopes = parseInscriptionEnvelopes(script).filter(envelope => !envelope.incomplete);
    if (envelopes.length === 0) { continue; }
    found.ordinals = (found.ordinals ?? 0) + envelopes.length;
    const brc20 = envelopes.filter(envelope => parseBrc20(envelope) !== null).length;
    if (brc20 > 0) { found.brc20 = (found.brc20 ?? 0) + brc20; }
  }
  return found;
}

export class ProtocolActivityObserver {
  private observations: BlockObservation[] = [];

  constructor(private readonly network: string, private readonly maxBlocks = 288) {}

  public observeBlock(block: BlockExtended, transactions: TransactionExtended[]): BlockObservation {
    const observation: BlockObservation = {
      height: block.height,
      hash: block.id,
      timestamp: block.timestamp,
      transactions: transactions.length,
      weight: block.weight,
      fees: block.extras?.totalFees ?? transactions.reduce((sum, tx) => sum + (tx.fee ?? 0), 0),
      protocols: { runes: emptyTally(), ordinals: emptyTally(), brc20: emptyTally(), op_return: emptyTally() },
    };
    for (const tx of transactions) {
      const found = classifyTransaction(tx);
      for (const protocol of OBSERVED_PROTOCOLS) {
        const operations = found[protocol];
        if (!operations) { continue; }
        const tally = observation.protocols[protocol];
        tally.transactions += 1;
        tally.operations += operations;
        tally.weight += tx.weight ?? 0;
        tally.fees += tx.fee ?? 0;
      }
    }
    // A reorg re-observes a height: the newer observation replaces the old one.
    this.observations = this.observations.filter(existing => existing.height < block.height);
    this.observations.push(observation);
    if (this.observations.length > this.maxBlocks) {
      this.observations = this.observations.slice(-this.maxBlocks);
    }
    return observation;
  }

  public isObserved(protocolId: string): protocolId is ObservedProtocol {
    return (OBSERVED_PROTOCOLS as readonly string[]).includes(protocolId);
  }

  public blocksObserved(): number {
    return this.observations.length;
  }

  /** Metrics over the observed blocks inside the last 24 hours of the tip, or null before any block was observed. */
  public getMetrics(protocolId: ObservedProtocol, now = Date.now()): ProtocolActivityMetrics | null {
    if (this.observations.length === 0) { return null; }
    const tip = this.observations[this.observations.length - 1];
    const windowStart = tip.timestamp - DAY_SECONDS;
    const window = this.observations.filter(observation => observation.timestamp >= windowStart);
    const totalWeight = window.reduce((sum, observation) => sum + observation.weight, 0);
    const totalFees = window.reduce((sum, observation) => sum + observation.fees, 0);
    const tally = window.reduce((sum, observation) => {
      const entry = observation.protocols[protocolId];
      sum.transactions += entry.transactions;
      sum.operations += entry.operations;
      sum.weight += entry.weight;
      sum.fees += entry.fees;
      return sum;
    }, emptyTally());
    const first = window[0];
    // Complete only when the observer holds a block older than the window,
    // so the window's leading edge is real rather than the process start.
    const coversDay = this.observations[0].timestamp <= windowStart;
    const share = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
    return {
      protocol_id: protocolId,
      network: this.network,
      source: 'backend-block-observer',
      tx_count: tally.transactions,
      operation_count: tally.operations,
      weight_share_percent: share(tally.weight, totalWeight),
      fee_share_percent: share(tally.fees, totalFees),
      window: {
        blocks: window.length,
        from_height: first.height,
        to_height: tip.height,
        from_timestamp: first.timestamp,
        to_timestamp: tip.timestamp,
        covers_24h: coversDay,
      },
      checkpoint: { height: tip.height, hash: tip.hash },
      completeness: coversDay ? 'complete' : 'partial',
      generated_at: new Date(now).toISOString(),
    };
  }
}
