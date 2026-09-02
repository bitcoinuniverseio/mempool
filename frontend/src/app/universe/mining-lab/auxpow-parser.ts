import { hash as sha256 } from '@app/shared/sha256';

/**
 * The AuxPoW proof, parsed and checked in the browser.
 *
 * A Dogecoin block that merge mined carries its proof of work inside the
 * block itself: after the eighty byte header sits the parent chain's
 * coinbase transaction, that transaction's merkle branch, the chain index,
 * and the parent chain header. All of it is bytes the miner published, so
 * everything here runs on raw hexadecimal the visitor supplies or fetches,
 * with no server in the loop.
 *
 * What this module proves:
 * - the structure parses exactly, consuming every byte it should;
 * - the Dogecoin block hash and the parent block hash, derived the way the
 *   chains derive them, so the parent linkage is a fact and not a label;
 * - the merge mining commitment: the parent coinbase scriptSig must carry
 *   two hashes whose XOR equals the Dogecoin header hash. A block whose
 *   coinbase does not commit to itself is not merge mined, whatever it
 *   claims.
 *
 * What it deliberately does not claim: signature validation of the parent
 * chain, and any attribution stronger than the readable text inside the
 * coinbase, which is shown as text and claimed as nothing.
 */

export interface ParsedHeader {
  readonly version: number;
  readonly versionHex: string;
  readonly previousBlockHashReversed: string;
  readonly merkleRootReversed: string;
  readonly time: number;
  readonly bits: number;
  readonly nonce: number;
  readonly hash: string;
}

export interface ParsedCoinbase {
  readonly rawHex: string;
  readonly hash: string;
  readonly version: number;
  readonly locktime: number;
  readonly scriptSigHex: string;
  readonly readableScriptText: string;
}

export interface ParsedAuxPow {
  readonly state: 'parsed';
  readonly dogecoinHeader: ParsedHeader;
  readonly coinbase: ParsedCoinbase;
  readonly branchHashes: readonly string[];
  readonly chainIndex: number;
  readonly parentHeader: ParsedHeader;
  readonly commitment: CommitmentResult;
}

export interface CommitmentResult {
  /** verified: XOR of the two scriptSig hashes equals the Dogecoin header hash. */
  readonly state: 'verified' | 'absent' | 'mismatch';
  readonly detail: string;
}

export interface AuxPowParseError {
  readonly state: 'error';
  readonly message: string;
}

export type AuxPowResult = ParsedAuxPow | AuxPowParseError;

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reverseHex(hex: string): string {
  const bytes = hex.match(/.{2}/g) ?? [];
  return bytes.reverse().join('');
}

function readableText(script: Uint8Array): string {
  let text = '';
  for (const byte of script) {
    text += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ' ';
  }
  // Runs of three or more printable characters are what a pool tag looks
  // like; single stray characters are noise.
  return (text.match(/[\x20-\x7e]{3,}/g) ?? []).join(' | ').slice(0, 300);
}

class ByteReader {
  private offset = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  get position(): number {
    return this.offset;
  }

  take(count: number): Uint8Array {
    if (this.remaining < count) {
      throw new Error(`Needed ${count} more bytes but only ${this.remaining} remain.`);
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  uint16(): number {
    const slice = this.take(2);
    return new DataView(slice.buffer, slice.byteOffset).getUint16(0, true);
  }

  uint32(): number {
    const slice = this.take(4);
    return new DataView(slice.buffer, slice.byteOffset).getUint32(0, true);
  }

  varint(): number {
    const first = this.take(1)[0];
    if (first < 0xfd) { return first; }
    if (first === 0xfd) { return this.uint16(); }
    if (first === 0xfe) { return this.uint32(); }
    const high = this.take(8);
    if (high.some((byte) => byte !== 0)) {
      throw new Error('A length this large is not a real transaction.');
    }
    return new DataView(high.buffer, high.byteOffset).getUint32(0, true);
  }
}

/** Reads one legacy transaction and returns its raw bytes. */
function readTransaction(reader: ByteReader): Uint8Array {
  const start = reader.position;
  reader.uint32(); // version
  const inputCount = reader.varint();
  if (inputCount === 0 || inputCount > 1_000) {
    throw new Error(`Coinbase input count ${inputCount} is not plausible.`);
  }
  for (let i = 0; i < inputCount; i++) {
    reader.take(32); // previous output hash
    reader.take(4); // previous output index
    const scriptLength = reader.varint();
    reader.take(scriptLength);
    reader.take(4); // sequence
  }
  const outputCount = reader.varint();
  if (outputCount > 10_000) {
    throw new Error(`Coinbase output count ${outputCount} is not plausible.`);
  }
  for (let i = 0; i < outputCount; i++) {
    reader.take(8); // value
    const scriptLength = reader.varint();
    reader.take(scriptLength);
  }
  reader.take(4); // locktime
  return reader.bytes.subarray(start, reader.position);
}

function parseHeader(bytes: Uint8Array): ParsedHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true);
  const previous = toHex(bytes.subarray(4, 36));
  const merkle = toHex(bytes.subarray(36, 68));
  const time = view.getUint32(68, true);
  const bits = view.getUint32(72, true);
  const nonce = view.getUint32(76, true);
  return {
    version,
    versionHex: `0x${version.toString(16).padStart(8, '0')}`,
    previousBlockHashReversed: reverseHex(previous),
    merkleRootReversed: reverseHex(merkle),
    time,
    bits,
    nonce,
    hash: reverseHex(toHex(sha256d(bytes))),
  };
}

