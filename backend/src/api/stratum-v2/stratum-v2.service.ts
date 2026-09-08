import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
} from './stratum-v2.types';

export class StratumV2Service {
  /** @asyncSafe */
  public async $getRoles(): Promise<StratumV2RoleStatus[]> {
    throwFirstPartyDataUnavailable('stratum-v2');
  }

  /** @asyncSafe */
  public async $getTemplates(): Promise<StratumV2Template[]> {
    throwFirstPartyDataUnavailable('stratum-v2');
  }

  /** @asyncSafe */
  public async $getDeclarations(): Promise<StratumV2JobDeclaration[]> {
    throwFirstPartyDataUnavailable('stratum-v2');
  }
}

export const stratumV2Service = new StratumV2Service();
