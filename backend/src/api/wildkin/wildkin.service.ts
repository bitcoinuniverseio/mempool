import {
  WildkinBraidCeremony,
  WildkinCreature,
  WildkinStatusSummary,
} from './wildkin.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class WildkinEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const indexerUnavailable =
  'Wildkin observations are unavailable. Status, creature and braid reads require the owned Wildkin ruleset indexer over the owned ord inscription index, which is not connected on this deployment.';

/**
 * Wildkin creature, bloodline and braid evidence.
 *
 * Every read here needs an owned indexer that applies the Wildkin ruleset to
 * the owned ord inscription index. None is connected, so each read reports
 * the absent source. The revision this replaces answered from constants:
 * three creatures with invented inscription IDs and binding outpoints, and a
 * braid ceremony marked valid because the constant said so.
 */
export class WildkinService {
  /** @asyncSafe */
  public async $getStatus(): Promise<WildkinStatusSummary> {
    throw new WildkinEvidenceError('unavailable-wildkin-indexer', indexerUnavailable);
  }

  /** @asyncSafe */
  public async $getCreatures(): Promise<WildkinCreature[]> {
    throw new WildkinEvidenceError('unavailable-wildkin-indexer', indexerUnavailable);
  }

  /** @asyncSafe */
  public async $getCreature(_id: string): Promise<WildkinCreature | null> {
    throw new WildkinEvidenceError('unavailable-wildkin-indexer', indexerUnavailable);
  }

  /** @asyncSafe */
  public async $getBraids(): Promise<WildkinBraidCeremony[]> {
    throw new WildkinEvidenceError('unavailable-wildkin-indexer', indexerUnavailable);
  }
}

export const wildkinService = new WildkinService();
