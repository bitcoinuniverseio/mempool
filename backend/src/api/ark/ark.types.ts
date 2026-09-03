/**
 * Types for Arkade / Ark VTXO, Batch, Virtual-Mempool, and Exit Explorer.
 */

export interface ArkOperator {
  readonly id: string;
  readonly name: string;
  readonly aspPubkey: string;
  readonly roundIntervalSec: number;
  readonly currentBatchHeight: number;
  readonly activeVtxoCount: number;
  readonly totalVolumeSats: string;
  readonly status: 'online' | 'degraded';
}

export interface ArkBatch {
  readonly batchId: string;
  readonly operatorId: string;
  readonly anchorTxid: string;
  readonly rootHash: string;
  readonly vtxoCount: number;
  readonly totalAmountSats: string;
  readonly roundTimestamp: number;
  readonly expirationTimestamp: number;
  readonly status: 'settled' | 'provisional' | 'swept';
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
