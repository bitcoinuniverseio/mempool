import { createHash } from 'crypto';

const digest = (bytes: Buffer): Buffer => createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();
const display = (bytes: Buffer): string => Buffer.from(bytes).reverse().toString('hex');

/** Strict bounded Bitcoin merkleblock decoding; this alone does not establish chain membership. */
export function decodeMerkleProof(hex: string) {
  if (typeof hex !== 'string' || hex.length > 1_200_000 || !/^(?:[0-9a-f]{2})+$/i.test(hex)) throw Error('Invalid proof bytes');
  const bytes = Buffer.from(hex, 'hex');
  let cursor = 0;
  const take = (length: number) => {
    if (cursor + length > bytes.length) throw Error('Truncated proof');
    const value = bytes.subarray(cursor, cursor += length); return value;
  };
  const compact = () => {
    const prefix = take(1)[0];
    if (prefix < 253) return prefix;
    if (prefix === 255) throw Error('Oversized count');
    const number = prefix === 253 ? take(2).readUInt16LE() : take(4).readUInt32LE();
    if (number < (prefix === 253 ? 253 : 65536)) throw Error('Noncanonical count');
    return number;
  };
  const header = take(80), total = take(4).readUInt32LE();
  if (total < 1 || total > Math.floor(4_000_000 / (4 * 60))) throw Error('Invalid transaction count');
  const count = compact();
  if (!count || count > total) throw Error('Invalid hash count');
  const hashes: Buffer[] = [];
  for (let index = 0; index < count; index++) hashes.push(take(32));
  const flagCount = compact();
  let maximumNodes = 0; for (let width = total; ; width = Math.ceil(width / 2)) { maximumNodes += width; if (width === 1) break; }
  if (!flagCount || flagCount * 8 < count || flagCount > Math.ceil(maximumNodes / 8)) throw Error('Invalid flags');
  const flags = take(flagCount);
  if (cursor !== bytes.length) throw Error('Trailing proof bytes');
  let bit = 0, usedHashes = 0;
  const matches: Array<{ txid: string; index: number }> = [];
  const width = (height: number) => Math.ceil(total / 2 ** height);
  const visit = (height: number, position: number): Buffer => {
    if (bit >= flags.length * 8) throw Error('Missing tree flag');
    const matched = (flags[Math.floor(bit / 8)] >> (bit++ % 8)) & 1;
    if (!height || !matched) {
      if (usedHashes === hashes.length) throw Error('Missing tree hash');
      const value = hashes[usedHashes++];
      if (!height && matched) matches.push({ txid: display(value), index: position });
      return value;
    }
    const left = visit(height - 1, position * 2);
    let right = left;
    if (position * 2 + 1 < width(height - 1)) {
      right = visit(height - 1, position * 2 + 1);
      if (left.equals(right)) throw Error('Mutated Merkle tree');
    }
    return digest(Buffer.concat([left, right]));
  };
  let height = 0;
  while (width(height) > 1) height++;
  const root = visit(height, 0);
  if (usedHashes !== count || Math.ceil(bit / 8) !== flags.length || !root.equals(header.subarray(36, 68))) throw Error('Merkle commitment mismatch');
  // Core ignores unused high bits in the final byte. Preserve that distinction
  // from unused bytes, which are rejected above.
  let nonzeroPadding = false;
  for (; bit < flags.length * 8; bit++) nonzeroPadding ||= !!((flags[Math.floor(bit / 8)] >> (bit % 8)) & 1);
  return { blockHash: display(digest(header)), headerHex: header.toString('hex'), merkleRoot: display(root), hashes: hashes.map(display), flags: flags.toString('hex'), matches, transactionCount: total, nonzeroPadding };
}