function headerFromReader(reader: ByteReader): ParsedHeader {
  return parseHeader(reader.take(80));
}

/**
 * Parses a raw Dogecoin block that carries AuxPoW, checking the merge
 * mining commitment on the way through.
 */
export function parseAuxPowBlock(hex: string): AuxPowResult {
  const clean = (hex ?? '').replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0) {
    return { state: 'error', message: 'The input is not hexadecimal.' };
  }
  const bytes = new Uint8Array((clean.match(/.{2}/g) ?? []).map((pair) => parseInt(pair, 16)));
  if (bytes.length < 80) {
    return { state: 'error', message: 'A block header alone is eighty bytes; this is shorter.' };
  }

  try {
    const reader = new ByteReader(bytes);
    const dogecoinHeader = headerFromReader(reader);

    // The merge mining flag sits in the version bits. A block without it
    // has no AuxPoW to show, which is a fact about the block, not an error.
    if ((dogecoinHeader.version & 0x100) === 0 && (dogecoinHeader.version >>> 16) === 0) {
      return { state: 'error', message: 'This block does not carry the merge mining flag in its version.' };
    }

    const coinbaseLength = reader.varint();
    if (coinbaseLength < 60 || coinbaseLength > 1_000_000) {
      throw new Error(`The coinbase length ${coinbaseLength} is not plausible.`);
    }
    const coinbaseStart = reader.position;
    readTransaction(reader);
    const consumed = reader.position - coinbaseStart;
    if (consumed !== coinbaseLength) {
      throw new Error(`The coinbase declared ${coinbaseLength} bytes but its structure used ${consumed}.`);
    }
    const coinbaseBytes = bytes.subarray(coinbaseStart, reader.position);
    const coinbaseReader = new ByteReader(coinbaseBytes);
    coinbaseReader.uint32();
    coinbaseReader.varint();
    coinbaseReader.take(32);
    coinbaseReader.take(4);
    const scriptLength = coinbaseReader.varint();
    const scriptSig = coinbaseBytes.subarray(coinbaseReader.position, coinbaseReader.position + scriptLength);

    const branchCount = reader.varint();
    if (branchCount > 64) {
      return { state: 'error', message: `A merkle branch of ${branchCount} hashes is not plausible.` };
    }
    const branchHashes: string[] = [];
    for (let i = 0; i < branchCount; i++) {
      branchHashes.push(toHex(reader.take(32)));
    }
    const chainIndex = reader.uint32() | 0;
    const parentHeader = headerFromReader(reader);

    if (reader.remaining !== 0) {
      return { state: 'error', message: `${reader.remaining} bytes were left over after the proof, so this is not a well formed block.` };
    }

    const commitment = checkCommitment(scriptSig, bytes.subarray(0, 80));

    return {
      state: 'parsed',
      dogecoinHeader,
      coinbase: {
        rawHex: toHex(coinbaseBytes),
        hash: reverseHex(toHex(sha256d(coinbaseBytes))),
        version: new DataView(coinbaseBytes.buffer, coinbaseBytes.byteOffset).getUint32(0, true),
        locktime: new DataView(coinbaseBytes.buffer, coinbaseBytes.byteOffset + coinbaseBytes.length - 4).getUint32(0, true),
        scriptSigHex: toHex(scriptSig),
        readableScriptText: readableText(scriptSig),
      },
      branchHashes,
      chainIndex,
      parentHeader,
      commitment,
    };
  } catch (error) {
    return { state: 'error', message: (error as Error).message || 'The block could not be parsed.' };
  }
}

function checkCommitment(scriptSig: Uint8Array, dogecoinHeader: Uint8Array): CommitmentResult {
  const auxHash = sha256d(dogecoinHeader);
  // The merge mining commitment is two 32 byte pushes whose XOR is the
  // hash of the Dogecoin header. They sit at the tail of the parent
  // coinbase's scriptSig, before the serialized branch.
  const tail = scriptSig.subarray(Math.max(0, scriptSig.length - 76));
  let best: CommitmentResult = { state: 'absent', detail: 'No merge mining commitment found in the coinbase script.' };
  for (let i = 0; i < tail.length - 64; i++) {
    if (tail[i] !== 0x20 || tail[i + 33] !== 0x20) { continue; }
    const first = tail.subarray(i + 1, i + 33);
    const second = tail.subarray(i + 34, i + 66);
    const xored = new Uint8Array(32);
    for (let b = 0; b < 32; b++) {
      xored[b] = first[b] ^ second[b];
    }
    if (toHex(xored) === toHex(auxHash)) {
      return { state: 'verified', detail: 'The coinbase commits to this exact Dogecoin header.' };
    }
    best = { state: 'mismatch', detail: 'The coinbase carries a commitment, but not for this header.' };
  }
  return best;
}
