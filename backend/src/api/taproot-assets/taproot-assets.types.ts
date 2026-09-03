/**
 * Types for Taproot Assets and Lightning Standards Intelligence.
 */

export interface TaprootAssetItem {
  readonly assetId: string;
  readonly assetType: 'normal' | 'collectible';
  readonly name: string;
  readonly groupKey?: string;
  readonly genesisPoint: string;
  readonly genesisHeight: number;
  readonly totalAmountAtomic: string;
  readonly anchorTxid: string;
  readonly anchorOutpoint: string;
  readonly scriptKey: string;
  readonly hasProofFile: boolean;
  readonly mintTime: number;
}

export interface TaprootAssetGroup {
  readonly groupKey: string;
  readonly name: string;
  readonly totalAssetsCount: number;
  readonly totalCirculatingSupplyAtomic: string;
}

export interface Bolt12Offer {
  readonly offerId: string;
  readonly offerString: string;
  readonly description: string;
  readonly issuer?: string;
  readonly amountMsat?: string;
  readonly currency?: string;
  readonly blindRoutesCount: number;
  readonly valid: boolean;
  readonly expiry?: number;
}

export interface LightningRfqQuote {
  readonly quoteId: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly askRate: string;
  readonly bidRate: string;
  readonly spreadBps: number;
  readonly validUntil: number;
}
