import { createHash } from 'crypto';
import * as fs from 'fs';
import * as secp256k1 from 'tiny-secp256k1';
import blocks from '../../blocks';
import feeApi from '../../fee-api';
import { EventEnvelopeValidator } from '../events/event-envelope';
import {
  OffchainOperator,
  StatechainPublicManifest,
  StatechainBackupTransaction,
  StatechainTransferVerification,
  CoinswapPublicOffer,
  CoinswapPackageVerification,
  OffchainRecoveryPlan,
  OffchainOverviewResponse,
} from './offchain.models';

/**
 * Statechain and CoinSwap operators, offers and package checks.
 *
 * The revision this replaces seeded two operators with .local endpoints and
 * an offer nobody published, reported 340 active statechains, verified any
 * manifest whose signature field was non-empty, always reported watchtower
 * coverage as verified, and returned a constant PSBT as the recovery
 * transaction.
 *
 * Operators and offers now come from the registry file this deployment is
 * configured with (UNIVERSE_OFFCHAIN_REGISTRY_JSON); an unconfigured
 * registry is empty and says so. A manifest is verified only when its
 * Schnorr or ECDSA signature over the canonical manifest body checks out
 * against the operator key. Package checks remain checks on the supplied
 * data, with the chain height taken from this backend rather than assumed.
 */

export const REGISTRY_ENV = 'UNIVERSE_OFFCHAIN_REGISTRY_JSON';

export interface OffchainRegistry {
  source: string | null;
  operators: OffchainOperator[];
  offers: CoinswapPublicOffer[];
  history: Record<string, unknown[]>;
  error: string | null;
}

/** The bytes an operator signs: the manifest without its signature, keys sorted, as compact JSON, hashed with SHA-256. */
export function manifestDigest(manifest: Partial<StatechainPublicManifest>): Buffer {
  const body: Record<string, unknown> = {};
  for (const key of Object.keys(manifest).filter(key => key !== 'signature').sort()) {
    body[key] = (manifest as Record<string, unknown>)[key];
  }
  return createHash('sha256').update(JSON.stringify(body)).digest();
}

export function verifyManifestSignature(manifest: Partial<StatechainPublicManifest>): { valid: boolean; scheme: 'schnorr' | 'ecdsa' | null; reason: string | null } {
  const pubkey = manifest.operator_public_key ?? '';
  const signature = manifest.signature ?? '';
  if (!/^(02|03)[0-9a-fA-F]{64}$/.test(pubkey)) { return { valid: false, scheme: null, reason: 'operator_public_key must be a 33-byte compressed key in hex' }; }
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) { return { valid: false, scheme: null, reason: 'signature must be 64 bytes in hex' }; }
  const digest = manifestDigest(manifest);
  const key = Buffer.from(pubkey, 'hex');
  const sig = Buffer.from(signature, 'hex');
  try {
    if (secp256k1.verifySchnorr(digest, key.subarray(1), sig)) { return { valid: true, scheme: 'schnorr', reason: null }; }
  } catch { /* fall through to ECDSA */ }
  try {
    if (secp256k1.verify(digest, key, sig)) { return { valid: true, scheme: 'ecdsa', reason: null }; }
  } catch { /* invalid encoding */ }
  return { valid: false, scheme: null, reason: 'signature does not verify against operator_public_key over the canonical manifest body' };
}

export class OffchainService {
  private registryCache: { at: number; registry: OffchainRegistry } | null = null;
  public registryPath: () => string | undefined = () => process.env[REGISTRY_ENV];
  public currentHeight: () => number = () => blocks.getCurrentBlockHeight();
  public recommendedFeeRate: () => number | null = () => { try { return feeApi.getRecommendedFee().halfHourFee; } catch { return null; } };

  /** Test seam. */
  public resetForTests(): void {
    this.registryCache = null;
  }

