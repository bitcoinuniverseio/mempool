import { createHash } from 'crypto';
import * as secp256k1 from 'tiny-secp256k1';

// Public-data verification only. BIP327 v1.0.4, algorithms KeyAgg, NonceAgg,
// GetSessionValues, PartialSigVerifyInternal and PartialSigAgg (no tweaks).
// https://github.com/bitcoin/bips/blob/ccb5415095c5b096abc9bd72384a6db4b7c34bce/bip-0327.mediawiki
export const CURVE_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
type Point = Uint8Array | null;
const GENERATOR = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
const integer = (bytes: Uint8Array): bigint => BigInt('0x' + Buffer.from(bytes).toString('hex'));
const scalarBytes = (value: bigint): Buffer => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
const modulo = (value: bigint): bigint => ((value % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER;
const equal = (a: Point, b: Point): boolean => a === null || b === null ? a === b : Buffer.from(a).equals(b);
const add = (a: Point, b: Point): Point => a === null ? b : b === null ? a : secp256k1.pointAdd(a, b, true);
const multiply = (point: Point, value: bigint): Point => point === null || modulo(value) === 0n
  ? null : secp256k1.pointMultiply(point, scalarBytes(modulo(value)), true);
const negate = (point: Point): Point => {
  if (point === null) return null;
  const negated = Buffer.from(point);
  negated[0] ^= 1;
  return negated;
};
const taggedHash = (tag: string, ...parts: Uint8Array[]): bigint => {
  const prefix = createHash('sha256').update(tag).digest();
  const digest = createHash('sha256').update(prefix).update(prefix);
  for (const part of parts) digest.update(part);
  return integer(digest.digest());
};
function point(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== 33 || !secp256k1.isPointCompressed(bytes)) throw new Error('Invalid compressed secp256k1 point.');
  return bytes;
}
function boundedList(values: readonly unknown[]): void {
  if (values.length < 1 || values.length > 1000) throw new Error('Expected between 1 and 1000 contributions.');
}
function partialScalar(bytes: Uint8Array): bigint {
  if (bytes.length !== 32) throw new Error('A partial signature must contain 32 bytes.');
  const value = integer(bytes);
  if (value >= CURVE_ORDER) throw new Error('Partial signature scalar exceeds the curve order.');
  return value;
}

export interface KeyAggregation {
  point: Uint8Array;
  publicKey: Uint8Array;
  participants: Uint8Array[];
  coefficients: bigint[];
}

export function aggregateKeys(keys: readonly Uint8Array[]): KeyAggregation {
  boundedList(keys);
  const participants = keys.map(key => point(Buffer.from(key)));
  const keyList = Buffer.concat(participants);
  const secondKey = participants.find(key => !equal(key, participants[0])) ?? Buffer.alloc(33);
  const listHash = scalarBytes(taggedHash('KeyAgg list', keyList));
  const coefficients = participants.map(key => equal(key, secondKey)
    ? 1n : taggedHash('KeyAgg coefficient', listHash, key) % CURVE_ORDER);
  const aggregate = participants.reduce<Point>((sum, key, index) => add(sum, multiply(key, coefficients[index])), null);
  if (aggregate === null) throw new Error('The aggregate public key is the point at infinity.');
  return { point: aggregate, publicKey: aggregate.slice(1), participants, coefficients };
}

export function aggregateNonces(nonces: readonly Uint8Array[]): Uint8Array {
  boundedList(nonces);
  let first: Point = null;
  let second: Point = null;
  for (const nonce of nonces) {
    if (nonce.length !== 66) throw new Error('A public nonce must contain two compressed points (66 bytes).');
    first = add(first, point(nonce.slice(0, 33)));
    second = add(second, point(nonce.slice(33)));
  }
  // Infinity is forbidden in an individual public nonce, but BIP327 explicitly
  // permits it in either aggregate half, encoded as 33 zero bytes.
  return Buffer.concat([first ?? Buffer.alloc(33), second ?? Buffer.alloc(33)]);
}

export interface PublicSession {
  keys: KeyAggregation;
  nonces: Uint8Array[];
  aggregateNonce: Uint8Array;
  nonceCoefficient: bigint;
  finalNonce: Uint8Array;
  challenge: bigint;
}

export function publicSession(keys: KeyAggregation, nonces: readonly Uint8Array[], message: Uint8Array): PublicSession {
  if (nonces.length !== keys.participants.length) throw new Error('Every participant must have one public nonce in the same order.');
  const copiedNonces = nonces.map(nonce => Buffer.from(nonce));
  const aggregateNonce = aggregateNonces(copiedNonces);
  const nonceCoefficient = taggedHash('MuSig/noncecoef', aggregateNonce, keys.publicKey, message) % CURVE_ORDER;
  const aggregatePoint = (bytes: Uint8Array): Point => Buffer.from(bytes).equals(Buffer.alloc(33)) ? null : point(bytes);
  const effectiveNonce = add(aggregatePoint(aggregateNonce.slice(0, 33)),
    multiply(aggregatePoint(aggregateNonce.slice(33)), nonceCoefficient));
  // The generator substitution is part of BIP327's public session algorithm.
  // Full-session callers must still verify the final BIP340 signature.
  const finalNonce = effectiveNonce ?? GENERATOR;
  const challenge = taggedHash('BIP0340/challenge', finalNonce.slice(1), keys.publicKey, message) % CURVE_ORDER;
  return { keys, nonces: copiedNonces, aggregateNonce, nonceCoefficient, finalNonce, challenge };
}

export function verifyPartial(session: PublicSession, signerIndex: number, signature: Uint8Array): boolean {
  if (!Number.isInteger(signerIndex) || signerIndex < 0 || signerIndex >= session.keys.participants.length) {
    throw new Error('Invalid participant index.');
  }
  if (signature.length !== 32 || integer(signature) >= CURVE_ORDER) return false;
  const nonce = session.nonces[signerIndex];
  const effectiveNonce = add(point(nonce.slice(0, 33)), multiply(point(nonce.slice(33)), session.nonceCoefficient));
  const signedNonce = session.finalNonce[0] === 2 ? effectiveNonce : negate(effectiveNonce);
  const keySign = session.keys.point[0] === 2 ? 1n : -1n;
  const keyTerm = multiply(session.keys.participants[signerIndex],
    session.challenge * session.keys.coefficients[signerIndex] * keySign);
  return equal(multiply(GENERATOR, integer(signature)), add(signedNonce, keyTerm));
}

export function aggregatePartials(session: PublicSession, signatures: readonly Uint8Array[]): Uint8Array {
  if (signatures.length !== session.keys.participants.length) throw new Error('Every participant must have one partial signature.');
  const sum = signatures.reduce((total, signature) => modulo(total + partialScalar(signature)), 0n);
  return Buffer.concat([session.finalNonce.slice(1), scalarBytes(sum)]);
}
