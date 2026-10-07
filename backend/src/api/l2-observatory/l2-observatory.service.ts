import {
  L2BridgeSystem,
  L2Challenge,
  L2ReserveAudit,
} from './l2-observatory.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class L2ObservatoryEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const bridgeUnavailable =
  'Bitcoin L2 bridge observations are unavailable. System, challenge and reserve reads require the owned bridge-contract watcher over the owned Bitcoin reader (bitcoind RPC), which is not connected on this deployment.';

/**
 * BitVM and Bitcoin L2 bridge evidence.
 *
 * Every read here needs an owned watcher that follows the bridge contracts,
 * their challenge transactions and their reserve outpoints on the owned
 * Bitcoin reader. None is connected, so each read reports the absent source.
 * The revision this replaces answered from constants: three bridges marked
 * live with invented contract addresses and locked balances, one pending
 * challenge, and a reserve audit whose ratio was 1.0000 by construction.
 */
export class L2ObservatoryService {
  /* IMPLEMENTATION-HANDOFF [WP-BE-009]
   * Defect BE-009; COV-BE-009 system list/detail, challenges and reserves.
   * These four offered operations have no implementation. The source
   * reproducer returns unavailable regardless of configured dependencies.
   * 1. Obtain the manifest of the systems actually offered: bridge contract
   *    identifiers, chain/dialect, activation/version, verifier/watcher repo,
   *    owners/authorities and challenge/finality rules. R-BE-L2 records that
   *    these identities and specs remain unverified. Generic BitVM research
   *    cannot select or validate a deployed bridge on the user's behalf.
   * 2. Implement/version adapters only for those systems. Ingest owned-chain
   *    contract events, reserve outpoints and challenges with raw evidence,
   *    network identity, integer amounts, confirmations and the same observed
   *    checkpoint; maintain durable cursors and reorg rollback journals.
   * 3. Derive accepted/rejected/pending/expired state from each contract's
   *    actual rules and transactions. Report unavailable liabilities or
   *    settlement evidence explicitly; reserve value alone proves no ratio.
   * 4. Replace stubs and connect l2-observatory types/routes and frontend
   *    systems/challenges/reserves. Bound filters and list sizes, enforce
   *    source ownership and preserve unknown-versus-empty outcomes.
   * 5. Run real supported test-network challenge/resolution and reserve
   *    observation journeys, failed proof, duplicate event, stale checkpoint,
   *    spent reserve, wrong network, crash/restart and multi-block reorg.
   * Acceptance: all four offered operations are grounded in identified
   *    contract evidence; no seeded systems or assumed finality count as GO.
   * Rollback: back up watcher state, stop dependent writers, restore the
   *    compatible contract adapter and replay from the verified checkpoint.
   * Preparation only; the absent integration remains explicitly absent.
   */
  /** @asyncSafe */
  public async $getSystems(): Promise<L2BridgeSystem[]> {
    throw new L2ObservatoryEvidenceError('unavailable-bridge-watcher', bridgeUnavailable);
  }

  /** @asyncSafe */
  public async $getSystem(_id: string): Promise<L2BridgeSystem | null> {
    throw new L2ObservatoryEvidenceError('unavailable-bridge-watcher', bridgeUnavailable);
  }

  /** @asyncSafe */
  public async $getChallenges(_systemId?: string): Promise<L2Challenge[]> {
    throw new L2ObservatoryEvidenceError('unavailable-bridge-watcher', bridgeUnavailable);
  }

  /** @asyncSafe */
  public async $getReserveAudit(_systemId: string): Promise<L2ReserveAudit | null> {
    throw new L2ObservatoryEvidenceError('unavailable-bridge-watcher', bridgeUnavailable);
  }
}

export const l2ObservatoryService = new L2ObservatoryService();