  private registry(now = Date.now()): OffchainRegistry {
    if (this.registryCache && now - this.registryCache.at < 60_000) { return this.registryCache.registry; }
    const path = this.registryPath();
    let registry: OffchainRegistry = { source: path ?? null, operators: [], offers: [], history: {}, error: null };
    if (path) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
        registry = {
          source: path,
          operators: Array.isArray(parsed.operators) ? parsed.operators : [],
          offers: Array.isArray(parsed.offers) ? parsed.offers : [],
          history: parsed.history && typeof parsed.history === 'object' ? parsed.history : {},
          error: null,
        };
      } catch (error) {
        registry = { source: path, operators: [], offers: [], history: {}, error: error instanceof Error ? error.message : String(error) };
      }
    }
    this.registryCache = { at: now, registry };
    return registry;
  }

  public getOverview(): OffchainOverviewResponse {
    const registry = this.registry();
    return {
      total_operators: registry.operators.length,
      // Statechain counts live with the operators; no operator on this deployment reports them.
      active_statechains_count: null,
      active_coinswap_makers: registry.offers.length,
      operators: registry.operators,
      public_offers: registry.offers,
      registry: { configured: registry.source !== null, source: registry.source, error: registry.error },
    };
  }

  public listProtocols(): Array<{ id: string; name: string; description: string; revision: string }> {
    return [
      { id: 'mercury_statechain', name: 'Mercury Blinded Statechains', description: 'Off-chain Bitcoin UTXO transfer protocol with decrementing locktimes and blinded key coordination', revision: 'v1.3.0' },
      { id: 'teleport_coinswap', name: 'Teleport CoinSwap', description: 'Routed multi-hop CoinSwap with maker-provided contracts and timelocked recovery', revision: 'v0.5.0' },
    ];
  }

  public listOperators(): OffchainOperator[] {
    return this.registry().operators;
  }

  public getOperator(operatorId: string): OffchainOperator | null {
    return this.registry().operators.find(operator => operator.operator_id === operatorId) ?? null;
  }

  public getOperatorHistory(operatorId: string): unknown[] {
    const registry = this.registry();
    if (!registry.operators.some(operator => operator.operator_id === operatorId)) { return []; }
    return registry.history[operatorId] ?? [];
  }

  public listOffers(): CoinswapPublicOffer[] {
    return this.registry().offers;
  }

  public verifyManifest(manifest: Partial<StatechainPublicManifest>): { verified: boolean; operator_id: string; scheme: 'schnorr' | 'ecdsa' | null; errors: string[] } {
    const errors: string[] = [];
    if (!manifest.protocol) { errors.push('Protocol identifier is required'); }
    if (!manifest.signature) { errors.push('Cryptographic signature is required'); }
    if (manifest.expires_at && Number.isFinite(Date.parse(manifest.expires_at)) && Date.parse(manifest.expires_at) < Date.now()) { errors.push('Manifest has expired'); }
    const signature = verifyManifestSignature(manifest);
    if (!signature.valid && signature.reason) { errors.push(signature.reason); }
    return {
      verified: errors.length === 0 && signature.valid,
      operator_id: `op-${createHash('sha256').update(manifest.operator_public_key || '').digest('hex').substring(0, 12)}`,
      scheme: signature.scheme,
      errors,
    };
  }

  public verifyTransferPackage(data: {
    statechain_id: string;
    deposit_amount_sats: number;
    backup_transactions: StatechainBackupTransaction[];
    server_signature_count: number;
    current_height?: number;
  }): StatechainTransferVerification {
    const errors: string[] = [];
    const warnings: string[] = [];
    const currentHeight = data.current_height || this.currentHeight();
    if (!data.statechain_id) { errors.push('Statechain ID is required'); }
    if (!data.backup_transactions || data.backup_transactions.length === 0) { errors.push('Backup transactions sequence cannot be empty'); }
    let prevLocktime = Infinity;
    let minLocktime = Infinity;
    for (const tx of data.backup_transactions || []) {
      if (tx.locktime >= prevLocktime) {
        errors.push(`Locktime violation at iteration ${tx.iteration}: locktime ${tx.locktime} is not strictly less than previous ${prevLocktime}`);
      }
      if (!tx.server_signature) { errors.push(`Backup transaction at iteration ${tx.iteration} carries no server signature`); }
      prevLocktime = tx.locktime;
      if (tx.locktime < minLocktime) { minLocktime = tx.locktime; }
    }
    const txCount = (data.backup_transactions || []).length;
    const signaturesReconciled = txCount === data.server_signature_count;
    if (!signaturesReconciled) {
      errors.push(`Server signature count (${data.server_signature_count}) does not match backup transactions count (${txCount})`);
    }
    if (currentHeight <= 0) { warnings.push('Current block height is not known to this backend yet; recoverability timing is not assessed.'); }
    let recoverableState: StatechainTransferVerification['recoverable_state'] = 'unsafe_package';
    if (errors.length === 0) {
      recoverableState = currentHeight > 0 && currentHeight >= minLocktime ? 'recoverable_now' : 'recoverable_after_height';
    }
    return {
      statechain_id: data.statechain_id, is_valid: errors.length === 0, deposit_amount_sats: data.deposit_amount_sats, backup_transactions_count: txCount,
      server_signature_count: data.server_signature_count, signatures_reconciled: signaturesReconciled, earliest_unilateral_exit_height: minLocktime === Infinity ? 0 : minLocktime,
      current_block_height: currentHeight, recoverable_state: recoverableState, errors, warnings,
    };
  }

  public verifyCoinswapPackage(data: { package_id: string; maker_id: string; swap_amount_sats: number; contracts: any[] }): CoinswapPackageVerification {
    const errors: string[] = [];
    if (!data.package_id) { errors.push('Package ID is required'); }
    if (!data.contracts || data.contracts.length < 2) { errors.push('CoinSwap package requires funding and refund contract transactions'); }
    let forwardLocktime = 0;
    let backwardLocktime = 0;
    for (const c of data.contracts || []) {
      if (c.role === 'forward_contract') { forwardLocktime = c.timelock; }
      if (c.role === 'backward_contract') { backwardLocktime = c.timelock; }
    }
    if (forwardLocktime > 0 && backwardLocktime > 0 && forwardLocktime <= backwardLocktime) {
      errors.push('Forward contract timelock must be strictly greater than backward contract timelock for safe recovery');
    }
    return {
      package_id: data.package_id, is_valid: errors.length === 0, maker_id: data.maker_id, total_hops: Math.max(0, (data.contracts || []).length - 1),
      swap_amount_sats: data.swap_amount_sats, contract_transactions: data.contracts || [],
      // No watchtower reports to this deployment; coverage is not something it can vouch for.
      watchtower_coverage_verified: false,
      recovery_state: errors.length === 0 ? 'recoverable_after_height' : 'unsafe_package', errors,
    };
  }

  public generateRecoveryPlan(params: { protocol: 'statechain' | 'coinswap'; entity_id: string; current_stage: string; target_locktime?: number; current_height?: number }): OffchainRecoveryPlan {
    const currentHeight = params.current_height || this.currentHeight();
    const targetLock = params.target_locktime ?? null;
    let recoveryState: OffchainRecoveryPlan['recovery_state'] = 'unknown';
    let guidance = 'Provide target_locktime from the latest backup transaction to assess when recovery can be broadcast.';
    if (targetLock !== null && currentHeight > 0) {
      if (targetLock > currentHeight) {
        recoveryState = 'recoverable_after_height';
        guidance = `Wait until block height ${targetLock} before broadcasting the recovery transaction (current height ${currentHeight}).`;
      } else {
        recoveryState = 'recoverable_now';
        guidance = 'The backup transaction locktime has passed. Build the recovery PSBT from that backup transaction in the PSBT Workbench.';
      }
    }
    const feeRate = this.recommendedFeeRate();
    return {
      plan_id: EventEnvelopeValidator.generateUuidV7(), protocol: params.protocol, entity_id: params.entity_id, current_stage: params.current_stage || 'latest_backup_ready',
      earliest_broadcast_height: targetLock ?? 0, requires_fee_bump: feeRate !== null, suggested_fee_rate_sats_vb: feeRate, recovery_state: recoveryState,
      // A recovery PSBT needs the backup transaction and its input; nothing is constructed from an entity ID alone.
      unsigned_psbt_hex: null, action_guidance: guidance,
    };
  }
}

export default new OffchainService();
