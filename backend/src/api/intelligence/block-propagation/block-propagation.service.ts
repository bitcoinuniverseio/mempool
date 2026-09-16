import {
  BlockPropagationOverview,
  BlockPropagationObservation,
  CompactBlockDetail,
  ForkRaceRecord,
  PropagationSensor,
  FibreObservation,
} from './block-propagation.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class BlockPropagationEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const sensorFleetUnavailable =
  'Block propagation observations are unavailable. Sensor health, per-block relay stage timings, compact block reconstruction, fork races and stale tips require the owned propagation sensor fleet (clock-disciplined Bitcoin Core sensors reporting BIP152 stage timestamps to this backend), which is not connected on this deployment.';

const fibreUnavailable =
  'FIBRE observations are unavailable. Delivery timing comparisons require the owned FIBRE relay endpoint and the owned propagation sensor fleet, which are not connected on this deployment.';

/**
 * Block propagation evidence.
 *
 * Every read here is an observation from the owned sensor fleet; a deployment
 * without one gets a 503 that names it. Nothing is answered from a constant.
 */
export class BlockPropagationService {
  public getOverview(): BlockPropagationOverview {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public getLive(): never {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public getBlock(_blockHash: string): BlockPropagationObservation | undefined {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public listCompactBlocks(): { compact_blocks: CompactBlockDetail[] } {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public listForkRaces(): { fork_races: ForkRaceRecord[] } {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public getForkRace(_raceId: string): ForkRaceRecord | undefined {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public listStaleTips(): never {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public listSensors(): { sensors: PropagationSensor[] } {
    throw new BlockPropagationEvidenceError('unavailable-sensor-fleet', sensorFleetUnavailable);
  }

  public listFibre(): { fibre_observations: FibreObservation[] } {
    throw new BlockPropagationEvidenceError('unavailable-fibre-relay', fibreUnavailable);
  }
}

export default new BlockPropagationService();
