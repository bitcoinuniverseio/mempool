import { AddressSourceCheckpoint } from './address-source-checkpoint';
import { IEsploraApi } from './esplora-api.interface';
import { UtxoReconstructionView } from './utxo-reconstruction.types';

/** Confirmed progress and the final mempool closure are separate, explicit observations. */
export interface UtxoReconstructionV2View {
  schema: 'universe-address-utxo-reconstruction-v2';
  sessionId: string;
  cursor: number;
  address: string;
  network: string;
  status: UtxoReconstructionView['status'];
  reason?: string;
  confirmedAnchor: AddressSourceCheckpoint & { sourceId: string; scriptPubKey: string; chainStats: IEsploraApi.ChainStats };
  mempoolAnchor: { identity: string; observedAt: string; addressMempoolStats: IEsploraApi.ChainStats } | null;
  observedAt: string;
  expiresAt: string;
  progress: {
    phase: 'confirmed' | 'acquire-mempool' | 'mempool' | 'outspends' | 'complete';
    pageLimit: 100;
    mempoolEpoch: number;
    confirmedTransactionsProcessed: number;
    confirmedTransactionsExpected: number;
    mempoolTransactionsProcessed: number;
    mempoolTransactionsExpected: number | null;
    candidateOutputs: number;
    verifiedOutputs: number;
    retainedBytes: number;
  };
  result?: UtxoReconstructionView['result'];
}
