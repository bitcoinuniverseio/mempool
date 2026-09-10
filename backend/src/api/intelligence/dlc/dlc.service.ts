import crypto from 'crypto';
import {
  DlcOracle,
  DlcOracleAnnouncement,
  DlcOracleAttestation,
  DlcOracleConflictEvidence,
  DlcContractPackage,
  DlcSimulationResult,
  DlcOverviewResponse,
} from './dlc.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class DlcEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const oracleRegistryUnavailable =
  'DLC oracle observations are unavailable. Oracles, announcements, attestations and conflict evidence require the owned oracle registry and attestation crawler (UNIVERSE_DLC_ORACLE_REGISTRY_ORIGIN), which are not connected on this deployment.';

const simulatorUnavailable =
  'DLC simulations are unavailable. Settlement, outage, conflict, refund and reorg scenarios require the owned regtest DLC harness (UNIVERSE_DLC_SIMULATOR_ORIGIN) and its Bitcoin regtest node, which are not connected on this deployment.';

/**
 * Discreet Log Contract and oracle evidence.
 *
 * Every observation here used to answer from constants: two named oracles
 * with invented health and coverage, announcements with invented signatures,
 * an attestation that was verified because the constant said so, an
 * equivocation proof nobody produced, and a simulation whose funding and
 * closing transactions were fixed hex. No owned oracle registry or regtest
 * harness is connected, so each read reports the source it would need. The
 * structural checks on caller-supplied announcements, attestations and
 * contract packages stay: they compute on the caller's input and observe
 * nothing.
 */
export class DlcService {
  public getOverview(): DlcOverviewResponse {
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public listOracles(): DlcOracle[] {
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public getOracle(oracleId: string): DlcOracle | undefined {
    void oracleId;
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public getOracleHistory(oracleId: string): DlcOracleAnnouncement[] {
    void oracleId;
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public listEvents(): DlcOracleAnnouncement[] {
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public getEvent(eventId: string): DlcOracleAnnouncement | undefined {
    void eventId;
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public getEventAttestations(eventId: string): DlcOracleAttestation[] {
    void eventId;
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public listConflicts(): DlcOracleConflictEvidence[] {
    throw new DlcEvidenceError('unavailable-oracle-registry', oracleRegistryUnavailable);
  }

  public verifyAnnouncement(data: {
    oracle_public_key: string;
    event_id: string;
    event_descriptor: any;
    event_maturity_epoch: number;
    nonces: string[];
    announcement_signature: string;
  }): {
    verified: boolean;
    announcement_id: string;
    payload_hash: string;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.oracle_public_key || data.oracle_public_key.length < 64) {
      errors.push('Invalid oracle public key length');
    }
    if (!data.event_id || data.event_id.trim().length === 0) {
      errors.push('Event ID is required');
    }
    if (!data.nonces || data.nonces.length === 0) {
      errors.push('At least one nonce point is required');
    }

    // Check for duplicate nonces
    const nonceSet = new Set(data.nonces);
    if (nonceSet.size !== (data.nonces ? data.nonces.length : 0)) {
      errors.push('Duplicate nonce points detected in announcement');
    }

    const payloadString = `${data.oracle_public_key}:${data.event_id}:${data.event_maturity_epoch}:${(data.nonces || []).join(',')}`;
    const payload_hash = crypto.createHash('sha256').update(payloadString).digest('hex');
    const announcement_id = `ann-${payload_hash.substring(0, 16)}`;

    const verified = errors.length === 0 && Boolean(data.announcement_signature);

    return {
      verified,
      announcement_id,
      payload_hash,
      errors,
    };
  }

  public verifyAttestation(data: {
    announcement_id: string;
    oracle_public_key: string;
    event_id: string;
    outcomes: string[];
    signatures: string[];
  }): {
    verified: boolean;
    attestation_id: string;
    has_conflict: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (data.outcomes.length !== data.signatures.length) {
      errors.push('Outcome count must match signature count exactly');
    }

    const attestation_id = `att-${crypto.randomBytes(8).toString('hex')}`;
    const verified = errors.length === 0 && (data.signatures || []).length > 0;

    return {
      verified,
      attestation_id,
      has_conflict: false,
      errors,
    };
  }

  public verifyContractPackage(pkg: Partial<DlcContractPackage>): {
    valid: boolean;
    total_collateral_sats: number;
    cet_count: number;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!pkg.parties || pkg.parties.length !== 2) {
      errors.push('DLC contract package requires exactly two parties');
    }

    let totalCollateral = 0;
    for (const p of pkg.parties || []) {
      if (p.collateral_sats <= 0) {
        errors.push(`Party ${p.role} collateral must be positive`);
      }
      totalCollateral += p.collateral_sats;
    }

    if (!pkg.cets || pkg.cets.length === 0) {
      errors.push('Contract package must contain at least one CET');
    }

    for (const cet of pkg.cets || []) {
      const payoutSum = cet.local_payout_sats + cet.remote_payout_sats + cet.fee_sats;
      if (payoutSum !== totalCollateral) {
        errors.push(
          `CET outcome '${cet.outcome}' total payout (${payoutSum} sats) does not conserve collateral (${totalCollateral} sats)`
        );
      }
      if (!cet.adaptor_signature) {
        errors.push(`CET outcome '${cet.outcome}' is missing adaptor signature`);
      }
    }

    if (!pkg.refund) {
      errors.push('Contract package is missing refund transaction specifications');
    } else {
      const refundSum = pkg.refund.local_payout_sats + pkg.refund.remote_payout_sats;
      if (refundSum > totalCollateral) {
        errors.push('Refund payout exceeds total collateral');
      }
    }

    return {
      valid: errors.length === 0,
      total_collateral_sats: totalCollateral,
      cet_count: (pkg.cets || []).length,
      errors,
      warnings,
    };
  }

  public createSimulation(params: {
    scenario: 'settlement' | 'oracle_outage' | 'conflicting_attestations' | 'refund_timeout' | 'reorg';
    contract_id: string;
    oracle_ids: string[];
    outcome?: string;
  }): DlcSimulationResult {
    void params;
    throw new DlcEvidenceError('unavailable-dlc-simulator', simulatorUnavailable);
  }

  public getSimulation(simId: string): DlcSimulationResult | undefined {
    void simId;
    throw new DlcEvidenceError('unavailable-dlc-simulator', simulatorUnavailable);
  }
}

export default new DlcService();
