import {
  QuantumPubkeyExposure,
  QuantumCohortBreakdown,
  QuantumRevealEvent,
  QuantumMigrationPlanRequest,
  QuantumMigrationPlanResult,
  QuantumOverview,
} from './quantum.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class QuantumEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const exposureIndexUnavailable =
  'Public key exposure observations are unavailable. Cohort totals, reveal events, per-outpoint audits and migration plans require the owned exposure index (a scan of the owned Bitcoin UTXO set and spend history classifying every output by whether its public key is on chain), which is not connected on this deployment.';

/**
 * Quantum exposure evidence.
 *
 * Cohorts, reveals, audits and migration plans are all observations of the
 * UTXO set and need the owned exposure index; a deployment without one gets a
 * 503 that names it. An audit of a malformed identifier is still a 400.
 */
export class QuantumService {
  private static instance: QuantumService;

  public static getInstance(): QuantumService {
    if (!QuantumService.instance) {
      QuantumService.instance = new QuantumService();
    }
    return QuantumService.instance;
  }

  public getOverview(): QuantumOverview {
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }

  public getCohorts(): QuantumCohortBreakdown[] {
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }

  public getRecentReveals(): QuantumRevealEvent[] {
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }

  public auditAddressOrOutpoint(identifier: string): QuantumPubkeyExposure {
    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      throw new QuantumEvidenceError('invalid-input', 'Identifier is required for quantum audit.', 400);
    }
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }

  public generateMigrationPlan(req: QuantumMigrationPlanRequest): QuantumMigrationPlanResult {
    if (!req || !Array.isArray(req.exposed_outpoints) || req.exposed_outpoints.length === 0) {
      throw new QuantumEvidenceError('invalid-input', 'At least one exposed outpoint is required for a migration plan.', 400);
    }
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }
}

export const quantumService = QuantumService.getInstance();
