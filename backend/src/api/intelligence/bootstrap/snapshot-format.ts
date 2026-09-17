import { createHash, Hash } from 'crypto';

/**
 * Streaming decoder for Bitcoin Core `dumptxoutset` files and the
 * `hash_serialized_3` commitment Core computes over the coins they carry.
 *
 * Layout (Core 28.x/29.x, src/node/utxo_snapshot.h SnapshotMetadata v2):
 *   'utxo' 0xff | u16 LE version (2) | 4 byte network magic |
 *   32 byte base block hash (internal byte order) | u64 LE coins count |
 *   then, per transaction: 32 byte txid, CompactSize coin count, and per coin
 *   CompactSize vout, VARINT((height << 1) | coinbase), VARINT(compressed
 *   amount), compressed script (src/compressor.h).
 * Version 1 of the versioned header never shipped in a release and is refused.
 *
 * Layout (Core 26.x/27.x, no magic): 32 byte base block hash | u64 LE coins
 * count | per coin: 32 byte txid, u32 LE vout, the same coin encoding.
 *
 * The commitment is SHA256d over, for every coin in cursor order, the
 * outpoint (txid, u32 LE vout), u32 LE ((height << 1) | coinbase) and the
 * standard CTxOut (i64 LE amount, CompactSize script length, script), which is
 * kernel/coinstats.cpp TxOutSer. Core hashes its coins database in key order
 * (txid bytes, then vout); the file is written from that same cursor, so the
 * streamed hash equals Core's only when the file is in that order. An
 * out-of-order file is reported instead of being hashed as if it were sorted.
 */

export const NETWORK_MAGIC: Record<string, string> = {
  mainnet: 'f9beb4d9',
  testnet: '0b110907',
  testnet4: '1c163f28',
  signet: '0a03cf40',
  regtest: 'fabfb5da',
};

export const SNAPSHOT_MAGIC = Buffer.from('7574786fff', 'hex');
export const SUPPORTED_SNAPSHOT_VERSIONS = [2];
const MAX_SCRIPT_SIZE = 10000;
const MAX_COMPACT_SIZE = 0x02000000n;
const MAX_MONEY = 21000000n * 100000000n;
const SECP_P = (1n << 256n) - (1n << 32n) - 977n;

export interface SnapshotHeader {
  format: 'versioned' | 'legacy';
  version: number | null;
  network_magic: string | null;
  /** Display byte order, as RPCs print it. */
  base_block_hash: string;
  coins_count: number;
  header_bytes: number;
}

export interface SnapshotDecodeResult {
  header: SnapshotHeader;
  coins_read: number;
  bytes_read: number;
  /** Display byte order, comparable with `gettxoutsetinfo hash_serialized_3`. */
  hash_serialized_3: string | null;
  hash_reason: string | null;
  max_coin_height: number;
}

export class SnapshotFormatError extends Error {
  constructor(public readonly reason: string, message: string) {
    super(message);
  }
}

class NeedMore extends Error {}

/** Cursor over a buffer; throws NeedMore when a record is incomplete. */
class Cursor {
  public pos = 0;
  constructor(public buf: Buffer) {}
  need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new NeedMore();
    }
  }
  byte(): number {
    this.need(1);
    return this.buf[this.pos++];
  }
  bytes(n: number): Buffer {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u16(): number {
    this.need(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }
  /** serialize.h ReadCompactSize with range checks and minimal encoding. */
  compactSize(): bigint {
    const first = this.byte();
    let value: bigint;
    if (first < 253) {
      value = BigInt(first);
    } else if (first === 253) {
      value = BigInt(this.u16());
      if (value < 253n) {
        throw new SnapshotFormatError('malformed-compactsize', 'CompactSize is not minimally encoded.');
      }
    } else if (first === 254) {
      value = BigInt(this.u32());
      if (value < 0x10000n) {
        throw new SnapshotFormatError('malformed-compactsize', 'CompactSize is not minimally encoded.');
      }
    } else {
      value = this.u64();
      if (value < 0x100000000n) {
        throw new SnapshotFormatError('malformed-compactsize', 'CompactSize is not minimally encoded.');
      }
    }
    if (value > MAX_COMPACT_SIZE) {
      throw new SnapshotFormatError('malformed-compactsize', 'CompactSize exceeds MAX_SIZE.');
    }
    return value;
  }
  /** serialize.h ReadVarInt: MSB base-128 with the +1 continuation trick. */
  varint(): bigint {
    let n = 0n;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      n = (n << 7n) | BigInt(b & 0x7f);
      if (b & 0x80) {
        n += 1n;
      } else {
        return n;
      }
    }
    throw new SnapshotFormatError('malformed-varint', 'VARINT is longer than 10 bytes.');
  }
}

