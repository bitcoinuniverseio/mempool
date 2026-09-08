import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  ZcashNetworkUpgrade,
  ZcashPrivacySummary,
  ZcashValuePool,
} from './zcash-privacy.types';

export class ZcashPrivacyService {
  /** @asyncSafe */
  public async $getSummary(): Promise<ZcashPrivacySummary> {
    throwFirstPartyDataUnavailable('zcash-privacy');
  }

  /** @asyncSafe */
  public async $getPools(): Promise<ZcashValuePool[]> {
    throwFirstPartyDataUnavailable('zcash-privacy');
  }

  /** @asyncSafe */
  public async $getUpgrades(): Promise<ZcashNetworkUpgrade[]> {
    throwFirstPartyDataUnavailable('zcash-privacy');
  }
}

export const zcashPrivacyService = new ZcashPrivacyService();
