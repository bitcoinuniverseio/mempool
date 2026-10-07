import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { IEsploraApi } from './esplora-api.interface';
import { UtxoReconstructionView } from './utxo-reconstruction.types';

/** Confirmed progress and the final mempool closure are separate, explicit observations. */
export interface UtxoReconstructionV3View {
  schema: 'universe-address-utxo-reconstruction-v3';
  sessionId: string;
  cursor: number;
  address: string;
  network: string;
  status: UtxoReconstructionView['status'];
  reason?: string;
  confirmedAnchor: AddressSourceCheckpoint & { sourceId: string; scriptPubKey: string; chainStats: IEsploraApi.ChainStats };
  /** Original confirmed anchor remains immutable; this separately records the latest verified shared tip. */
  latestObservedTip: AddressSourceCheckpoint;
  /** Closed live confirmed head; it never replaces the original prefix anchor. */
  confirmedTailAnchor: { checkpoint: AddressSourceCheckpoint; chainStats: IEsploraApi.ChainStats } | null;
  mempoolAnchor: { identity: string; observedAt: string; checkpoint: AddressSourceCheckpoint; addressMempoolStats: IEsploraApi.ChainStats } | null;
  observedAt: string;
  expiresAt: string;
  progress: {
    phase: 'confirmed' | 'reconcile-confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete';
    pageLimit: 100;
    mempoolEpoch: number;
    confirmedEpoch: number;
    confirmedTransactionsProcessed: number;
    confirmedTransactionsExpected: number;
    confirmedTailTransactionsProcessed: number;
    confirmedTailTransactionsExpected: number | null;
    mempoolTransactionsProcessed: number;
    mempoolTransactionsExpected: number | null;
    candidateOutputs: number;
    verifiedOutputs: number;
    retainedBytes: number;
  };
  result?: UtxoReconstructionView['result'];
}
