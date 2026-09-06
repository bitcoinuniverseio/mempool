import { createHash, timingSafeEqual } from 'crypto';
import * as CryptoJS from 'crypto-js';
import { Block } from 'bitcoinjs-lib';
import { TimestampEvidenceError } from './opentimestamps-errors';
import { TimestampVerificationResult } from './opentimestamps.models';

// Wire format and limits: opentimestamps/python-opentimestamps core/{timestamp,op,notary,serialize}.py.
// Operations are evaluated directly; this verifier never follows calendar URLs.
const MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
export const PROOF_LIMITS = { bytes: 1024 * 1024, depth: 256, operations: 10000, message: 4096, attestations: 1024, bitcoinHeights: 16 } as const;
const GENESIS: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};
type HashAlgorithm = 'sha1' | 'ripemd160' | 'sha256' | 'keccak256';
const HASHES: Record<number, { name: HashAlgorithm; length: number }> = {
  0x02: { name: 'sha1', length: 20 }, 0x03: { name: 'ripemd160', length: 20 },
  0x08: { name: 'sha256', length: 32 }, 0x67: { name: 'keccak256', length: 32 },
};
type Attestation = { kind: 'bitcoin'; height: number; message: Buffer }
  | { kind: 'pending'; uri: string } | { kind: 'unknown'; tag: string };
export interface ParsedTimestampProof {
  digest: Buffer;
  algorithm: HashAlgorithm;
  operationCount: number;
  attestations: Attestation[];
}
export interface TimestampProofRequest { proof?: string; ots_proof?: string; digest?: string; network?: string; }
export interface TimestampBitcoinReader {
  $getBlockHash(height: number): Promise<string>;
  $getBlockHeader(hash: string): Promise<string>;
}

function invalid(message: string): never {
  throw new TimestampEvidenceError('invalid-proof', message, 400);
}
class Cursor {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}
  read(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.bytes.length - this.offset) {invalid('The .ots proof is truncated.');}
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  byte(): number { return this.read(1)[0]; }
  uint(maximum = Number.MAX_SAFE_INTEGER): number {
    let value = 0n;
    for (let index = 0; index < 8; index++) {
      const byte = this.byte();
      value |= BigInt(byte & 0x7f) << BigInt(index * 7);
      if (value > BigInt(maximum)) {invalid('The .ots integer exceeds its allowed range.');}
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) {invalid('The .ots integer is not minimally encoded.');}
        return Number(value);
      }
    }
    return invalid('The .ots integer exceeds its allowed length.');
  }
  variable(maximum: number, minimum = 0): Buffer {
    const length = this.uint(maximum);
    if (length < minimum) {invalid('The .ots operation argument is empty.');}
    return this.read(length);
  }
  end(): void { if (this.offset !== this.bytes.length) {invalid('The .ots proof contains trailing data.');} }
}

