import { createHash, randomBytes } from 'crypto';
import { TimestampEvidenceError } from './opentimestamps-errors';

/**
 * The OpenTimestamps timestamp tree, read and written as bytes.
 *
 * `opentimestamps-proof.ts` evaluates a proof and never builds one. Talking to
 * a calendar needs the other half: a calendar answers a submitted digest with a
 * serialized timestamp for that digest, and answers an upgrade request with a
 * serialized timestamp for a commitment. Both have to be grafted into a proof
 * that the existing verifier can then evaluate, so this module parses the
 * timestamp wire format into a tree and writes a tree back out, byte for
 * byte the way python-opentimestamps core/timestamp.py does.
 *
 * Wire format: a timestamp is a list of items. Every item but the last is
 * prefixed with 0xff. An item is either an attestation (0x00, an eight byte
 * tag, then the payload as varbytes) or an operation (its tag and argument)
 * followed by the timestamp of the operation's result.
 */
export const OTS_MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');
export const ATTESTATION_BITCOIN = '0588960d73d71901';
export const ATTESTATION_PENDING = '83dfe30d2ef90c8e';
const HASH_TAGS: Record<number, 'sha1' | 'ripemd160' | 'sha256' | 'keccak256'> = { 0x02: 'sha1', 0x03: 'ripemd160', 0x08: 'sha256', 0x67: 'keccak256' };
const LIMITS = { bytes: 1024 * 1024, depth: 256, operations: 10000, message: 4096, attestations: 1024 } as const;

export type OtsAttestation =
  | { kind: 'bitcoin'; height: number }
  | { kind: 'pending'; uri: string }
  | { kind: 'unknown'; tag: string; payload: Buffer };

export interface OtsOperation {
  tag: number;
  argument?: Buffer;
  result: OtsTimestamp;
}

export interface OtsTimestamp {
  message: Buffer;
  attestations: OtsAttestation[];
  operations: OtsOperation[];
}

function invalid(message: string): never {
  throw new TimestampEvidenceError('invalid-proof', message, 400);
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}
  get remaining(): number { return this.bytes.length - this.offset; }
  read(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {invalid('The timestamp is truncated.');}
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(value);
  }
  byte(): number { return this.read(1)[0]; }
  uint(maximum = Number.MAX_SAFE_INTEGER): number {
    let value = 0n;
    for (let index = 0; index < 8; index++) {
      const byte = this.byte();
      value |= BigInt(byte & 0x7f) << BigInt(index * 7);
      if (value > BigInt(maximum)) {invalid('A timestamp integer exceeds its allowed range.');}
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) {invalid('A timestamp integer is not minimally encoded.');}
        return Number(value);
      }
    }
    return invalid('A timestamp integer exceeds its allowed length.');
  }
  variable(maximum: number, minimum = 0): Buffer {
    const length = this.uint(maximum);
    if (length < minimum) {invalid('A timestamp operation argument is empty.');}
    return this.read(length);
  }
  end(): void { if (this.remaining !== 0) {invalid('The timestamp contains trailing data.');} }
}

function writeUint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {throw new TimestampEvidenceError('invalid-proof', 'A timestamp integer is negative.', 400);}
  const out: number[] = [];
  let rest = BigInt(value);
  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    out.push(rest > 0n ? byte | 0x80 : byte);
  } while (rest > 0n);
  return Buffer.from(out);
}

function writeVariable(bytes: Buffer): Buffer {
  return Buffer.concat([writeUint(bytes.length), bytes]);
}

