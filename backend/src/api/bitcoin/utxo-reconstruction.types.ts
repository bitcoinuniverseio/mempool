import { AddressSourceCheckpoint } from './address-source-checkpoint';

/** Explicit reconstruction evidence; it never replaces the native bare-array API. */
export interface UtxoReconstructionView {
  schema: 'universe-address-utxo-reconstruction-v1';
  sessionId: string;
  cursor: number;
  address: string;
  network: string;
  status: 'PARTIAL' | 'COMPLETE_AT_OBSERVED_TIP' | 'INVALIDATED' | 'CANCELLED' | 'BLOCKED';
  reason?: string;
  source: AddressSourceCheckpoint & { sourceId: string; mempoolIdentity: string; scriptPubKey: string };
  observedAt: string;
  expiresAt: string;
  progress: {
    phase: 'confirmed' | 'mempool' | 'outspends' | 'complete';
    confirmedTransactionsProcessed: number;
    confirmedTransactionsExpected: number;
    mempoolTransactionsProcessed: number;
    mempoolTransactionsExpected: number;
    candidateOutputs: number;
    verifiedOutputs: number;
    retainedBytes: number;
  };
  /** Published only after every page and independent closure check succeeds. */
  result?: {
    outputCount: number;
    balanceAtomic: string;
    items: {
      txid: string;
      vout: number;
      valueAtomic: string;
      status: { confirmed: boolean; block_height?: number; block_hash?: string; block_time?: number };
    }[];
  };
}
