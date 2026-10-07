/**
 * Types for Arkade / Ark VTXO, Batch, Virtual-Mempool, and Exit Explorer.
 */

export interface ArkOperator {
  readonly id: string;
  readonly name: string;
  readonly aspPubkey: string;
  readonly roundIntervalSec: number | null;
  readonly currentBatchHeight: number | null;
  readonly activeVtxoCount: number | null;
  readonly totalVolumeSats: string | null;
  readonly status: 'online' | 'degraded' | 'observed';
  readonly providerVersion?: string;
  readonly sessionDurationSeconds?: string;
  readonly source?: import('./ark-native-source').ArkNativeObservation;
}

export interface ArkBatch {
  readonly batchId: string;
  readonly operatorId: string;
  readonly anchorTxid: string;
  readonly rootHash: string | null;
  readonly vtxoCount: number | null;
  readonly totalAmountSats: string | null;
  readonly roundTimestamp: number;
  readonly expirationTimestamp: number | null;
  readonly status: 'settled' | 'provisional' | 'swept' | 'observed-completed';
  readonly endedAt?: number;
  readonly source?: import('./ark-native-source').ArkNativeObservation;
  readonly nativeStage?: 'FINALIZATION_STAGE';
  readonly confirmation?: null;
}

export interface ArkVtxo {
  readonly vtxoId: string;
  readonly batchId: string;
  readonly amountSats: string;
  readonly userPubkey: string;
  readonly aspPubkey: string;
  readonly timelockExpiryBlocks: number;
  readonly treeDepth: number;
  readonly treeIndex: number;
  readonly status: 'spendable' | 'settled' | 'exiting' | 'expired';
  readonly exitTxid?: string;
}

export interface ArkVirtualTx {
  readonly virtualTxId: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly { readonly userPubkey: string; readonly amountSats: string }[];
  readonly feeSats: string;
  readonly roundSequence: number;
  readonly submittedAt: number;
}
