import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  L2BridgeSystem,
  L2Challenge,
  L2ReserveAudit,
} from './l2-observatory.types';

export class L2ObservatoryService {
  /** @asyncSafe */
  public async $getSystems(): Promise<L2BridgeSystem[]> {
    throwFirstPartyDataUnavailable('l2-observatory');
  }

  /** @asyncSafe */
  public async $getSystem(id: string): Promise<L2BridgeSystem | null> {
    void id;
    throwFirstPartyDataUnavailable('l2-observatory');
  }

  /** @asyncSafe */
  public async $getChallenges(systemId?: string): Promise<L2Challenge[]> {
    void systemId;
    throwFirstPartyDataUnavailable('l2-observatory');
  }

  /** @asyncSafe */
  public async $getReserveAudit(
    systemId: string
  ): Promise<L2ReserveAudit | null> {
    void systemId;
    throwFirstPartyDataUnavailable('l2-observatory');
  }
}

export const l2ObservatoryService = new L2ObservatoryService();
