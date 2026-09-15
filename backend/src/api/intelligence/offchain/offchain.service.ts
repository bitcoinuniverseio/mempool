import config from '../../../config';
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

export class OffchainRegistryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

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
  private registryCache: { at: number; path: string; network: string; registry: OffchainRegistry } | null = null;
  public registryPath: () => string | undefined = () => process.env[REGISTRY_ENV];
  public currentHeight: () => number = () => blocks.getCurrentBlockHeight();
  public recommendedFeeRate: () => number | null = () => { try { return feeApi.getRecommendedFee().halfHourFee; } catch { return null; } };

  /** Test seam. */
  public resetForTests(): void {
    this.registryCache = null;
  }

  private registry(now = Date.now()): OffchainRegistry {
    const path = this.registryPath(), network = config.MEMPOOL.NETWORK;
    if (!path) throw new OffchainRegistryError('unavailable-registry', 'No offchain registry is configured.');
    if (this.registryCache && this.registryCache.path === path && this.registryCache.network === network && now >= this.registryCache.at && now - this.registryCache.at < 60000) return this.registryCache.registry;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(path, 'r');
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('bounds');
      const buffer = Buffer.alloc(1024 * 1024 + 1); let read = 0;
      while (read < buffer.length) { const n = fs.readSync(descriptor, buffer, read, buffer.length-read, null); if (!n) break; read += n; }
      if (read > 1024 * 1024) throw Error('bounds');
      const bytes = buffer.subarray(0,read), parsed = JSON.parse(bytes.toString('utf8'));
      const object = (v:any) => v && typeof v === 'object' && !Array.isArray(v);
      const text = (v:any,n=256) => typeof v === 'string' && v.length > 0 && v.length <= n;
      const array = (v:any) => Array.isArray(v) && v.length <= 64 && v.every((x:any)=>text(x));
      const amount = (v:any) => Number.isSafeInteger(v) && v >= 0 && v <= 2100000000000000;
      if (!object(parsed) || !Array.isArray(parsed.operators) || parsed.operators.length > 1000 || !Array.isArray(parsed.offers) || parsed.offers.length > 2000 || !object(parsed.history)) throw Error('schema');
      const ids = new Set<string>();
      for (const operator of parsed.operators) {
        if (!object(operator) || !text(operator.operator_id) || ids.has(operator.operator_id) || !['mercury_statechain','teleport_coinswap'].includes(operator.protocol) || !text(operator.display_name) || typeof operator.operator_public_key !== 'string' || !/^(02|03)[a-f0-9]{64}$/i.test(operator.operator_public_key) || !array(operator.networks) || !array(operator.supported_versions) || !array(operator.transfer_capabilities) || !array(operator.recovery_capabilities) || !object(operator.endpoints) || !text(operator.endpoints.clearnet,2048)) throw Error('operator schema');
        ids.add(operator.operator_id);
      }
      const offers = new Set<string>();
      for (const offer of parsed.offers) {
        if (!object(offer) || !text(offer.offer_id) || offers.has(offer.offer_id) || !ids.has(offer.maker_id) || !text(offer.network) || !text(offer.endpoint,2048) || !amount(offer.min_amount_sats) || !amount(offer.max_amount_sats) || offer.max_amount_sats < offer.min_amount_sats || !amount(offer.base_fee_sats) || !Number.isFinite(offer.fee_rate_bps) || offer.fee_rate_bps < 0 || offer.fee_rate_bps > 10000 || !Array.isArray(offer.supported_timelock_deltas) || offer.supported_timelock_deltas.length > 64 || !offer.supported_timelock_deltas.every((x:any)=>Number.isInteger(x)&&x>=0&&x<=0xffffffff)) throw Error('offer schema');
        offers.add(offer.offer_id);
      }
      if (Object.entries(parsed.history).some(([id,events])=>!ids.has(id)||!Array.isArray(events)||events.length>1000)) throw Error('history schema');
      const operators = parsed.operators.filter((operator:any)=>operator.networks.includes(network)).map((operator:any)=>({...operator,health:'unknown',provenance:{registered_in_knowledge_registry:null,verified_signature:null},operator_authenticated:null,evidence_scope:'Operator-configured reference entry; endpoint health, signatures and identity authority are not observed.'}));
      const selected = new Set(operators.map((operator:any)=>operator.operator_id));
      const registry: OffchainRegistry = { source:'sha256:'+createHash('sha256').update(bytes).digest('hex'), operators, offers:parsed.offers.filter((offer:any)=>offer.network===network&&selected.has(offer.maker_id)),history:Object.fromEntries(Object.entries(parsed.history).filter(([id])=>selected.has(id))) as Record<string, unknown[]>,error:null };
      this.registryCache = {at:now,path,network,registry}; return registry;
    } catch { throw new OffchainRegistryError('invalid-registry-source','The configured offchain registry is unreadable, malformed or exceeds its bounds.'); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }

  public getOverview(): OffchainOverviewResponse {
    const registry = this.registry();
    return {
      total_operators: registry.operators.length,
      // Statechain counts live with the operators; no operator on this deployment reports them.
      active_statechains_count: null,
      active_coinswap_makers: null,
      configured_coinswap_makers: new Set(registry.offers.map(offer => offer.maker_id)).size,
      operators: registry.operators,
      public_offers: registry.offers,
      registry: { configured: true, source: registry.source, error: registry.error, observed_at: new Date(this.registryCache!.at).toISOString(), scope: 'Configured reference catalog only; operator availability and offer acceptance are not observed.' },
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

  public verifyManifest(manifest: Partial<StatechainPublicManifest>) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Buffer.byteLength(JSON.stringify(manifest)) > 65536) throw new OffchainRegistryError('invalid-input', 'A bounded manifest object is required.', 400);
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
      signature_valid: signature.valid,
      operator_authenticated: null,
      verification_scope: 'Signature over the supplied canonical manifest and declared validity interval only. The supplied signing key is not authenticated as an operator identity or domain.',
      operator_id: `op-${createHash('sha256').update(manifest.operator_public_key || '').digest('hex').substring(0, 12)}`,
      scheme: signature.scheme,
      declared_scheme: manifest.signature_scheme ?? null,
      manifest_digest: manifestDigest(manifest).toString('hex'),
      input_digest: createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map(key => [key, (manifest as any)[key]])))).digest('hex'),
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
