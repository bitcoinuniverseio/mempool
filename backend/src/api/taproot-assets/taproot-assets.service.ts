import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  Bolt12Offer,
  LightningRfqQuote,
  TaprootAssetGroup,
  TaprootAssetItem,
} from './taproot-assets.types';

export class TaprootAssetsService {
  /** @asyncSafe */
  public async $getAssets(): Promise<TaprootAssetItem[]> {
    throwFirstPartyDataUnavailable('taproot-assets');
  }

  /** @asyncSafe */
  public async $getAsset(assetId: string): Promise<TaprootAssetItem | null> {
    void assetId;
    throwFirstPartyDataUnavailable('taproot-assets');
  }

  /** @asyncSafe */
  public async $getGroups(): Promise<TaprootAssetGroup[]> {
    throwFirstPartyDataUnavailable('taproot-assets');
  }

  /** @asyncSafe */
  public async $getOffers(): Promise<Bolt12Offer[]> {
    throwFirstPartyDataUnavailable('taproot-assets');
  }

  /** @asyncSafe */
  public async $getRfqQuotes(): Promise<LightningRfqQuote[]> {
    throwFirstPartyDataUnavailable('taproot-assets');
  }

  /** @asyncSafe */
  public async $verifyProof(
    assetId: string,
    proofData: string
  ): Promise<{
    valid: boolean;
    rootHash: string;
    anchorBlockHeight: number;
  }> {
    void assetId;
    void proofData;
    throwFirstPartyDataUnavailable('taproot-assets');
  }
}

export const taprootAssetsService = new TaprootAssetsService();
