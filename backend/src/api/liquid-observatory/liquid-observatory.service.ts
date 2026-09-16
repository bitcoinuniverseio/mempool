import {
  LiquidAssetRecord,
  LiquidFederationEpoch,
  LiquidObservatorySummary,
  LiquidPegRecord,
} from './liquid-observatory.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class LiquidObservatoryEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const elementsUnavailable =
  'Liquid observations are unavailable. Summary, peg and federation reads require the owned Liquid node (elementsd RPC with its Bitcoin peg reader), which is not connected on this deployment.';

const registryUnavailable =
  'Liquid asset observations are unavailable. Asset reads require the owned Liquid asset registry mirror over the owned Liquid node, which is not connected on this deployment.';

/**
 * Liquid federation, peg and confidential-asset evidence.
 *
 * Every read here needs an owned Elements node, and the asset directory needs
 * an owned registry mirror on top of it. Neither is connected, so each read
 * reports the absent source. The revision this replaces answered from
 * constants: a fixed block height and reserve, two pegs whose timestamps were
 * computed at request time, a federation epoch with invented signer names,
 * and a three-asset registry.
 */
export class LiquidObservatoryService {
  /** @asyncSafe */
  public async $getSummary(): Promise<LiquidObservatorySummary> {
    throw new LiquidObservatoryEvidenceError('unavailable-elements-node', elementsUnavailable);
  }

  /** @asyncSafe */
  public async $getAssets(): Promise<LiquidAssetRecord[]> {
    throw new LiquidObservatoryEvidenceError('unavailable-asset-registry', registryUnavailable);
  }

  /** @asyncSafe */
  public async $getAsset(_assetId: string): Promise<LiquidAssetRecord | null> {
    throw new LiquidObservatoryEvidenceError('unavailable-asset-registry', registryUnavailable);
  }

  /** @asyncSafe */
  public async $getPegs(): Promise<LiquidPegRecord[]> {
    throw new LiquidObservatoryEvidenceError('unavailable-elements-node', elementsUnavailable);
  }

  /** @asyncSafe */
  public async $getFederation(): Promise<LiquidFederationEpoch> {
    throw new LiquidObservatoryEvidenceError('unavailable-elements-node', elementsUnavailable);
  }
}

export const liquidObservatoryService = new LiquidObservatoryService();
