import { createHash, createPublicKey, verify as verifyEd25519 } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { verifySchnorr } from 'tiny-secp256k1';
import config from '../../../config';
import { AcceleratorProvider, AcceleratorProviderKey, AcceleratorReceipt, ReceiptVerificationResult } from './private-submission.models';

/**
 * The owned accelerator provider directory and the receipt verification
 * that depends on it.
 *
 * The directory is a JSON file named by UNIVERSE_ACCELERATOR_PROVIDER_DIRECTORY
 * that an operator maintains:
 *
 *   {
 *     "schema": "universe-accelerator-directory-v1",
 *     "revision": "2026-09-17.1",
 *     "providers": [{
 *       "id": "provider-id", "name": "Display name", "networks": ["signet"],
 *       "issuer": "who vouches for these keys", "protocolVersion": "universe-accelerator-receipt-v1",
 *       "keys": [{ "kid": "k1", "algorithm": "ed25519" | "secp256k1-schnorr", "publicKey": "<hex>",
 *                  "validFrom": "<iso>", "validUntil": "<iso>" | null }],
 *       "terms": { "minimum_fee_sats": 0, "maximum_tx_vsize": 0, "payment_methods": [], "partner_mining_claims": [] }
 *     }]
 *   }
 *
 * Trust comes from the file and nothing else: a receipt names a provider
 * and a key id, and only a key the directory holds for that provider, valid
 * at the receipt's issue time, can verify it. The signed payload encoding is
 * documented on AcceleratorReceipt in the models file.
 */

export const ACCELERATOR_DIRECTORY_VARIABLE = 'UNIVERSE_ACCELERATOR_PROVIDER_DIRECTORY';
export const ACCELERATOR_DIRECTORY_SCHEMA = 'universe-accelerator-directory-v1';
export const ACCELERATOR_RECEIPT_SCHEMA = 'universe-accelerator-receipt-v1';
export const ACCELERATOR_LIMITS = { fileBytes: 1_048_576, providers: 200, keysPerProvider: 16, replayRecords: 50_000 } as const;

export interface DirectoryProvider {
  id: string;
  name: string;
  networks: string[];
  issuer: string;
  protocolVersion: string;
  keys: AcceleratorProviderKey[];
  terms: { minimum_fee_sats: number; maximum_tx_vsize: number; payment_methods: string[]; partner_mining_claims: string[] };
}

export interface AcceleratorDirectory {
  source: string;
  revision: string;
  loaded_at_utc: string;
  providers: DirectoryProvider[];
}

export class AcceleratorDirectoryError extends Error {
  constructor(public readonly reason: 'unconfigured' | 'unreadable' | 'malformed', message: string) {
    super(message);
  }
}

const ISO = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const HEX = /^[0-9a-f]+$/i;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

