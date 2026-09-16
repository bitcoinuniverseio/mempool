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
