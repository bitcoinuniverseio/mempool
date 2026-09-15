import { createHash } from 'crypto';
import { OffchainPackageVerifier } from './package-verifier';
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
 * data through an explicit signed-transaction profile and owned header checkpoint.
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
  if (manifest.signature_scheme !== 'schnorr' && manifest.signature_scheme !== 'ecdsa') return { valid: false, scheme: null, reason: 'Unsupported signature_scheme: explicitly select schnorr or ecdsa' };
  try {
    const valid = manifest.signature_scheme === 'schnorr' ? secp256k1.verifySchnorr(digest, key.subarray(1), sig) : secp256k1.verify(digest, key, sig, true);
    if (valid) return { valid: true, scheme: manifest.signature_scheme, reason: null };
  } catch { /* Invalid curve point or signature encoding. No algorithm fallback. */ }  return { valid: false, scheme: null, reason: 'signature does not verify against operator_public_key over the canonical manifest body' };
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
    if (!manifest.effective_from || !Number.isFinite(Date.parse(manifest.effective_from))) errors.push('Valid effective_from timestamp is required');
    if (!manifest.expires_at || !Number.isFinite(Date.parse(manifest.expires_at))) errors.push('Valid expires_at timestamp is required');
    if (Date.parse(manifest.effective_from || '') > Date.now()) errors.push('Manifest is not yet effective');
    if (Date.parse(manifest.expires_at || '') <= Date.now()) errors.push('Manifest has expired');
    if (Date.parse(manifest.expires_at || '') <= Date.parse(manifest.effective_from || '')) errors.push('Manifest validity interval is reversed');
    const signature = verifyManifestSignature(manifest);
    if (!signature.valid && signature.reason) { errors.push(signature.reason); }
    return {
      verified: errors.length === 0 && signature.valid,
      operator_id: `op-${createHash('sha256').update(manifest.operator_public_key || '').digest('hex').substring(0, 12)}`,
      scheme: signature.scheme,
      errors,
    };
  }

  public packageVerifier = new OffchainPackageVerifier();

  public verifyTransferPackage(data: any) {
    return this.packageVerifier.verify(data, 'statechain');
  }

  public verifyCoinswapPackage(data: any) {
    return this.packageVerifier.verify(data, 'coinswap');
  }
  public generateRecoveryPlan(params: { protocol: 'statechain' | 'coinswap'; entity_id: string; current_stage: string; target_locktime?: number; current_height?: number }): OffchainRecoveryPlan {
    const targetLock = null;
    const recoveryState: OffchainRecoveryPlan['recovery_state'] = 'insufficient_artifacts';
    const guidance = 'An identifier, caller height or locktime cannot authorize recovery. Verify the signed public backup or CoinSwap contract package against the owned node first, then assess current spendability and policy using the exact recovery transaction. No recovery PSBT is generated here.';    const feeRate = this.recommendedFeeRate();
    return {
      plan_id: EventEnvelopeValidator.generateUuidV7(), protocol: params.protocol, entity_id: params.entity_id, current_stage: params.current_stage || 'latest_backup_ready',
      earliest_broadcast_height: targetLock ?? 0, requires_fee_bump: false, suggested_fee_rate_sats_vb: feeRate, recovery_state: recoveryState,
      // A recovery PSBT needs the backup transaction and its input; nothing is constructed from an entity ID alone.
      unsigned_psbt_hex: null, action_guidance: guidance,
    };
  }
}

export default new OffchainService();