function parseProvider(raw: any, index: number): DirectoryProvider {
  const where = `providers[${index}]`;
  if (!raw || typeof raw !== 'object' || !ID.test(String(raw.id)) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 128) {
    throw new AcceleratorDirectoryError('malformed', `${where}: id and name are required.`);
  }
  if (!Array.isArray(raw.networks) || !raw.networks.length || raw.networks.some((n: unknown) => typeof n !== 'string' || !n)) {
    throw new AcceleratorDirectoryError('malformed', `${where}: networks must list at least one network.`);
  }
  if (typeof raw.issuer !== 'string' || !raw.issuer.trim() || typeof raw.protocolVersion !== 'string' || !raw.protocolVersion) {
    throw new AcceleratorDirectoryError('malformed', `${where}: issuer and protocolVersion are required.`);
  }
  if (!Array.isArray(raw.keys) || !raw.keys.length || raw.keys.length > ACCELERATOR_LIMITS.keysPerProvider) {
    throw new AcceleratorDirectoryError('malformed', `${where}: keys must hold 1 to ${ACCELERATOR_LIMITS.keysPerProvider} entries.`);
  }
  const keys: AcceleratorProviderKey[] = raw.keys.map((key: any, k: number) => {
    const keyWhere = `${where}.keys[${k}]`;
    if (!key || !ID.test(String(key.kid)) || !['ed25519', 'secp256k1-schnorr'].includes(key.algorithm)) {
      throw new AcceleratorDirectoryError('malformed', `${keyWhere}: kid and a supported algorithm are required.`);
    }
    if (typeof key.publicKey !== 'string' || !HEX.test(key.publicKey) || key.publicKey.length !== 64) {
      throw new AcceleratorDirectoryError('malformed', `${keyWhere}: publicKey must be 32 bytes of hex (ed25519 key or x-only secp256k1 point).`);
    }
    if (!ISO(key.validFrom) || (key.validUntil !== null && key.validUntil !== undefined && !ISO(key.validUntil))) {
      throw new AcceleratorDirectoryError('malformed', `${keyWhere}: validFrom must be a timestamp and validUntil a timestamp or null.`);
    }
    return { kid: key.kid, algorithm: key.algorithm, publicKey: key.publicKey.toLowerCase(), validFrom: key.validFrom, validUntil: key.validUntil ?? null };
  });
  if (new Set(keys.map(key => key.kid)).size !== keys.length) {
    throw new AcceleratorDirectoryError('malformed', `${where}: key ids must be unique.`);
  }
  const terms = raw.terms ?? {};
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 32) : []);
  return {
    id: raw.id, name: raw.name.trim(), networks: raw.networks, issuer: raw.issuer.trim(), protocolVersion: raw.protocolVersion, keys,
    terms: { minimum_fee_sats: Number.isFinite(terms.minimum_fee_sats) ? terms.minimum_fee_sats : 0, maximum_tx_vsize: Number.isFinite(terms.maximum_tx_vsize) ? terms.maximum_tx_vsize : 0, payment_methods: list(terms.payment_methods), partner_mining_claims: list(terms.partner_mining_claims) },
  };
}

export function parseAcceleratorDirectory(text: string, source: string, loadedAt = Date.now()): AcceleratorDirectory {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AcceleratorDirectoryError('malformed', 'The provider directory is not JSON.');
  }
  if (!raw || raw.schema !== ACCELERATOR_DIRECTORY_SCHEMA || typeof raw.revision !== 'string' || !raw.revision || !Array.isArray(raw.providers)) {
    throw new AcceleratorDirectoryError('malformed', `The provider directory must declare schema ${ACCELERATOR_DIRECTORY_SCHEMA}, a revision and a providers list.`);
  }
  if (raw.providers.length > ACCELERATOR_LIMITS.providers) {
    throw new AcceleratorDirectoryError('malformed', `The provider directory lists more than ${ACCELERATOR_LIMITS.providers} providers.`);
  }
  const providers = raw.providers.map(parseProvider);
  if (new Set(providers.map((p: DirectoryProvider) => p.id)).size !== providers.length) {
    throw new AcceleratorDirectoryError('malformed', 'Provider ids must be unique.');
  }
  return { source, revision: raw.revision, loaded_at_utc: new Date(loadedAt).toISOString(), providers };
}

let cache: { path: string; mtimeMs: number; directory: AcceleratorDirectory } | null = null;
let override: AcceleratorDirectory | null | undefined;

