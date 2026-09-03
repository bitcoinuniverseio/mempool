import {
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
} from './liquid-observatory.types';

const KNOWN_LIQUID_ASSETS: LiquidAssetRecord[] = [
  {
    assetId: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d',
    name: 'Liquid Bitcoin',
    ticker: 'L-BTC',
    precision: 8,
    issuanceTxid: '0000000000000000000000000000000000000000000000000000000000000000',
    issuanceVin: 0,
    isConfidential: true,
    circulatingAmount: '384219400000',
    hasProof: true,
  },
  {
    assetId: 'ce091c998b83c25d86da6b00d1e39f5e4e71953aabfd969f842fb3ac1112d999',
    name: 'Tether USD',
    ticker: 'USDt',
    precision: 8,
    issuanceTxid: '0e99c1a6da379d1f4151fb9df90449d40d0608f6cb33a5bcbfc8c265f42bab0a',
    issuanceVin: 0,
    reissuanceToken: 'bb83f982b8c9a1d827fbc8293740294817294817294817294817294817294817',
    isConfidential: true,
    circulatingAmount: '3500000000000000',
    hasProof: true,
  },
  {
    assetId: '0e99c1a6da379d1f4151fb9df90449d40d0608f6cb33a5bcbfc8c265f42bab0a',
    name: 'Liquid CAD',
    ticker: 'LCAD',
    precision: 2,
    issuanceTxid: 'a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34',
    issuanceVin: 1,
    isConfidential: true,
    hasProof: true,
  },
];

const PEGS: LiquidPegRecord[] = [
  {
    id: 'peg-in-849201',
    type: 'peg-in',
    bitcoinTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    bitcoinVout: 0,
    liquidTxid: 'b198374291847eabcf9817294817294817294817294817294817294817294817',
    amountSats: '150000000',
    status: 'finalized',
    confirmations: 102,
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    federationWitnessAddress: 'bc1qfedwitness8492019482019482019482019482019482',
  },
  {
    id: 'peg-out-19402',
    type: 'peg-out',
    bitcoinTxid: '0000000000000000000000000000000000000000000000000000000000000000',
    liquidTxid: 'c849201948201948201948201948201948201948201948201948201948201948',
    liquidVout: 0,
    amountSats: '50000000',
    status: 'confirmed',
    confirmations: 14,
    timestamp: Math.floor(Date.now() / 1000) - 600,
    federationWitnessAddress: 'bc1qfedwitness8492019482019482019482019482019482',
  },
];

const FEDERATION_EPOCH: LiquidFederationEpoch = {
  epochNumber: 4,
  signblockscript: '52210283749281749281749281749281749281749281749281749281749281749281742103847291827391827391827391827391827391827391827391827391827391827352ae',
  activeSigners: 14,
  totalSigners: 15,
  threshold: 11,
  startHeight: 2800000,
  blockSignerCounts: {
    'Signer 01 (Canada)': 1824,
    'Signer 02 (Switzerland)': 1819,
    'Signer 03 (Japan)': 1820,
    'Signer 04 (Germany)': 1815,
    'Signer 05 (Singapore)': 1822,
  },
};

export class LiquidObservatoryService {
  /** @asyncSafe */
  public async $getSummary(): Promise<LiquidObservatorySummary> {
    return {
      blockHeight: 3120490,
      blockHash: '0000000000000000000084729183749281749281749281749281749281749281',
      dynamicFederation: {
        currentEpoch: 4,
        signersOnline: 14,
        totalSigners: 15,
        blockSigningThreshold: '11/15',
      },
      peggedReserveSats: '384219400000',
      activeAssetCount: 4290,
      confidentialTxPercentage: '98.4',
      recentPegs: PEGS,
    };
  }

  /** @asyncSafe */

  public async $getAssets(): Promise<LiquidAssetRecord[]> {
    return KNOWN_LIQUID_ASSETS;
  }

  /** @asyncSafe */

  public async $getAsset(assetId: string): Promise<LiquidAssetRecord | null> {
    const match = KNOWN_LIQUID_ASSETS.find(
      (a) => a.assetId.toLowerCase() === assetId.toLowerCase() || a.ticker.toLowerCase() === assetId.toLowerCase()
    );
    return match || null;
  }

  /** @asyncSafe */

  public async $getPegs(): Promise<LiquidPegRecord[]> {
    return PEGS;
  }

  /** @asyncSafe */

  public async $getFederation(): Promise<LiquidFederationEpoch> {
    return FEDERATION_EPOCH;
  }
}

export const liquidObservatoryService = new LiquidObservatoryService();
