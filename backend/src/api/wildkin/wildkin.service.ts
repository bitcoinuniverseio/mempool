import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  WildkinBraidCeremony,
  WildkinCreature,
  WildkinStatusSummary,
} from './wildkin.types';

export class WildkinService {
  /** @asyncSafe */
  public async $getStatus(): Promise<WildkinStatusSummary> {
    throwFirstPartyDataUnavailable('wildkin');
  }

  /** @asyncSafe */
  public async $getCreatures(): Promise<WildkinCreature[]> {
    throwFirstPartyDataUnavailable('wildkin');
  }

  /** @asyncSafe */
  public async $getCreature(id: string): Promise<WildkinCreature | null> {
    void id;
    throwFirstPartyDataUnavailable('wildkin');
  }

  /** @asyncSafe */
  public async $getBraids(): Promise<WildkinBraidCeremony[]> {
    throwFirstPartyDataUnavailable('wildkin');
  }
}

export const wildkinService = new WildkinService();
