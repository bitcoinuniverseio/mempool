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
  /* IMPLEMENTATION-HANDOFF [WP-BE-008]
   * Defect BE-008; COV-BE-008 status, creature list/detail and braid history.
   * All four public operations always throw. The current-source reproducer
   * establishes missing implementation independently of any remote service.
   * 1. Resolve the actual offered Wildkin project/ruleset, schema, activation
   *    heights, content commitments and authoritative release/fixtures before
   *    implementing semantics. R-BE-WILDKIN is explicitly research-blocked:
   *    no verified protocol specification was supplied or found in this
   *    session. Do not substitute another inscription game or invent rules.
   * 2. Add an owned ruleset indexer over the existing owned ord evidence;
   *    persist network, rule revision, inscription/outpoint identity, cursor
   *    and rollback journal. Check content and ownership/spend evidence before
   *    deriving creatures, bloodlines or braid validity. Keep amounts exact.
   * 3. Replace these stubs with a bounded injected client and map actual
   *    observations to wildkin.types/routes. Paginate lists, distinguish
   *    unknown object from absent source, and preserve provider provenance.
   * 4. Exercise all four API-to-frontend Wildkin journeys on the genuine
   *    supported test network, using authoritative valid/invalid rule vectors,
   *    duplicate inscriptions, ownership changes, missing parent history,
   *    reorg, outage and restart. Include history and lineage regressions.
   * Acceptance: the actual identified ruleset and source substantiate every
   * returned creature and ceremony; missing protocol identity remains a
   * specific prerequisite, not a reason to remove required functionality.
   * Rollback: retain indexed raw evidence and ruleset version, restore the
   * prior schema/client pair and rebuild derived rows from its checkpoint.
   * Preparation only; no invented objects or executable changes are added.
   */
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
