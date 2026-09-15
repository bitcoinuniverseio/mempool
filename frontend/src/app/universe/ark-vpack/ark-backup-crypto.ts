import { base64 } from '@scure/base';
import { Point } from '@noble/secp256k1';

export const MAX_VPACK_BYTES = 1024 * 1024;
export const MAX_VPACK_ENVELOPE_BYTES = 1500000;
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uint = (value: unknown, maximum = 0xffffffff): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const hex = (value: unknown, length: number): value is string => typeof value === 'string' && value.length === length && /^[0-9a-f]+$/i.test(value);
const normalizeNetwork = (network: string): string => network === '' || network === 'bitcoin' ? 'mainnet' : network;

/** Existing MinimalViableVtxo schema; additional package fields remain byte-exact. */
export function validateBackupPackage(text: string, selectedNetwork: string): { vtxoId: string; network: string } {
  if (!text || text.length > MAX_VPACK_BYTES || encoder.encode(text).length > MAX_VPACK_BYTES) throw new Error('The package must be nonempty JSON no larger than 1 MiB.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('The V-PACK JSON is malformed.'); }
  if (!record(parsed)) throw new Error('The package must be a JSON object.');
  const vtxo = parsed.minimal_viable_vtxo === undefined ? parsed : parsed.minimal_viable_vtxo;
  if (!record(vtxo) || vtxo.version !== 1) throw new Error('Expected a supported MVV version 1 package, directly or in minimal_viable_vtxo.');
  if (typeof vtxo.vtxo_id !== 'string' || !vtxo.vtxo_id.trim() || vtxo.vtxo_id.length > 256
    || typeof vtxo.network !== 'string' || !['bitcoin', 'mainnet', 'signet', 'testnet', 'testnet4', 'regtest'].includes(vtxo.network)
    || !uint(vtxo.amount_sats, 2100000000000000) || vtxo.amount_sats === 0
    || !uint(vtxo.sequence) || !uint(vtxo.exit_delay_blocks, 65535) || !uint(vtxo.expires_at_height)
    || typeof vtxo.script_pubkey !== 'string' || !/^(?:[0-9a-f]{2}){1,10000}$/i.test(vtxo.script_pubkey)
    || !record(vtxo.anchor_outpoint) || !hex(vtxo.anchor_outpoint.txid, 64) || !uint(vtxo.anchor_outpoint.vout)) {
    throw new Error('The package has invalid or missing MVV fields.');
  }
  for (const key of [vtxo.asp_pubkey, vtxo.user_pubkey]) {
    if (typeof key !== 'string' || !(/^([0-9a-f]{64}|0[23][0-9a-f]{64})$/i.test(key))) throw new Error('The package has an invalid public key.');
    try { Point.fromHex(key.length === 64 ? '02' + key : key).assertValidity(); }
    catch { throw new Error('The package has an invalid public key.'); }
  }
  if (vtxo.parent_vtxo_id !== undefined && (typeof vtxo.parent_vtxo_id !== 'string' || !vtxo.parent_vtxo_id || vtxo.parent_vtxo_id.length > 256)) throw new Error('The parent VTXO identifier is invalid.');
  if (normalizeNetwork(vtxo.network) !== normalizeNetwork(selectedNetwork)) throw new Error('This package belongs to another Bitcoin network.');
  return { vtxoId: vtxo.vtxo_id, network: normalizeNetwork(vtxo.network) };
}

function header(salt: string, nonce: string) {
  return { format: 'universe-vpack-backup', version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt },
    cipher: { name: 'AES-GCM', nonce, tagLength: 128 } };
}

async function keyFor(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a passphrase of 12 to 1024 characters.');
  const bytes = encoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', bytes as BufferSource, 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: salt as BufferSource }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}

export async function sealVpack(text: string, passphrase: string, network: string): Promise<string> {
  validateBackupPackage(text, network);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const metadata = header(base64.encode(salt), base64.encode(nonce));
  const plaintext = encoder.encode(text);
  try {
    const key = await keyFor(passphrase, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
      additionalData: encoder.encode(JSON.stringify(metadata)), tagLength: 128 }, key, plaintext);
    return JSON.stringify({ ...metadata, ciphertext: base64.encode(new Uint8Array(ciphertext)) }, null, 2);
  } finally { plaintext.fill(0); }
}

export async function openVpack(envelopeText: string, passphrase: string, network: string): Promise<string> {
  if (!envelopeText || envelopeText.length > MAX_VPACK_ENVELOPE_BYTES) throw new Error('The sealed envelope is empty or exceeds the size limit.');
  let value: unknown;
  try { value = JSON.parse(envelopeText); } catch { throw new Error('The sealed envelope JSON is malformed.'); }
  if (!record(value) || value.format !== 'universe-vpack-backup' || value.version !== 1 || !record(value.kdf) || !record(value.cipher)
    || value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256' || value.kdf.iterations !== ITERATIONS
    || value.cipher.name !== 'AES-GCM' || value.cipher.tagLength !== 128 || typeof value.kdf.salt !== 'string'
    || typeof value.cipher.nonce !== 'string' || typeof value.ciphertext !== 'string'
    || Object.keys(value).sort().join(',') !== 'cipher,ciphertext,format,kdf,version'
    || Object.keys(value.kdf).sort().join(',') !== 'hash,iterations,name,salt'
    || Object.keys(value.cipher).sort().join(',') !== 'name,nonce,tagLength') throw new Error('The envelope version or encryption parameters are unsupported.');
  let salt: Uint8Array;
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;
  try { salt = base64.decode(value.kdf.salt); nonce = base64.decode(value.cipher.nonce); ciphertext = base64.decode(value.ciphertext); }
  catch { throw new Error('The sealed envelope encoding is malformed.'); }
  if (salt.length !== 16 || nonce.length !== 12 || ciphertext.length < 17 || ciphertext.length > MAX_VPACK_BYTES + 16) throw new Error('The sealed envelope has invalid field lengths.');
  const metadata = header(value.kdf.salt, value.cipher.nonce);
  const key = await keyFor(passphrase, salt);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource,
      additionalData: encoder.encode(JSON.stringify(metadata)), tagLength: 128 }, key, ciphertext as BufferSource));
  } catch { throw new Error('The passphrase is incorrect or the sealed envelope was altered.'); }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    validateBackupPackage(text, network);
    return text;
  } finally { plaintext.fill(0); }
}
