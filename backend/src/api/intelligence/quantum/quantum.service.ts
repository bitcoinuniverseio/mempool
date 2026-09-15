import {
  QuantumPubkeyExposure,
  QuantumCohortBreakdown,
  QuantumRevealEvent,
  QuantumMigrationPlanRequest,
  QuantumMigrationPlanResult,
  QuantumOverview,
} from './quantum.models';
import { address, networks } from 'bitcoinjs-lib';
import config from '../../../config';

function publicOutpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^([0-9a-f]{64}):(0|[1-9][0-9]{0,9})$/i.exec(value);
  return !!match && Number(match[2]) <= 0xffffffff;
}

function publicIdentifier(value: unknown): boolean {
  if (publicOutpoint(value)) return true;
  if (typeof value !== 'string' || value.length > 100 || !value || /\s/.test(value)) return false;
  const network = config.MEMPOOL.NETWORK;
  const parameters = network === 'mainnet' ? networks.bitcoin : network === 'regtest' ? networks.regtest : ['testnet','testnet4','signet'].includes(network) ? networks.testnet : null;
  try { if (!parameters) return false; address.toOutputScript(value, parameters); return true; } catch { return false; }
}

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
    if (!publicIdentifier(identifier)) {
      throw new QuantumEvidenceError('invalid-input', 'Provide a checksummed public address for the configured Bitcoin network or a canonical txid:vout outpoint.', 400);
    }
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }

  public generateMigrationPlan(req: QuantumMigrationPlanRequest): QuantumMigrationPlanResult {
    if (!req || !Array.isArray(req.exposed_outpoints) || req.exposed_outpoints.length === 0 || req.exposed_outpoints.length > 100 ||
        !req.exposed_outpoints.every(publicOutpoint) || new Set(req.exposed_outpoints.map(value => value.toLowerCase())).size !== req.exposed_outpoints.length ||
        !['p2wpkh','p2tr_script_path','post_quantum_tapscript'].includes(req.target_standard)) {
      throw new QuantumEvidenceError('invalid-input', 'Provide 1 to 100 unique canonical outpoints and a recognized migration target standard.', 400);
    }
    throw new QuantumEvidenceError('unavailable-exposure-index', exposureIndexUnavailable);
  }
}

export const quantumService = QuantumService.getInstance();
