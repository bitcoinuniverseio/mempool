/**
 * Types for the Liquid Confidential-Asset, Peg, and Federation Observatory.
 */

export interface LiquidAssetRecord {
  readonly assetId: string;
  readonly name: string;
  readonly ticker: string;
  readonly precision: number;
  readonly issuanceTxid: string;
  readonly issuanceVin: number;
  readonly reissuanceToken?: string;
  readonly isConfidential: boolean;
  readonly circulatingAmount?: string;
  readonly issuerPubkey?: string;
  readonly hasProof: boolean;
}

export interface LiquidPegRecord {
  readonly id: string;
  readonly type: 'peg-in' | 'peg-out';
  readonly bitcoinTxid: string;
  readonly bitcoinVout?: number;
  readonly liquidTxid: string;
  readonly liquidVout?: number;
  readonly amountSats: string;
  readonly status: 'initiated' | 'confirmed' | 'finalized' | 'reorged';
  readonly confirmations: number;
  readonly timestamp: number;
  readonly federationWitnessAddress: string;
}

export interface LiquidFederationEpoch {
  readonly epochNumber: number;
  readonly signblockscript: string;
  readonly activeSigners: number;
  readonly totalSigners: number;
  readonly threshold: number;
  readonly startHeight: number;
  readonly endHeight?: number;
  readonly blockSignerCounts: Record<string, number>;
}

export interface LiquidObservatorySummary {
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly dynamicFederation: {
    readonly currentEpoch: number;
    readonly signersOnline: number;
    readonly totalSigners: number;
    readonly blockSigningThreshold: string;
  };
  readonly peggedReserveSats: string;
  readonly activeAssetCount: number;
  readonly confidentialTxPercentage: string;
  readonly recentPegs: readonly LiquidPegRecord[];
}
