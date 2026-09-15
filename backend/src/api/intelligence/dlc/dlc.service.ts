import { createHash } from 'crypto';
import config from '../../../config';
import { verifyAnnouncement, verifyAttestation } from './oracle-verification';
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

  public verifyAnnouncement(data: unknown) { return verifyAnnouncement(data); }

  public verifyAttestation(data: unknown) { return verifyAttestation(data); }

  public verifyContractPackage(pkg: Partial<DlcContractPackage>) {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new DlcEvidenceError('invalid-input', 'A contract package object is required.', 400);
    const errors: string[] = [];
    const money = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 2100000000000000;
    const parties = Array.isArray(pkg.parties) ? pkg.parties : [];
    const cets = Array.isArray(pkg.cets) ? pkg.cets : [];
    if (parties.length > 2 || cets.length > 4096) throw new DlcEvidenceError('invalid-input', 'At most two parties and 4096 CETs are accepted.', 400);
    if (parties.length !== 2) errors.push('DLC contract package requires exactly two parties');
    let total: number | null = 0;
    for (const party of parties) {
      if (!party || !money(party.collateral_sats) || party.collateral_sats === 0) { errors.push('Party collateral must be positive bounded integer satoshis'); total = null; }
      else if (total !== null) total += party.collateral_sats;
    }
    if (total !== null && !money(total)) { total = null; errors.push('Total collateral exceeds Bitcoin monetary bounds'); }
    if (!cets.length) errors.push('Contract package must contain at least one CET');
    for (const cet of cets) {
      if (!cet || !money(cet.local_payout_sats) || !money(cet.remote_payout_sats) || !money(cet.fee_sats)) { errors.push('CET payouts and fees must be bounded nonnegative integer satoshis'); continue; }
      const sum = cet.local_payout_sats + cet.remote_payout_sats + cet.fee_sats;
      if (!Number.isSafeInteger(sum) || total === null || sum !== total) errors.push('CET payouts and fees do not conserve collateral');
    }
    if (!pkg.refund) errors.push('Contract package is missing refund transaction specifications');
    else if (!money(pkg.refund.local_payout_sats) || !money(pkg.refund.remote_payout_sats)) errors.push('Refund payouts must be bounded nonnegative integer satoshis');
    else if (total === null || pkg.refund.local_payout_sats + pkg.refund.remote_payout_sats > total) errors.push('Refund payout exceeds total collateral');
    return {
      valid: errors.length ? false : null,
      structural_checks_passed: errors.length === 0,
      cryptographic_verification: 'not-established' as const,
      input_sha256: createHash('sha256').update(JSON.stringify(pkg)).digest('hex'),
      configured_network: config.MEMPOOL.NETWORK,
      network_scope: 'Configured request context only; no owned chain observation was performed.',
      scope: 'Caller-supplied collateral and payout arithmetic only. Adaptor signatures, oracle bindings, CET/refund transaction scripts, funding UTXOs, fees and timelock maturity are not verified.',
      total_collateral_sats: total, cet_count: cets.length, errors,
      warnings: ['A structurally consistent package is not a verified DLC. Raw authenticated transaction and adaptor-signature evidence is required by the unconnected contract verifier.'],
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
