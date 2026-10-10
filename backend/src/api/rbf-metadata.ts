import { TransactionStripped } from '../mempool.interfaces';

/** Exactly the fields used by RBF logic; this is never a full transaction DTO. */
export interface RbfMetadataInput {
  txid: string; weight: number; fee?: number; firstSeen?: number;
  acceleration?: boolean; effectiveFeePerVsize?: number;
  vin: Array<{ sequence: number; txid?: string; vout?: number }>;
  vout: Array<{ value: number }>;
}
export class RbfTxMetadata {
  readonly txid: string;
  readonly stripped: TransactionStripped;
  readonly signalsRbf: boolean;
  readonly firstSeen?: number;
  readonly spends: Array<{ txid?: string; vout?: number }>;
  readonly budgetBytes: number;
  constructor(tx: RbfMetadataInput) {
    this.txid = tx.txid; this.firstSeen = tx.firstSeen;
    // Match Common.stripTransaction exactly; preserve its zero/optional-field semantics.
    this.stripped = { txid: tx.txid, fee: tx.fee || 0, vsize: tx.weight / 4,
      value: tx.vout.reduce((sum, output) => sum + (output.value ? output.value : 0), 0),
      acc: tx.acceleration || undefined, rate: tx.effectiveFeePerVsize, time: tx.firstSeen || undefined };
    this.signalsRbf = tx.vin.some(input => input.sequence < 0xfffffffe);
    this.spends = tx.vin.map(input => ({ txid: input.txid, vout: input.vout }));
    // Conservative admission accounting, not a claim to measure V8 overhead.
    this.budgetBytes = 512 + tx.txid.length * 2 + this.spends.reduce((sum, input) => sum + 128 + (input.txid?.length || 0) * 2, 0);
  }
}
