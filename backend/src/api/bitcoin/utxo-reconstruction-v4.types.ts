import { UtxoReconstructionV3View } from './utxo-reconstruction-v3.types';
import { AddressSourceCheckpoint } from './address-source-checkpoint';

export interface IrrelevantGlobalTransition {
  transition: number; fromIdentity: string; toIdentity: string; addedTxids: string[]; removedTxids: string[];
  proofSha256: string; observedAt: string; verifiedOutputsRetained: number;
}
export interface UtxoReconstructionV4View extends Omit<UtxoReconstructionV3View, 'schema'> {
  schema: 'universe-address-utxo-reconstruction-v4';
  globalMempoolProof: {
    mode: 'uninitialized' | 'strict-global-fallback' | 'irrelevant-delta-proof';
    fallbackReason: string | null; maximumTransactions: 100; maximumRetainedBytes: 524288;
    retainedBytes: number; transactionCount: number | null; sequenceAtomic: string | null; initialIdentity: string | null;
    transitionCount: number; maximumTransitions: 128; maximumRetainedTransitions: 8; transitions: IrrelevantGlobalTransition[];
    verifiedOutputContext: null | { identity: string; checkpoint: AddressSourceCheckpoint; outpointsSha256: string; outputCount: number };
  };
}

export interface ReconstructionV4Binding {
  network: string;
  releaseSha: string;
  configurationSha256: string;
}
/** State inspection is a historical progress receipt, never current-chain/output proof. */
export interface UtxoReconstructionV4Inspection {
  schema: 'universe-address-utxo-reconstruction-inspection-v1';
  sessionId: string;
  address: string;
  network: string;
  status: UtxoReconstructionV4View['status'];
  busy: boolean;
  cursor: number;
  replayCursor: number | null;
  expiresAt: string;
  binding: ReconstructionV4Binding & {
    sourceId: string;
    confirmedAnchorSha256: string;
  };
  retainedBytes: number;
  resultAvailable: boolean;
  lastSuccessfulObservation: {
    cursor: number;
    observedAt: string;
    checkpoint: AddressSourceCheckpoint;
    progress: UtxoReconstructionV4View['progress'];
  };
  lastOperationError: null | {
    cursor: number;
    status: number;
    code: string;
    phase?: string;
    failedAt: string;
  };
}
