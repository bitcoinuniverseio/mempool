import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import {
  ProtocolBearingUtxos,
  ScriptTypeDistribution,
  SupplyCohort,
  UtreexoRootsView,
  UtxoCheckpoint,
} from './utxo-set.types';

export class UtxoSetService {
  /** @asyncSafe */
  public async $getCheckpoints(): Promise<UtxoCheckpoint[]> {
    throwFirstPartyDataUnavailable('utxo-set');
  }

  /** @asyncSafe */
  public async $getDistribution(): Promise<{
    valueCohorts: SupplyCohort[];
    scriptTypes: ScriptTypeDistribution[];
  }> {
    throwFirstPartyDataUnavailable('utxo-set');
  }

  /** @asyncSafe */
  public async $getProtocolUtxos(): Promise<ProtocolBearingUtxos> {
    throwFirstPartyDataUnavailable('utxo-set');
  }

  /** @asyncSafe */
  public async $getUtreexoRoots(): Promise<UtreexoRootsView> {
    throwFirstPartyDataUnavailable('utxo-set');
  }

  /** @asyncSafe */
  public async $verifyUtreexoProof(
    proof: string[]
  ): Promise<{ valid: boolean; leafCount: number }> {
    void proof;
    throwFirstPartyDataUnavailable('utxo-set');
  }
}

export const utxoSetService = new UtxoSetService();