/** Apply one operation to a message exactly as the verifier does. */
export function applyOperation(tag: number, message: Buffer, argument?: Buffer): Buffer {
  const algorithm = HASH_TAGS[tag];
  let next: Buffer;
  if (algorithm) {
    if (algorithm === 'keccak256') {
      // Kept out of the calendar path: no calendar emits keccak and the
      // verifier already carries that dependency.
      throw new TimestampEvidenceError('unsupported-operation', 'keccak256 is not supported in calendar timestamps.', 400);
    }
    next = createHash(algorithm).update(message).digest();
  } else if (tag === 0xf0 || tag === 0xf1) {
    if (!argument || !argument.length) {invalid('A timestamp append or prepend has no argument.');}
    if (message.length + argument.length > LIMITS.message) {invalid('A timestamp operation result exceeds 4096 bytes.');}
    next = Buffer.concat(tag === 0xf0 ? [message, argument] : [argument, message]);
  } else if (tag === 0xf2) {
    next = Buffer.from(message).reverse();
  } else if (tag === 0xf3) {
    if (message.length * 2 > LIMITS.message) {invalid('A timestamp hexlify result exceeds 4096 bytes.');}
    next = Buffer.from(message.toString('hex'), 'ascii');
  } else {
    throw new TimestampEvidenceError('unsupported-operation', `The timestamp operation 0x${tag.toString(16)} is unsupported.`, 400);
  }
  if (!next.length || next.length > LIMITS.message) {invalid('A timestamp operation result has an invalid length.');}
  return next;
}

/**
 * Parse a serialized timestamp for `message`. The bytes must contain exactly
 * one timestamp; anything after it is an error.
 */
export function parseTimestamp(bytes: Buffer, message: Buffer): OtsTimestamp {
  if (bytes.length > LIMITS.bytes) {invalid('The timestamp is oversized.');}
  const reader = new Reader(bytes);
  const counters = { operations: 0, attestations: 0 };
  const timestamp = parseNode(reader, message, 0, counters);
  reader.end();
  return timestamp;
}

function parseNode(reader: Reader, message: Buffer, depth: number, counters: { operations: number; attestations: number }): OtsTimestamp {
  if (depth >= LIMITS.depth) {invalid('The timestamp exceeds the operation depth limit.');}
  const node: OtsTimestamp = { message, attestations: [], operations: [] };
  const item = (tag: number): void => {
    if (tag === 0x00) {
      if (++counters.attestations > LIMITS.attestations) {invalid('The timestamp has too many attestations.');}
      const attestationTag = reader.read(8).toString('hex');
      const payload = new Reader(reader.variable(8192));
      if (attestationTag === ATTESTATION_BITCOIN) {
        const height = payload.uint(0x7fffffff);
        payload.end();
        node.attestations.push({ kind: 'bitcoin', height });
      } else if (attestationTag === ATTESTATION_PENDING) {
        const uriBytes = payload.variable(1000);
        if ([...uriBytes].some(byte => !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/:'.includes(String.fromCharCode(byte)))) {invalid('The pending calendar URI is malformed.');}
        payload.end();
        node.attestations.push({ kind: 'pending', uri: uriBytes.toString('ascii') });
      } else {
        node.attestations.push({ kind: 'unknown', tag: attestationTag, payload: payload.read(payload.remaining) });
      }
      return;
    }
    if (++counters.operations > LIMITS.operations) {invalid('The timestamp has too many operations.');}
    const argument = tag === 0xf0 || tag === 0xf1 ? reader.variable(LIMITS.message, 1) : undefined;
    const next = applyOperation(tag, message, argument);
    node.operations.push({ tag, argument, result: parseNode(reader, next, depth + 1, counters) });
  };
  let tag = reader.byte();
  while (tag === 0xff) { item(reader.byte()); tag = reader.byte(); }
  item(tag);
  return node;
}

function serializeAttestation(attestation: OtsAttestation): Buffer {
  if (attestation.kind === 'bitcoin') {
    return Buffer.concat([Buffer.from([0x00]), Buffer.from(ATTESTATION_BITCOIN, 'hex'), writeVariable(writeUint(attestation.height))]);
  }
  if (attestation.kind === 'pending') {
    return Buffer.concat([Buffer.from([0x00]), Buffer.from(ATTESTATION_PENDING, 'hex'), writeVariable(writeVariable(Buffer.from(attestation.uri, 'ascii')))]);
  }
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(attestation.tag, 'hex'), writeVariable(attestation.payload)]);
}

