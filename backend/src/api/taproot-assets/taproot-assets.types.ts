/**
 * Types for Taproot Assets and Lightning Standards Intelligence.
 */

export interface TaprootAssetItem {
  readonly assetId: string;
  readonly assetType: 'normal' | 'collectible';
  readonly name: string;
  readonly groupKey?: string;
  readonly genesisPoint: string;
  /** The genesis block height when this proof is the genesis output, null when the anchor is a later transfer. */
  readonly genesisHeight: number | null;
  readonly totalAmountAtomic: string;
  readonly anchorTxid: string;
  readonly anchorOutpoint: string;
  readonly scriptKey: string;
  /** Null until proof-file availability has actually been read; listing alone is insufficient. */
  readonly hasProofFile: boolean | null;
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
  /** LDK's merkle-derived identifier differs from Core Lightning's TLV SHA256 catalog key. */
  readonly decoderOfferId: string;
  readonly offerString: string;
  readonly description: string;
  readonly issuer?: string;
  readonly amountMsat?: string;
  readonly currency?: string;
  readonly blindRoutesCount: number;
  valid: boolean;
  readonly expiry?: number;
  readonly currencyAmountAtomic?: string;
  readonly expiryAtomic: string | null;
  readonly syntaxValid: true;
  readonly sourceActive: boolean;
  readonly sourceUsed: boolean;
  readonly singleUse: boolean;
  readonly networkCompatible: boolean;
  readonly unknownRequiredFeatures: boolean;
  validity: 'usable-unverified' | 'source-disabled' | 'already-used' | 'expired' | 'wrong-chain' | 'unsupported-required-features';
  readonly invoiceAvailability: 'unverified';
  readonly paymentVerified: false;
}

export interface Bolt12OfferPage {
  offers: Bolt12Offer[]; total: number; nextCursor: string | null;
  source: { implementation: 'CoreLightning'; version: string; nodeId: string; network: string; genesisHash: string;
    signetChallenge?: string; publicationSha256: string; observedAt: string;
    checkpoint: { height: number; hash: string }; catalogAnchor: { height: number; hash: string }; scope: string; };
}

export interface LightningRfqQuote {
  readonly quoteId: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  /** A quote is one-sided: a buy quote carries an ask rate, a sell quote a bid rate. */
  readonly askRate: string | null;
  readonly bidRate: string | null;
  readonly spreadBps: number | null;
  readonly validUntil: number;
}
