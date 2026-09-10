import {
  BlockTemplateComparison,
  ObserverNode,
  PropagationObservation,
} from './network-observatory.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class NetworkObservatoryEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const fleetUnavailable =
  'Cross-node observations are unavailable. Node, propagation and template reads require the owned observer fleet (the Universe Bitcoin nodes with their first-seen and getblocktemplate telemetry export), which is not connected on this deployment.';

/**
 * Observer fleet, propagation and block-template evidence.
 *
 * Every read here needs the owned observer fleet reporting first-seen times
 * and candidate templates. None is connected, so each read reports the
 * absent source. The revision this replaces answered from constants: four
 * nodes marked online in four regions, a propagation timeline computed from
 * the request clock for any txid (and a fixed txid when none was given), and
 * three candidate templates with pool names nobody had polled.
 */
export class NetworkObservatoryService {
  /** @asyncSafe */
  public async $getNodes(): Promise<ObserverNode[]> {
    throw new NetworkObservatoryEvidenceError('unavailable-observer-fleet', fleetUnavailable);
  }

  /** @asyncSafe */
  public async $getPropagation(_txid?: string): Promise<PropagationObservation> {
    throw new NetworkObservatoryEvidenceError('unavailable-observer-fleet', fleetUnavailable);
  }

  /** @asyncSafe */
  public async $getTemplates(): Promise<BlockTemplateComparison> {
    throw new NetworkObservatoryEvidenceError('unavailable-observer-fleet', fleetUnavailable);
  }
}

export const networkObservatoryService = new NetworkObservatoryService();
