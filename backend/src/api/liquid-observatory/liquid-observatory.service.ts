import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
} from './liquid-observatory.types';

export class LiquidObservatoryService {
  /** @asyncSafe */
  public async $getSummary(): Promise<LiquidObservatorySummary> {
    throwFirstPartyDataUnavailable('liquid-observatory');
  }

  /** @asyncSafe */
  public async $getAssets(): Promise<LiquidAssetRecord[]> {
    throwFirstPartyDataUnavailable('liquid-observatory');
  }

  /** @asyncSafe */
  public async $getAsset(assetId: string): Promise<LiquidAssetRecord | null> {
    void assetId;
    throwFirstPartyDataUnavailable('liquid-observatory');
  }

  /** @asyncSafe */
  public async $getPegs(): Promise<LiquidPegRecord[]> {
    throwFirstPartyDataUnavailable('liquid-observatory');
  }

  /** @asyncSafe */
  public async $getFederation(): Promise<LiquidFederationEpoch> {
    throwFirstPartyDataUnavailable('liquid-observatory');
  }
}

export const liquidObservatoryService = new LiquidObservatoryService();