/** The directory named by the environment; re-read when the file changes. */
export function acceleratorDirectory(environment: Record<string, string | undefined> = process.env): AcceleratorDirectory {
  if (override !== undefined) {
    if (override === null) { throw new AcceleratorDirectoryError('unconfigured', unconfiguredMessage()); }
    return override;
  }
  const path = String(environment[ACCELERATOR_DIRECTORY_VARIABLE] ?? '').trim();
  if (!path) { throw new AcceleratorDirectoryError('unconfigured', unconfiguredMessage()); }
  let mtimeMs: number;
  let size: number;
  try {
    const stat = statSync(path);
    mtimeMs = stat.mtimeMs;
    size = stat.size;
  } catch (e) {
    throw new AcceleratorDirectoryError('unreadable', `The provider directory at ${ACCELERATOR_DIRECTORY_VARIABLE} could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (size > ACCELERATOR_LIMITS.fileBytes) { throw new AcceleratorDirectoryError('malformed', 'The provider directory file is too large.'); }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) { return cache.directory; }
  const directory = parseAcceleratorDirectory(readFileSync(path, 'utf8'), path);
  cache = { path, mtimeMs, directory };
  return directory;
}

function unconfiguredMessage(): string {
  return `The accelerator provider directory is unavailable. Provider identities and receipt trust require the owned signed provider directory named by ${ACCELERATOR_DIRECTORY_VARIABLE}, which is not configured on this deployment.`;
}

/** Test seam. */
export function useAcceleratorDirectory(directory: AcceleratorDirectory | null | undefined): void {
  override = directory;
  replays.clear();
}

export function providerView(provider: DirectoryProvider, directory: AcceleratorDirectory, now = Date.now()): AcceleratorProvider {
  const current = provider.keys.find(key => keyValidAt(key, now)) ?? provider.keys[0];
  const from = provider.keys.map(key => Date.parse(key.validFrom)).sort((a, b) => a - b)[0];
  const until = provider.keys.some(key => key.validUntil === null) ? null : provider.keys.map(key => Date.parse(key.validUntil as string)).sort((a, b) => b - a)[0];
  return {
    provider_id: provider.id,
    identity_key: current.publicKey,
    name: provider.name,
    supported_networks: provider.networks,
    submission_modes: ['configured_accelerator'],
    minimum_fee_sats: provider.terms.minimum_fee_sats,
    maximum_tx_vsize: provider.terms.maximum_tx_vsize,
    payment_methods: provider.terms.payment_methods,
    partner_mining_claims: provider.terms.partner_mining_claims,
    status_endpoint: null,
    health_status: 'unmeasured',
    effective_from: new Date(from).toISOString(),
    expires_at: until === null ? null : new Date(until).toISOString(),
    provider_signature: null,
    issuer: provider.issuer,
    protocol_version: provider.protocolVersion,
    keys: provider.keys.map(key => ({ ...key })),
    directory: { source: directory.source, revision: directory.revision, loaded_at_utc: directory.loaded_at_utc },
  };
}

export function keyValidAt(key: AcceleratorProviderKey, at: number): boolean {
  return Date.parse(key.validFrom) <= at && (key.validUntil === null || Date.parse(key.validUntil) > at);
}

/** Deterministic JSON: keys sorted at every level, no whitespace. */
export function deterministicJson(value: unknown): string {
  if (value === null || typeof value !== 'object') { return JSON.stringify(value); }
  if (Array.isArray(value)) { return '[' + value.map(deterministicJson).join(',') + ']'; }
  const keys = Object.keys(value as Record<string, unknown>).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + deterministicJson((value as Record<string, unknown>)[key])).join(',') + '}';
}

/** The bytes a provider signs for a receipt. */
export function receiptSigningMessage(receipt: Omit<AcceleratorReceipt, 'provider_signature' | 'key_id'>): Buffer {
  return Buffer.from(ACCELERATOR_RECEIPT_SCHEMA + '\n' + deterministicJson(receipt), 'utf8');
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyReceiptSignature(key: AcceleratorProviderKey, message: Buffer, signatureHex: string): boolean {
  if (!HEX.test(signatureHex) || signatureHex.length !== 128) { return false; }
  const signature = Buffer.from(signatureHex, 'hex');
  try {
    if (key.algorithm === 'ed25519') {
      const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.publicKey, 'hex')]), format: 'der', type: 'spki' });
      return verifyEd25519(null, message, publicKey, signature);
    }
    return verifySchnorr(createHash('sha256').update(message).digest(), Buffer.from(key.publicKey, 'hex'), signature);
  } catch {
    return false;
  }
}

const replays = new Map<string, { first_verified_at_utc: string; seen_count: number }>();

/** Structural checks on the caller's payload; these need no directory. */
export function receiptStructuralErrors(receipt: Partial<AcceleratorReceipt>): string[] {
  const errors: string[] = [];
  for (const [key, max] of [['provider_id', 256], ['receipt_id', 256], ['provider_signature', 8192], ['key_id', 128], ['schema_version', 64], ['network', 32]] as const) {
    if (typeof receipt[key] === 'string' && (receipt[key] as string).length > max) { errors.push(key + ' is too long'); }
  }
  if (typeof receipt.provider_id !== 'string' || !receipt.provider_id.trim()) { errors.push('provider_id is required'); }
  if (typeof receipt.receipt_id !== 'string' || !receipt.receipt_id.trim()) { errors.push('receipt_id is required'); }
  if (typeof receipt.provider_signature !== 'string' || !receipt.provider_signature.trim()) { errors.push('provider_signature is required'); }
  if (typeof receipt.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(receipt.txid)) { errors.push('Valid 32-byte txid is required'); }
  return errors;
}

function completeReceiptErrors(receipt: Partial<AcceleratorReceipt>): string[] {
  const errors: string[] = [];
  if (typeof receipt.key_id !== 'string' || !receipt.key_id.trim()) { errors.push('key_id is required'); }
  if (typeof receipt.network !== 'string' || !receipt.network) { errors.push('network is required'); }
  if (!ISO(receipt.submitted_at_utc)) { errors.push('submitted_at_utc must be a timestamp'); }
  if (!ISO(receipt.expires_at_utc)) { errors.push('expires_at_utc must be a timestamp'); }
  for (const field of ['target_feerate_sats_vb', 'provider_fee_sats', 'claimed_mining_coverage_pct'] as const) {
    if (typeof receipt[field] !== 'number' || !Number.isFinite(receipt[field])) { errors.push(field + ' must be a number'); }
  }
  if (!Array.isArray(receipt.claimed_partner_pools) || receipt.claimed_partner_pools.some(p => typeof p !== 'string')) { errors.push('claimed_partner_pools must be a list of strings'); }
  if (!['active', 'included', 'expired', 'refunded'].includes(String(receipt.status))) { errors.push('status must be active, included, expired or refunded'); }
  if (receipt.wtxid !== undefined && (typeof receipt.wtxid !== 'string' || !/^[0-9a-f]{64}$/i.test(receipt.wtxid))) { errors.push('wtxid must be 32 bytes of hex when present'); }
  return errors;
}

/**
 * Verifies a receipt against the directory. Every failure names its stage;
 * a verified receipt is recorded so a replay of the same provider and
 * receipt id is reported as a duplicate.
 */
export function verifyAcceleratorReceipt(receipt: Partial<AcceleratorReceipt>, options: { now?: number; network?: string; directory?: () => AcceleratorDirectory } = {}): ReceiptVerificationResult {
  const now = options.now ?? Date.now();
  const network = options.network ?? config.MEMPOOL.NETWORK;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || JSON.stringify(receipt).length > 16384) {
    return { verified: false, stage: 'invalid', errors: ['Receipt must be a JSON object no larger than16KiB.'] };
  }
  const structural = receiptStructuralErrors(receipt);
  if (structural.length) { return { verified: false, stage: 'invalid', errors: structural }; }
  const identity = { provider_id: receipt.provider_id as string, receipt_id: receipt.receipt_id as string };
  if (receipt.schema_version !== ACCELERATOR_RECEIPT_SCHEMA) {
    return { verified: false, stage: 'unsupported', errors: [`schema_version must be ${ACCELERATOR_RECEIPT_SCHEMA}; no other receipt encoding is verifiable here.`], ...identity };
  }
  const complete = completeReceiptErrors(receipt);
  if (complete.length) { return { verified: false, stage: 'invalid', errors: complete, ...identity }; }
  const full = receipt as AcceleratorReceipt;

  let directory: AcceleratorDirectory;
  try {
    directory = (options.directory ?? acceleratorDirectory)();
  } catch (e) {
    return { verified: false, stage: 'unavailable-trust', errors: [e instanceof Error ? e.message : String(e)], ...identity, key_id: full.key_id };
  }
  const info = { ...identity, key_id: full.key_id, directory: { source: directory.source, revision: directory.revision, loaded_at_utc: directory.loaded_at_utc } };
  const provider = directory.providers.find(p => p.id === full.provider_id);
  if (!provider) { return { verified: false, stage: 'unavailable-trust', errors: [`Provider ${full.provider_id} is not in the owned directory (revision ${directory.revision}); its receipts cannot be trusted.`], ...info }; }
  if (provider.protocolVersion !== ACCELERATOR_RECEIPT_SCHEMA) { return { verified: false, stage: 'unsupported', errors: [`Provider ${provider.id} issues ${provider.protocolVersion} receipts, which this deployment cannot verify.`], ...info }; }
  const key = provider.keys.find(k => k.kid === full.key_id);
  if (!key) { return { verified: false, stage: 'unavailable-trust', errors: [`Key ${full.key_id} is not a directory key of provider ${provider.id}.`], ...info }; }
  const issuedAt = Date.parse(full.submitted_at_utc);
  if (!keyValidAt(key, issuedAt)) { return { verified: false, stage: 'unavailable-trust', errors: [`Key ${key.kid} was not valid at ${full.submitted_at_utc}.`], ...info, algorithm: key.algorithm }; }
  if (full.network !== network || !provider.networks.includes(full.network)) {
    return { verified: false, stage: 'wrong-network', errors: [`Receipt is for ${full.network}; this deployment serves ${network} and the provider is listed for ${provider.networks.join(', ')}.`], ...info, algorithm: key.algorithm };
  }
  const { provider_signature, key_id, ...payload } = full;
  void key_id;
  if (!verifyReceiptSignature(key, receiptSigningMessage(payload), provider_signature)) {
    return { verified: false, stage: 'invalid', errors: ['provider_signature does not verify over the receipt payload with the directory key; a field or the signature was altered.'], ...info, algorithm: key.algorithm };
  }
  if (Date.parse(full.expires_at_utc) <= now) {
    return { verified: false, stage: 'expired', errors: [`Receipt expired at ${full.expires_at_utc}.`], ...info, algorithm: key.algorithm };
  }
  if (Date.parse(full.expires_at_utc) <= issuedAt) {
    return { verified: false, stage: 'invalid', errors: ['expires_at_utc precedes submitted_at_utc.'], ...info, algorithm: key.algorithm };
  }
  const replayKey = `${provider.id}\u0000${full.receipt_id}`;
  const seen = replays.get(replayKey);
  const at = new Date(now).toISOString();
  if (seen) {
    seen.seen_count++;
    return { verified: false, stage: 'duplicate', errors: [`Receipt ${full.receipt_id} from ${provider.id} was already verified at ${seen.first_verified_at_utc}; this presentation is a replay.`], ...info, algorithm: key.algorithm, replay: { ...seen } };
  }
  if (replays.size >= ACCELERATOR_LIMITS.replayRecords) { replays.delete(replays.keys().next().value as string); }
  replays.set(replayKey, { first_verified_at_utc: at, seen_count: 1 });
  return {
    verified: true, stage: 'verified', errors: [], ...info, algorithm: key.algorithm, verified_at_utc: at, replay: { first_verified_at_utc: at, seen_count: 1 },
    scope: 'The signature binds the provider, receipt, transaction, network, times and terms to a directory key. It proves the provider issued the receipt, not that the acceleration was delivered; replay records are kept in this process only.',
  };
}
