import {
  Bolt12Offer,
  LightningRfqQuote,
  TaprootAssetGroup,
  TaprootAssetItem,
} from './taproot-assets.types';

const ASSETS: TaprootAssetItem[] = [
  {
    assetId: '4a19b872019842fbc9e19842a98712344a19b872019842fbc9e19842a9871234',
    assetType: 'normal',
    name: 'Tether USD (Taproot)',
    groupKey: '028471928374918273918273918273918273918273918273918273918273918273',
    genesisPoint: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f:0',
    genesisHeight: 840000,
    totalAmountAtomic: '500000000000',
    anchorTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    anchorOutpoint: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f:0',
    scriptKey: '023847192837491827391827391827391827391827391827391827391827391827',
    hasProofFile: true,
    mintTime: 1713571200,
  },
  {
    assetId: '7f91827391827391827391827391827391827391827391827391827391827391',
    assetType: 'collectible',
    name: 'Taproot Glyph #001',
    groupKey: '039182739182739182739182739182739182739182739182739182739182739182',
    genesisPoint: 'b198374291847eabcf9817294817294817294817294817294817294817294817:1',
    genesisHeight: 845200,
    totalAmountAtomic: '1',
    anchorTxid: 'b198374291847eabcf9817294817294817294817294817294817294817294817',
    anchorOutpoint: 'b198374291847eabcf9817294817294817294817294817294817294817294817:1',
    scriptKey: '038472918273918273918273918273918273918273918273918273918273918273',
    hasProofFile: true,
    mintTime: 1714200000,
  },
];

const GROUPS: TaprootAssetGroup[] = [
  {
    groupKey: '028471928374918273918273918273918273918273918273918273918273918273',
    name: 'Tether Issuance Tranche A',
    totalAssetsCount: 1,
    totalCirculatingSupplyAtomic: '500000000000',
  },
  {
    groupKey: '039182739182739182739182739182739182739182739182739182739182739182',
    name: 'Taproot Glyphs Collection',
    totalAssetsCount: 100,
    totalCirculatingSupplyAtomic: '100',
  },
];

const OFFERS: Bolt12Offer[] = [
  {
    offerId: 'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283q890cdse444n894v69n0q2sxve80q',
    offerString: 'lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283q890cdse444n894v69n0q2sxve80q',
    description: 'Universe Explorer Premium Feed Subscription (30 Days)',
    issuer: 'Universe Foundation',
    amountMsat: '25000000',
    currency: 'msat',
    blindRoutesCount: 3,
    valid: true,
  },
];

const RFQ_QUOTES: LightningRfqQuote[] = [
  {
    quoteId: 'rfq-quote-849102',
    baseAsset: 'BTC',
    quoteAsset: 'USDt',
    askRate: '64520.50',
    bidRate: '64490.20',
    spreadBps: 4.7,
    validUntil: Math.floor(Date.now() / 1000) + 60,
  },
];

export class TaprootAssetsService {
  /** @asyncSafe */
  public async $getAssets(): Promise<TaprootAssetItem[]> {
    return ASSETS;
  }

  /** @asyncSafe */

  public async $getAsset(assetId: string): Promise<TaprootAssetItem | null> {
    const match = ASSETS.find(
      (a) => a.assetId.toLowerCase() === assetId.toLowerCase() || a.name.toLowerCase() === assetId.toLowerCase()
    );
    return match || null;
  }

  /** @asyncSafe */

  public async $getGroups(): Promise<TaprootAssetGroup[]> {
    return GROUPS;
  }

  /** @asyncSafe */

  public async $getOffers(): Promise<Bolt12Offer[]> {
    return OFFERS;
  }

  /** @asyncSafe */

  public async $getRfqQuotes(): Promise<LightningRfqQuote[]> {
    return RFQ_QUOTES;
  }

  /** @asyncSafe */

  public async $verifyProof(assetId: string, proofData: string): Promise<{ valid: boolean; rootHash: string; anchorBlockHeight: number }> {
    return {
      valid: proofData.length > 20,
      rootHash: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
      anchorBlockHeight: 840000,
    };
  }
}

export const taprootAssetsService = new TaprootAssetsService();