/** Serialize a timestamp tree; the inverse of parseTimestamp. */
export function serializeTimestamp(node: OtsTimestamp): Buffer {
  const items: Buffer[] = [
    ...node.attestations.map(serializeAttestation),
    ...node.operations.map(operation => Buffer.concat([
      Buffer.from([operation.tag]),
      operation.argument ? writeVariable(operation.argument) : Buffer.alloc(0),
      serializeTimestamp(operation.result),
    ])),
  ];
  if (!items.length) {invalid('A timestamp node has neither attestations nor operations.');}
  const parts: Buffer[] = [];
  items.forEach((item, index) => {
    if (index < items.length - 1) {parts.push(Buffer.from([0xff]));}
    parts.push(item);
  });
  return Buffer.concat(parts);
}

/** Build a complete detached .ots file for a sha256 digest. */
export function serializeDetachedProof(digest: Buffer, timestamp: OtsTimestamp): Buffer {
  if (digest.length !== 32) {invalid('A detached sha256 proof needs a 32-byte digest.');}
  return Buffer.concat([OTS_MAGIC, Buffer.from([0x01, 0x08]), digest, serializeTimestamp(timestamp)]);
}

/** Split a detached .ots file into its digest and timestamp tree. */
export function parseDetachedProofTree(bytes: Buffer): { algorithm: 'sha1' | 'ripemd160' | 'sha256' | 'keccak256'; digest: Buffer; timestamp: OtsTimestamp } {
  if (bytes.length > LIMITS.bytes) {invalid('The .ots proof is oversized.');}
  const reader = new Reader(bytes);
  if (!reader.read(OTS_MAGIC.length).equals(OTS_MAGIC)) {invalid('The .ots detached-file header is invalid.');}
  if (reader.byte() !== 1) {invalid('Only detached .ots format version 1 is supported.');}
  const algorithm = HASH_TAGS[reader.byte()];
  if (!algorithm) {throw new TimestampEvidenceError('unsupported-operation', 'The .ots file hash algorithm is unsupported.', 400);}
  const digest = reader.read(algorithm === 'sha256' || algorithm === 'keccak256' ? 32 : 20);
  const rest = reader.read(reader.remaining);
  return { algorithm, digest, timestamp: parseTimestamp(rest, digest) };
}

/** Merge the items of `addition` into `target`; both must commit to one message. */
export function mergeTimestamps(target: OtsTimestamp, addition: OtsTimestamp): OtsTimestamp {
  if (!target.message.equals(addition.message)) {invalid('Timestamps for different messages cannot be merged.');}
  for (const attestation of addition.attestations) {
    if (!target.attestations.some(existing => JSON.stringify(existing) === JSON.stringify(attestation))) {target.attestations.push(attestation);}
  }
  for (const operation of addition.operations) {
    const existing = target.operations.find(candidate => candidate.tag === operation.tag && ((!candidate.argument && !operation.argument) || (candidate.argument && operation.argument && candidate.argument.equals(operation.argument))));
    if (existing) {mergeTimestamps(existing.result, operation.result);} else {target.operations.push(operation);}
  }
  return target;
}

/**
 * Every node of the tree paired with its message. Used to find pending
 * attestations and the commitments a calendar can be asked about.
 */
export function walkTimestamp(node: OtsTimestamp, visit: (node: OtsTimestamp) => void): void {
  visit(node);
  for (const operation of node.operations) {walkTimestamp(operation.result, visit);}
}

/**
 * The nonce step every OpenTimestamps client adds before submitting: the file
 * digest is appended with 16 random bytes and hashed, so a calendar never
 * learns the digest itself and identical files produce distinct submissions.
 */
export function nonceCommitment(digest: Buffer, nonce: Buffer = randomBytes(16)): { nonce: Buffer; commitment: Buffer; timestamp: OtsTimestamp } {
  if (digest.length !== 32) {invalid('A sha256 digest of 32 bytes is required.');}
  if (nonce.length !== 16) {invalid('The nonce must be 16 bytes.');}
  const appended = applyOperation(0xf0, digest, nonce);
  const commitment = applyOperation(0x08, appended);
  const leaf: OtsTimestamp = { message: commitment, attestations: [], operations: [] };
  const timestamp: OtsTimestamp = {
    message: digest,
    attestations: [],
    operations: [{ tag: 0xf0, argument: nonce, result: { message: appended, attestations: [], operations: [{ tag: 0x08, result: leaf }] } }],
  };
  return { nonce, commitment, timestamp };
}
