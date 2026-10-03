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
  /* IMPLEMENTATION-HANDOFF [WP-BE-010]
   * Defect BE-010; COV-BE-010 summary, assets/list/detail, pegs, federation.
   * These five methods unconditionally fail even though the separate /node
   * route already has an elements-node-source. Its success cannot complete
   * the five different observatory consumers. Source reproducer confirms it.
   * 1. Reuse elements-node-source and the existing liquid/elements-parser
   *    evidence plus an operated registry mirror. Pin Elements/Liquid rules,
   *    registry provenance and both Bitcoin/Elements network identities
   *    against R-BE-LIQUID; Liquid's chain identity is not Bitcoin mainnet.
   * 2. Define durable checkpointed projections for peg-ins/outs and federation
   *    epochs using actual scripts, amounts, confirmations and dynafed data.
   *    Keep opaque commitments opaque; never invent blinded asset amounts or
   *    identity labels that chain/registry evidence cannot establish.
   * 3. Implement bounded injected reads, exact atomic string values, asset-ID
   *    validation and pagination. Join peg evidence only at compatible owned
   *    Bitcoin and Elements checkpoints; record reorg/restart invalidation.
   * 4. Wire liquid-observatory types/routes and frontend summary, assets, pegs
   *    and federation. Preserve confidential-proof/unblinding tools and /node;
   *    one operational node panel is not full observatory acceptance.
   * 5. Test all five journeys on Liquid testnet or justified Elements regtest:
   *    actual issuance/peg observations, unknown asset, registry outage,
   *    invalid commitment, epoch changes, chain mismatch, restart and reorg.
   * Acceptance: all offered observations trace to real evidence with precise
   * amounts/status; no default constants or false empty collections.
   * Rollback: apply WP-BE-002 migration safeguards, retain raw peg/epoch data
   * and restore matched schema/adapters at the last verified checkpoint.
   * Preparation only; these functions and their error behavior are unchanged.
   */
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
