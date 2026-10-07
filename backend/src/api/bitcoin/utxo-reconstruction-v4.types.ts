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
