import * as crypto from 'crypto';
const validationKey = crypto.generateKeyPairSync('x25519').privateKey;
/** RFC9458 sections3.1/3.2. Discovery profile: DHKEM(X25519,HKDF-SHA256), HKDF-SHA256, AES-GCM/ChaCha20Poly1305. */
export interface OhttpDirectoryKey { key_id: number; kem_id: number; suites: Array<{ kdf_id: number; aead_id: number }>; }
export function parseOhttpDirectoryKeys(body: Buffer): OhttpDirectoryKey[] {
  if (!body.length || body.length > 8192) throw new Error('invalid_key_collection_size');
  const keys: OhttpDirectoryKey[] = [];
  let offset = 0;
  while (offset < body.length) {
    if (offset + 2 > body.length) throw new Error('truncated_key_collection');
    const length = body.readUInt16BE(offset); offset += 2;
    const end = offset + length;
    if (length < 41 || end > body.length) throw new Error('truncated_key_configuration');
    const keyId = body[offset++]; const kemId = body.readUInt16BE(offset); offset += 2;
    if (kemId !== 0x20) throw new Error('unsupported_kem');
    const publicKey = body.subarray(offset, offset + 32); offset += 32;
    try { crypto.diffieHellman({privateKey:validationKey,publicKey:crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),publicKey]),format:'der',type:'spki'})}); } catch {throw new Error('invalid_public_key');}
    const suiteLength = body.readUInt16BE(offset); offset += 2;
    if (!suiteLength || suiteLength % 4 || offset + suiteLength !== end) throw new Error('invalid_suite_length');
    const suites: OhttpDirectoryKey['suites'] = [];
    while (offset < end) {
      const kdfId = body.readUInt16BE(offset); const aeadId = body.readUInt16BE(offset + 2); offset += 4;
      if (kdfId === 1 && [1,2,3].includes(aeadId)) suites.push({ kdf_id: kdfId, aead_id: aeadId });
    }
    if (!suites.length || keys.some(key => key.key_id === keyId)) throw new Error('unsupported_or_duplicate_key');
    keys.push({ key_id: keyId, kem_id: kemId, suites });
    if (keys.length > 32) throw new Error('too_many_keys');
  }
  return keys;
}
