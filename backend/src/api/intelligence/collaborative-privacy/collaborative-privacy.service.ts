import {
  CollaborativePrivacyOverview,
  CollaborativeProtocol,
  CollaborativeCoordinator,
  CollaborativeRound,
  JoinMarketFidelityBond,
} from './collaborative-privacy.models';

/**
 * Raised when a read has no observation source behind it. The routes map the
 * code to a 503, so an absent integration is reported as an absent
 * integration rather than as an answer.
 */
export class CollaborativeEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const directoryUnavailable =
  'Coordinator observations are unavailable. Coordinator identity, health, policy and signature reads require the authenticated owned coordinator directory, which is not connected on this deployment.';

const roundsUnavailable =
  'Round observations are unavailable. Round phases, counts, fees, anonymity sets and classifications require the owned round evidence source and the protocol credential verifier, which are not connected on this deployment.';

const bondsUnavailable =
  'Fidelity bond observations are unavailable. Bond UTXO, locktime, value and signature reads require the owned Bitcoin reader and the JoinMarket bond signature verifier, which are not connected on this deployment.';

/**
 * Collaborative transaction protocols, coordinators, rounds and bonds.
 *
 * The protocol catalogue is a static reference: protocol identifiers,
 * coordination models and specification links are facts about the protocols,
 * not observations, and stay answerable.
 *
 * Everything else the revision this replaces answered from constants: two
 * coordinators reported online with abbreviated signatures nothing checked,
 * two rounds classified protocol_proven with final txids nothing observed,
 * a fidelity bond with signature_verified set to true and a 24 hour round
 * count that was a literal. A reader could not tell those from evidence, and
 * "online", "protocol_proven" and "signature_verified" are exactly the fields
 * a reader trusts. Each observation read now names the integration it is
 * waiting on, and the routes turn that into a 503.
 */
export class CollaborativePrivacyService {
  private protocols: CollaborativeProtocol[] = [
    {
      protocol_id: 'wabisabi',
      name: 'WabiSabi 2.0 (Wasabi)',
      revision: '2.0.4',
      coordination_model: 'centralized_blinded',
      anonymous_credentials: true,
      fidelity_bonds_supported: false,
      specification_url: 'https://github.com/zkSNACKs/WabiSabi',
    },
    {
      protocol_id: 'joinmarket',
      name: 'JoinMarket Maker/Taker',
      revision: '0.9.9',
      coordination_model: 'decentralized_maker_taker',
      anonymous_credentials: false,
      fidelity_bonds_supported: true,
      specification_url: 'https://github.com/JoinMarket-Org/joinmarket-clientserver',
    },
    {
      protocol_id: 'whirlpool_archival',
      name: 'Whirlpool (Archival / Reference)',
      revision: '0.20.0',
      coordination_model: 'fixed_denomination_pool',
      anonymous_credentials: false,
      fidelity_bonds_supported: false,
      specification_url: 'https://samouraiwallet.com/whirlpool',
    },
  ];

  public getOverview(): CollaborativePrivacyOverview {
    throw new CollaborativeEvidenceError('unavailable-observation-source',
      'The collaborative privacy overview is unavailable. Coordinator, round and bond aggregates are derived from observations, and no owned coordinator directory, round evidence source or bond reader is connected on this deployment.');
  }

  public listProtocols(): { protocols: CollaborativeProtocol[] } {
    return { protocols: this.protocols };
  }

  public listCoordinators(): { coordinators: CollaborativeCoordinator[] } {
    throw new CollaborativeEvidenceError('unavailable-directory', directoryUnavailable);
  }

  public getCoordinator(_coordinatorId: string): CollaborativeCoordinator | undefined {
    throw new CollaborativeEvidenceError('unavailable-directory', directoryUnavailable);
  }

  public listRounds(): { rounds: CollaborativeRound[] } {
    throw new CollaborativeEvidenceError('unavailable-round-source', roundsUnavailable);
  }

  public getRound(_roundId: string): CollaborativeRound | undefined {
    throw new CollaborativeEvidenceError('unavailable-round-source', roundsUnavailable);
  }

  public listFidelityBonds(): { fidelity_bonds: JoinMarketFidelityBond[] } {
    throw new CollaborativeEvidenceError('unavailable-bond-source', bondsUnavailable);
  }

  public verifyPublicPackage(pkg: unknown): { verified: false; stage: 'invalid-input' | 'unavailable-verifier'; error: string } {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)
      || typeof (pkg as { protocol?: unknown }).protocol !== 'string'
      || !(pkg as { protocol: string }).protocol.trim()
      || (pkg as { protocol: string }).protocol.length > 128) {
      return { verified: false, stage: 'invalid-input', error: 'A public package object with a protocol identifier is required.' };
    }
    return {
      verified: false, stage: 'unavailable-verifier',
      error: 'The protocol credential verifier and authenticated public round evidence are not connected. No conservation, anonymity or linkability claim was verified.',
    };
  }
}

export default new CollaborativePrivacyService();