export function parseDetachedProof(encoded: string): ParsedTimestampProof {
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(PROOF_LIMITS.bytes / 3) * 8) {invalid('A bounded base64 .ots proof is required.');}
  const base64 = encoded.replace(/[ \t\r\n]/g, '');
  if (!base64 || base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {invalid('The .ots proof is not valid base64.');}
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > PROOF_LIMITS.bytes || bytes.toString('base64') !== base64) {invalid('The .ots proof is oversized or malformed base64.');}
  const cursor = new Cursor(bytes);
  if (!cursor.read(MAGIC.length).equals(MAGIC)) {invalid('The .ots detached-file header is invalid.');}
  if (cursor.byte() !== 1) {invalid('Only detached .ots format version 1 is supported.');}
  const hash = HASHES[cursor.byte()];
  if (!hash) {throw new TimestampEvidenceError('unsupported-operation', 'The .ots file hash algorithm is unsupported.', 400);}
  const result: ParsedTimestampProof = { digest: Buffer.from(cursor.read(hash.length)), algorithm: hash.name, operationCount: 0, attestations: [] };

  const timestamp = (message: Buffer, depth: number): void => {
    if (depth >= PROOF_LIMITS.depth) {invalid('The .ots proof exceeds the operation depth limit.');}
    const item = (tag: number): void => {
      if (tag === 0) {
        if (result.attestations.length >= PROOF_LIMITS.attestations) {invalid('The .ots proof has too many attestations.');}
        const attestationTag = cursor.read(8).toString('hex');
        const payload = new Cursor(cursor.variable(8192));
        if (attestationTag === '0588960d73d71901') {
          result.attestations.push({ kind: 'bitcoin', height: payload.uint(0x7fffffff), message: Buffer.from(message) });
          payload.end();
        } else if (attestationTag === '83dfe30d2ef90c8e') {
          const uriBytes = payload.variable(1000);
          if ([...uriBytes].some(byte => !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/:'.includes(String.fromCharCode(byte)))) {invalid('The pending calendar URI is malformed.');}
          payload.end();
          result.attestations.push({ kind: 'pending', uri: uriBytes.toString('ascii') });
        } else {
          result.attestations.push({ kind: 'unknown', tag: attestationTag });
        }
        return;
      }
      if (++result.operationCount > PROOF_LIMITS.operations) {invalid('The .ots proof has too many operations.');}
      let next: Buffer;
      if (HASHES[tag]) {
        const algorithm = HASHES[tag].name;
        next = algorithm === 'keccak256'
          ? Buffer.from(CryptoJS.SHA3(CryptoJS.enc.Hex.parse(message.toString('hex')), { outputLength: 256 }).toString(), 'hex')
          : createHash(algorithm).update(message).digest();
      } else if (tag === 0xf0 || tag === 0xf1) {
        const argument = cursor.variable(PROOF_LIMITS.message, 1);
        if (message.length + argument.length > PROOF_LIMITS.message) {invalid('The .ots operation result exceeds 4096 bytes.');}
        next = Buffer.concat(tag === 0xf0 ? [message, argument] : [argument, message]);
      } else if (tag === 0xf2) {
        next = Buffer.from(message).reverse();
      } else if (tag === 0xf3) {
        if (message.length * 2 > PROOF_LIMITS.message) {invalid('The .ots hexlify result exceeds 4096 bytes.');}
        next = Buffer.from(message.toString('hex'), 'ascii');
      } else {
        throw new TimestampEvidenceError('unsupported-operation', `The .ots operation 0x${tag.toString(16)} is unsupported.`, 400);
      }
      if (!next.length || next.length > PROOF_LIMITS.message) {invalid('The .ots operation result has an invalid length.');}
      timestamp(next, depth + 1);
    };
    let tag = cursor.byte();
    while (tag === 0xff) { item(cursor.byte()); tag = cursor.byte(); }
    item(tag);
  };
  timestamp(result.digest, 0);
  cursor.end();
  return result;
}

/** Verify only against the configured owned reader; no authority comes from proof bytes. @asyncUnsafe */
export async function verifyDetachedProof(request: TimestampProofRequest, reader: TimestampBitcoinReader, network: string): Promise<TimestampVerificationResult> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {throw new TimestampEvidenceError('invalid-input', 'A proof request object is required.', 400);}
  if (request.proof !== undefined && request.ots_proof !== undefined && request.proof !== request.ots_proof) {throw new TimestampEvidenceError('invalid-input', 'The two proof fields disagree.', 400);}
  const proof = request.ots_proof ?? request.proof;
  if (typeof proof !== 'string' || proof.trim().length === 0) {
    throw new TimestampEvidenceError('invalid-input', 'A nonempty .ots proof is required.', 400);
  }
  if (request.network !== undefined && (typeof request.network !== 'string' || !Object.prototype.hasOwnProperty.call(GENESIS, request.network))) {throw new TimestampEvidenceError('invalid-input', 'A supported Bitcoin network is required.', 400);}
  const parsed = parseDetachedProof(proof);
  if (request.digest !== undefined && (typeof request.digest !== 'string' || !new RegExp(`^[0-9a-f]{${parsed.digest.length * 2}}$`, 'i').test(request.digest))) {throw new TimestampEvidenceError('invalid-input', `The ${parsed.algorithm} digest must contain ${parsed.digest.length * 2} hexadecimal characters.`, 400);}
  const result: TimestampVerificationResult = {
    status: 'proof_structure_valid', verified: false,
    digest_matches: request.digest === undefined ? null : timingSafeEqual(Buffer.from(request.digest, 'hex'), parsed.digest),
    file_digest: parsed.digest.toString('hex'), file_hash_algorithm: parsed.algorithm, network,
    calendar_attestations: parsed.attestations.flatMap(attestation => attestation.kind === 'pending' ? [{ calendar_url: attestation.uri, status: 'pending' as const }] : []),
    operation_count: parsed.operationCount, notices: [], errors: [],
  };
  if (result.digest_matches === null) {result.notices.push('No separate file digest was supplied. Only the digest embedded in this proof can be checked for anchoring.');}
  if (!Object.prototype.hasOwnProperty.call(GENESIS, network) || request.network !== undefined && request.network !== network) {
    return { ...result, status: 'network_mismatch', errors: ['The requested network does not match the configured Bitcoin reader.'] };
  }
  if (result.digest_matches === false) {return { ...result, status: 'file_mismatch', errors: ['The supplied digest does not match the detached proof.'] };}
  const bitcoinAttestations = parsed.attestations.filter((attestation): attestation is Extract<Attestation, { kind: 'bitcoin' }> => attestation.kind === 'bitcoin');
  const unknownCount = parsed.attestations.filter(attestation => attestation.kind === 'unknown').length;
  if (unknownCount) {result.notices.push(`${unknownCount} unsupported attestation(s) were not verified.`);}
  if (!bitcoinAttestations.length) {return { ...result, status: result.calendar_attestations.length ? 'pending_calendar_attestation' : 'unsupported_attestation' };}
  if (new Set(bitcoinAttestations.map(attestation => attestation.height)).size > PROOF_LIMITS.bitcoinHeights) {invalid('The .ots proof requests too many Bitcoin block headers.');}

  const deadline = Date.now() + 15000;
  const read = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('header read timeout')), Math.max(1, deadline - Date.now())); timer.unref?.(); }),
      ]);
    } catch {
      throw new TimestampEvidenceError('unavailable-bitcoin-header', 'The owned Bitcoin header reader could not provide current evidence.');
    } finally { if (timer) {clearTimeout(timer);} }
  };
  const checkedHash = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {throw new TimestampEvidenceError('unavailable-bitcoin-header', 'The owned reader returned a malformed Bitcoin block hash.');}
    return value.toLowerCase();
  };
  const genesis = checkedHash(await read(() => reader.$getBlockHash(0)));
  if (genesis !== GENESIS[network]) {return { ...result, status: 'network_mismatch', errors: ['The owned reader genesis does not match the selected Bitcoin network.'] };}
  const headers = new Map<number, { hash: string; block: Block }>();
  for (const attestation of bitcoinAttestations) {
    if (headers.has(attestation.height)) {continue;}
    const hash = checkedHash(await read(() => reader.$getBlockHash(attestation.height)));
    const encodedHeader = await read(() => reader.$getBlockHeader(hash));
    if (typeof encodedHeader !== 'string' || !/^[0-9a-f]{160}$/i.test(encodedHeader.trim())) {throw new TimestampEvidenceError('unavailable-bitcoin-header', 'The owned reader returned a malformed Bitcoin header.');}
    const block = Block.fromHex(encodedHeader.trim());
    if (block.getId() !== hash.toLowerCase()) {throw new TimestampEvidenceError('unavailable-bitcoin-header', 'The owned Bitcoin header does not match its requested block hash.');}
    if (checkedHash(await read(() => reader.$getBlockHash(attestation.height))) !== hash) {return { ...result, status: 'bitcoin_attestation_reorg', errors: ['The active block changed while its attestation was being checked. Retry with current chain evidence.'] };}
    headers.set(attestation.height, { hash: hash.toLowerCase(), block });
  }
  for (const attestation of bitcoinAttestations) {
    const { block } = headers.get(attestation.height)!;
    // bitcoinjs stores merkleRoot in header byte order, matching OTS message bytes.
    if (attestation.message.length !== 32 || !block.merkleRoot?.equals(attestation.message)) {result.errors.push(`The proof commitment does not match the Bitcoin Merkle root at height ${attestation.height}.`);}
  }
  if (result.errors.length) {return { ...result, status: 'bitcoin_attestation_invalid' };}
  const height = Math.min(...headers.keys());
  const earliest = headers.get(height)!;
  return {
    ...result, status: 'bitcoin_attestation_verified', verified: true, attestation_type: 'bitcoin',
    earliest_proven_block_height: height, earliest_proven_time_utc: new Date(earliest.block.timestamp * 1000).toISOString(),
    bitcoin_block_hash: earliest.hash,
  };
}
