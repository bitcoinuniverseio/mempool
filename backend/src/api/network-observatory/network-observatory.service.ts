import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  BlockTemplateComparison,
  ObserverNode,
  PropagationObservation,
} from './network-observatory.types';

export class NetworkObservatoryService {
  /** @asyncSafe */
  public async $getNodes(): Promise<ObserverNode[]> {
    throwFirstPartyDataUnavailable('network-observatory');
  }

  /** @asyncSafe */
  public async $getPropagation(txid?: string): Promise<PropagationObservation> {
    void txid;
    throwFirstPartyDataUnavailable('network-observatory');
  }

  /** @asyncSafe */
  public async $getTemplates(): Promise<BlockTemplateComparison> {
    throwFirstPartyDataUnavailable('network-observatory');
  }
}

export const networkObservatoryService = new NetworkObservatoryService();