/** compressor.cpp DecompressAmount. */
export function decompressAmount(x: bigint): bigint {
  if (x === 0n) {
    return 0n;
  }
  x -= 1n;
  const e = x % 10n;
  x /= 10n;
  let n: bigint;
  if (e < 9n) {
    const d = (x % 9n) + 1n;
    x /= 9n;
    n = x * 10n + d;
  } else {
    n = x + 1n;
  }
  return n * 10n ** e;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

/** secp256k1 point decompression as CPubKey::Decompress; null when x is not on the curve. */
export function decompressPubkey(prefix: number, x: Buffer): Buffer | null {
  const xi = BigInt('0x' + x.toString('hex'));
  if (xi >= SECP_P) {
    return null;
  }
  const y2 = (modPow(xi, 3n, SECP_P) + 7n) % SECP_P;
  let y = modPow(y2, (SECP_P + 1n) / 4n, SECP_P);
  if ((y * y) % SECP_P !== y2) {
    return null;
  }
  if ((y & 1n) !== BigInt(prefix & 1)) {
    y = SECP_P - y;
  }
  return Buffer.concat([Buffer.from([0x04]), x, Buffer.from(y.toString(16).padStart(64, '0'), 'hex')]);
}

/** compressor.cpp DecompressScript; an undecodable key leaves the script empty, as Core does. */
export function decompressScript(kind: number, data: Buffer): Buffer {
  switch (kind) {
    case 0:
      return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), data, Buffer.from([0x88, 0xac])]);
    case 1:
      return Buffer.concat([Buffer.from([0xa9, 0x14]), data, Buffer.from([0x87])]);
    case 2:
    case 3:
      return Buffer.concat([Buffer.from([0x21, kind]), data, Buffer.from([0xac])]);
    case 4:
    case 5: {
      const key = decompressPubkey(kind - 2, data);
      return key ? Buffer.concat([Buffer.from([0x41]), key, Buffer.from([0xac])]) : Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

function readCoin(c: Cursor): { height: number; coinbase: boolean; amount: bigint; script: Buffer } {
  const code = c.varint();
  if (code > 0xffffffffn) {
    throw new SnapshotFormatError('malformed-coin', 'Coin height code exceeds 32 bits.');
  }
  const amount = decompressAmount(c.varint());
  const nSize = c.varint();
  let script: Buffer;
  if (nSize < 6n) {
    script = decompressScript(Number(nSize), c.bytes(nSize < 2n ? 20 : 32));
  } else {
    const len = nSize - 6n;
    if (len > MAX_COMPACT_SIZE) {
      throw new SnapshotFormatError('malformed-coin', 'Script length is not plausible.');
    }
    if (len > BigInt(MAX_SCRIPT_SIZE)) {
      // Core replaces an overly long script with OP_RETURN and skips the bytes.
      c.bytes(Number(len));
      script = Buffer.from([0x6a]);
    } else {
      script = Buffer.from(c.bytes(Number(len)));
    }
  }
  return { height: Number(code >> 1n), coinbase: (code & 1n) === 1n, amount, script };
}

function compactSizeBytes(n: number): Buffer {
  if (n < 253) {
    return Buffer.from([n]);
  }
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 253;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 254;
  b.writeUInt32LE(n, 1);
  return b;
}

function displayHash(internal: Buffer): string {
  return Buffer.from(internal).reverse().toString('hex');
}

export class SnapshotStreamDecoder {
  private pending: Buffer = Buffer.alloc(0);
  private header?: SnapshotHeader;
  private hash: Hash | null = createHash('sha256');
  private hashReason: string | null = null;
  private coinsRead = 0;
  private bytesRead = 0;
  private maxHeight = 0;
  private done = false;
  // versioned body state
  private txid?: Buffer;
  private coinsLeftInTx = 0;
  private lastVout = -1;
  private lastTxid?: Buffer;

  constructor(private readonly expectedNetwork?: string) {}

  public feed(chunk: Buffer): void {
    if (this.done) {
      throw new SnapshotFormatError('trailing-data', 'Bytes follow the last coin of the snapshot.');
    }
    this.bytesRead += chunk.length;
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const c = new Cursor(this.pending);
    try {
      this.parse(c);
    } catch (e) {
      if (!(e instanceof NeedMore)) {
        throw e;
      }
    }
    this.pending = c.pos === this.pending.length ? Buffer.alloc(0) : Buffer.from(this.pending.subarray(c.pos));
  }

  public finish(): SnapshotDecodeResult {
    if (!this.header) {
      throw new SnapshotFormatError('truncated', 'The snapshot ended before its header was complete.');
    }
    if (this.coinsRead !== this.header.coins_count || this.pending.length) {
      throw new SnapshotFormatError(
        'truncated',
        `The snapshot ended after ${this.coinsRead} of ${this.header.coins_count} coins with ${this.pending.length} undecoded bytes.`
      );
    }
    const digest = this.hash ? createHash('sha256').update(this.hash.digest()).digest() : null;
    return {
      header: this.header,
      coins_read: this.coinsRead,
      bytes_read: this.bytesRead,
      hash_serialized_3: digest ? displayHash(digest) : null,
      hash_reason: this.hashReason,
      max_coin_height: this.maxHeight,
    };
  }

  /** Each record is consumed atomically: an incomplete one rewinds the cursor to its start. */
  private parse(c: Cursor): void {
    while (!this.done) {
      const mark = c.pos;
      try {
        if (!this.header) {
          this.header = this.readHeader(c);
          if (this.header.coins_count === 0) {
            this.done = true;
          }
        } else if (this.header.format === 'legacy') {
          this.readLegacyCoin(c);
        } else {
          this.readVersionedRecord(c);
        }
      } catch (e) {
        if (e instanceof NeedMore) {
          c.pos = mark;
        }
        throw e;
      }
    }
    if (c.pos < c.buf.length) {
      throw new SnapshotFormatError('trailing-data', 'Bytes follow the last coin of the snapshot.');
    }
  }

  private readHeader(c: Cursor): SnapshotHeader {
    c.need(5);
    const versioned = c.buf.subarray(0, 5).equals(SNAPSHOT_MAGIC);
    if (versioned) {
      c.bytes(5);
      const version = c.u16();
      if (!SUPPORTED_SNAPSHOT_VERSIONS.includes(version)) {
        throw new SnapshotFormatError('unsupported-snapshot-version', `Snapshot version ${version} is not supported.`);
      }
      const magic = c.bytes(4).toString('hex');
      if (this.expectedNetwork && NETWORK_MAGIC[this.expectedNetwork] !== magic) {
        throw new SnapshotFormatError('network-magic-mismatch', `Snapshot network magic ${magic} is not ${this.expectedNetwork}.`);
      }
      const base = displayHash(c.bytes(32));
      const coins = c.u64();
      if (coins > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new SnapshotFormatError('malformed-header', 'Coins count is not representable.');
      }
      return { format: 'versioned', version, network_magic: magic, base_block_hash: base, coins_count: Number(coins), header_bytes: c.pos };
    }
    const base = displayHash(c.bytes(32));
    const coins = c.u64();
    if (coins > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new SnapshotFormatError('malformed-header', 'Coins count is not representable.');
    }
    return { format: 'legacy', version: null, network_magic: null, base_block_hash: base, coins_count: Number(coins), header_bytes: c.pos };
  }

  /** Reads one coin; state is only committed once every byte of the record is present. */
  private readVersionedRecord(c: Cursor): void {
    let txid = this.txid;
    let coinsLeft = this.coinsLeftInTx;
    let lastVout = this.lastVout;
    let newTx = false;
    if (!txid) {
      txid = Buffer.from(c.bytes(32));
      const count = c.compactSize();
      if (count === 0n || count > BigInt(this.header!.coins_count - this.coinsRead)) {
        throw new SnapshotFormatError('malformed-coin', 'Per-transaction coin count is zero or exceeds the coins left.');
      }
      coinsLeft = Number(count);
      lastVout = -1;
      newTx = true;
    }
    const vout = c.compactSize();
    if (vout >= 0xffffffffn) {
      throw new SnapshotFormatError('malformed-coin', 'Output index is out of range.');
    }
    const coin = readCoin(c);
    if (newTx) {
      if (this.lastTxid && Buffer.compare(this.lastTxid, txid) >= 0) {
        this.disableHash('coins-not-in-cursor-order');
      }
      this.lastTxid = txid;
    }
    if (Number(vout) <= lastVout) {
      this.disableHash('coins-not-in-cursor-order');
    }
    this.lastVout = Number(vout);
    this.applyCoin(txid, Number(vout), coin);
    coinsLeft--;
    this.txid = coinsLeft === 0 ? undefined : txid;
    this.coinsLeftInTx = coinsLeft;
  }

  private readLegacyCoin(c: Cursor): void {
    const txid = Buffer.from(c.bytes(32));
    const vout = c.u32();
    const coin = readCoin(c);
    if (this.lastTxid) {
      const order = Buffer.compare(this.lastTxid, txid);
      if (order > 0 || (order === 0 && vout <= this.lastVout)) {
        this.disableHash('coins-not-in-cursor-order');
      }
    }
    this.lastTxid = txid;
    this.lastVout = vout;
    this.applyCoin(txid, vout, coin);
  }

  private applyCoin(txid: Buffer, vout: number, coin: ReturnType<typeof readCoin>): void {
    if (coin.amount > MAX_MONEY) {
      throw new SnapshotFormatError('malformed-coin', 'Coin amount is outside the money range.');
    }
    this.coinsRead++;
    this.maxHeight = Math.max(this.maxHeight, coin.height);
    if (this.hash) {
      const fixed = Buffer.alloc(16);
      fixed.writeUInt32LE(vout, 0);
      fixed.writeUInt32LE(((coin.height << 1) + (coin.coinbase ? 1 : 0)) >>> 0, 4);
      fixed.writeBigInt64LE(coin.amount, 8);
      this.hash.update(txid).update(fixed).update(compactSizeBytes(coin.script.length)).update(coin.script);
    }
    if (this.coinsRead === this.header!.coins_count) {
      this.done = true;
    }
  }

  private disableHash(reason: string): void {
    this.hash = null;
    this.hashReason = reason;
  }
}

/** Convenience for tests and small files: decode a complete buffer. */
export function decodeSnapshot(bytes: Buffer, expectedNetwork?: string, chunkSize = 1024): SnapshotDecodeResult {
  const decoder = new SnapshotStreamDecoder(expectedNetwork);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    decoder.feed(bytes.subarray(i, Math.min(bytes.length, i + chunkSize)));
  }
  return decoder.finish();
}
