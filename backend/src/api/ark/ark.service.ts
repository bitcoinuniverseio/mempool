import { throwFirstPartyDataUnavailable } from '../_shared/first-party-data';
import { ArkBatch, ArkOperator, ArkVirtualTx, ArkVtxo } from './ark.types';

export class ArkService {
  /** @asyncSafe */
  public async $getOperators(): Promise<ArkOperator[]> {
    throwFirstPartyDataUnavailable('ark');
  }

  /** @asyncSafe */
  public async $getBatches(): Promise<ArkBatch[]> {
    throwFirstPartyDataUnavailable('ark');
  }

  /** @asyncSafe */
  public async $getBatch(batchId: string): Promise<ArkBatch | null> {
    void batchId;
    throwFirstPartyDataUnavailable('ark');
  }

  /** @asyncSafe */
  public async $getVtxo(vtxoId: string): Promise<ArkVtxo | null> {
    void vtxoId;
    throwFirstPartyDataUnavailable('ark');
  }

  /** @asyncSafe */
  public async $getVirtualTxs(): Promise<ArkVirtualTx[]> {
    throwFirstPartyDataUnavailable('ark');
  }

  /** @asyncSafe */
  public async $verifyProof(
    vtxoId: string,
    proofPath: string[]
  ): Promise<{ valid: boolean; root: string }> {
    void vtxoId;
    void proofPath;
    throwFirstPartyDataUnavailable('ark');
  }
}

export const arkService = new ArkService();
