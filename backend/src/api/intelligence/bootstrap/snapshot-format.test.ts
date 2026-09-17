import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decodeSnapshot,
  decompressAmount,
  decompressPubkey,
  NETWORK_MAGIC,
  SnapshotFormatError,
  SnapshotStreamDecoder,
  varintBytes,
} from './snapshot-format';

/** Exact dumptxoutset bytes of an offline Bitcoin Core 28.0 regtest node; see __fixtures__/README.md. */
export const REGTEST_FIXTURE = {
  bytes: Buffer.from(readFileSync(join(__dirname, '__fixtures__', 'regtest-105.snapshot.base64'), 'utf8'), 'base64'),
  baseHash: '0be30936f2332969e5dd82fe06d0c4d8d25d86351442ec813c2f70aa132c2acb',
  height: 105,
  coins: 107,
  hashSerialized3: '2fff9d5b75bf5539b20a99cbae5639819995d0b560d2cfda171aafed870418fc',
  sha256: 'facbe9af2dede0a3322ec7b9c46328f4f86cfc4764cab11b90b3821104cceb7e',
};

/** compressor.cpp CompressAmount, transcribed for round trips. */
function compressAmount(n: bigint): bigint {
  if (n === 0n) {
    return 0n;
  }
  let e = 0n;
  while (n % 10n === 0n && e < 9n) {
    n /= 10n;
    e++;
  }
  if (e < 9n) {
    const d = n % 10n;
    n /= 10n;
    return 1n + (n * 9n + d - 1n) * 10n + e;
  }
  return 1n + (n - 1n) * 10n + 9n;
}

function varint(n: bigint): Buffer {
  const out: number[] = [];
  let first = true;
  for (;;) {
    out.unshift(Number(n & 0x7fn) | (first ? 0 : 0x80));
    if (n <= 0x7fn) {
      break;
    }
    n = (n >> 7n) - 1n;
    first = false;
  }
  return Buffer.from(out);
}

const sha256d = (b: Buffer): string => Buffer.from(createHash('sha256').update(createHash('sha256').update(b).digest()).digest()).reverse().toString('hex');

describe('snapshot-format', () => {
  it('reproduces Bitcoin Core 28.0 metadata and hash_serialized_3 for a real dumptxoutset file', () => {
    for (const chunk of [1, 7, 64, 1024, 1 << 20]) {
      const result = decodeSnapshot(REGTEST_FIXTURE.bytes, 'regtest', chunk);
      expect(result.header).toEqual({ format: 'versioned', version: 2, network_magic: NETWORK_MAGIC.regtest, base_block_hash: REGTEST_FIXTURE.baseHash, coins_count: 107, header_bytes: 51 });
      expect(result.coins_read).toBe(REGTEST_FIXTURE.coins);
      expect(result.bytes_read).toBe(REGTEST_FIXTURE.bytes.length);
      expect(result.max_coin_height).toBe(REGTEST_FIXTURE.height);
      expect(result.hash_serialized_3).toBe(REGTEST_FIXTURE.hashSerialized3);
      expect(result.hash_reason).toBeNull();
    }
    expect(createHash('sha256').update(REGTEST_FIXTURE.bytes).digest('hex')).toBe(REGTEST_FIXTURE.sha256);
  });

  it('hashes a hand-built coin identically in the versioned and the pre-28 layout', () => {
    const txid = Buffer.alloc(32, 0xab);
    const script = Buffer.alloc(20, 0x11);
    const coin = Buffer.concat([varint(2n * 100n + 1n), varint(compressAmount(5000000000n)), varint(0n), script]);
    const versioned = Buffer.concat([
      Buffer.from('7574786fff0200', 'hex'), Buffer.from(NETWORK_MAGIC.signet, 'hex'), Buffer.alloc(32, 0x01), Buffer.from('0100000000000000', 'hex'),
      txid, Buffer.from([1]), Buffer.from([0]), coin,
    ]);
    const legacy = Buffer.concat([Buffer.alloc(32, 0x01), Buffer.from('0100000000000000', 'hex'), txid, Buffer.from('00000000', 'hex'), coin]);
    const expectedScript = Buffer.concat([Buffer.from('76a914', 'hex'), script, Buffer.from('88ac', 'hex')]);
    const txOutSer = Buffer.concat([txid, Buffer.from('00000000', 'hex'), Buffer.from('c9000000', 'hex'), Buffer.from('00f2052a01000000', 'hex'), Buffer.from([expectedScript.length]), expectedScript]);
    const a = decodeSnapshot(versioned, 'signet');
    const b = decodeSnapshot(legacy);
    expect(a.hash_serialized_3).toBe(sha256d(txOutSer));
    expect(b.hash_serialized_3).toBe(a.hash_serialized_3);
    expect(b.header.format).toBe('legacy');
    expect(b.header.base_block_hash).toBe('01'.repeat(32));
    expect(a.max_coin_height).toBe(100);
  });

  it('refuses an unsupported header version, another network, truncation and trailing bytes', () => {
    const bytes = REGTEST_FIXTURE.bytes;
    const v1 = Buffer.from(bytes);
    v1[5] = 1;
    expect(() => decodeSnapshot(v1, 'regtest')).toThrow(expect.objectContaining({ reason: 'unsupported-snapshot-version' }));
    expect(() => decodeSnapshot(bytes, 'signet')).toThrow(expect.objectContaining({ reason: 'network-magic-mismatch' }));
    expect(() => decodeSnapshot(bytes.subarray(0, bytes.length - 1), 'regtest')).toThrow(expect.objectContaining({ reason: 'truncated' }));
    expect(() => decodeSnapshot(bytes.subarray(0, 40), 'regtest')).toThrow(expect.objectContaining({ reason: 'truncated' }));
    expect(() => decodeSnapshot(Buffer.concat([bytes, Buffer.from([0])]), 'regtest')).toThrow(expect.objectContaining({ reason: 'trailing-data' }));
    const fewer = Buffer.from(bytes);
    fewer.writeBigUInt64LE(106n, 43);
    expect(() => decodeSnapshot(fewer, 'regtest')).toThrow(SnapshotFormatError);
    const decoder = new SnapshotStreamDecoder('regtest');
    decoder.feed(bytes);
    expect(() => decoder.feed(Buffer.from([1]))).toThrow(expect.objectContaining({ reason: 'trailing-data' }));
  });

  it('reports coins outside Core cursor order instead of hashing them as if sorted', () => {
    const txid = (fill: number): Buffer => Buffer.alloc(32, fill);
    const coin = Buffer.concat([varint(3n), varint(compressAmount(1n)), varint(0n), Buffer.alloc(20, 0)]);
    const header = Buffer.concat([Buffer.from('7574786fff0200', 'hex'), Buffer.from(NETWORK_MAGIC.regtest, 'hex'), Buffer.alloc(32, 0x01), Buffer.from('0200000000000000', 'hex')]);
    const ordered = Buffer.concat([header, txid(1), Buffer.from([1, 0]), coin, txid(2), Buffer.from([1, 0]), coin]);
    const reversed = Buffer.concat([header, txid(2), Buffer.from([1, 0]), coin, txid(1), Buffer.from([1, 0]), coin]);
    expect(decodeSnapshot(ordered, 'regtest').hash_serialized_3).toHaveLength(64);
    const out = decodeSnapshot(reversed, 'regtest');
    expect(out.hash_serialized_3).toBeNull();
    expect(out.hash_reason).toBe('coins-not-in-cursor-order');
    expect(out.coins_read).toBe(2);
    // Core splits a transaction with many unspent outputs across consecutive
    // groups of the same txid; ascending outputs across the split keep the
    // cursor order, a repeated or lower output index does not.
    const continued = Buffer.concat([header, txid(1), Buffer.from([1, 0]), coin, txid(1), Buffer.from([1, 1]), coin]);
    const continuedOut = decodeSnapshot(continued, 'regtest');
    expect(continuedOut.hash_serialized_3).toHaveLength(64);
    expect(continuedOut.hash_serialized_3).toBe(decodeSnapshot(Buffer.concat([header, txid(1), Buffer.from([2, 0]), coin, Buffer.from([1]), coin]), 'regtest').hash_serialized_3);
    const repeated = Buffer.concat([header, txid(1), Buffer.from([1, 1]), coin, txid(1), Buffer.from([1, 0]), coin]);
    expect(decodeSnapshot(repeated, 'regtest').hash_reason).toBe('coins-not-in-cursor-order');
    // The cursor orders outputs by their VARINT key bytes, not numerically:
    // VARINT(23229) sorts before VARINT(256) (three bytes starting 0x80 beat
    // two bytes starting 0x81), which is what Core writes and hashes.
    expect(Buffer.compare(varintBytes(23229), varintBytes(256))).toBeLessThan(0);
    const varintOrder = Buffer.concat([header, txid(1), Buffer.from([2]), Buffer.concat([Buffer.from([0xfd, 0xbd, 0x5a]), coin]), Buffer.concat([Buffer.from([0xfd, 0x00, 0x01]), coin])]);
    const varintOut = decodeSnapshot(varintOrder, 'regtest');
    expect(varintOut.hash_reason).toBeNull();
    expect(varintOut.hash_serialized_3).toHaveLength(64);
    // Core hashes a transaction's coins in ascending output index whatever
    // the cursor yielded (coinstats.cpp collects them in a std::map first).
    // The Core 28.0 regtest fixture above and the Signet snapshot at height
    // 322488 (76,453,800 coins, output 23229 before 256) both reproduce
    // Core's own hash_serialized_3 with this ordering.
    const numericOrder = Buffer.concat([header, txid(1), Buffer.from([2]), Buffer.concat([Buffer.from([0xfd, 0x00, 0x01]), coin]), Buffer.concat([Buffer.from([0xfd, 0xbd, 0x5a]), coin])]);
    expect(decodeSnapshot(numericOrder, 'regtest').hash_reason).toBe('coins-not-in-cursor-order');
  });

  it('decompresses amounts and public keys as compressor.cpp and CPubKey do', () => {
    for (const n of [0n, 1n, 9n, 10n, 12345n, 5000000000n, 2099999997690000n, 2100000000000000n]) {
      expect(decompressAmount(compressAmount(n))).toBe(n);
    }
    expect(decompressAmount(50n)).toBe(5000000000n);
    const gx = Buffer.from('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
    const gy = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';
    expect(decompressPubkey(2, gx)?.toString('hex')).toBe('04' + gx.toString('hex') + gy);
    expect(decompressPubkey(3, gx)?.toString('hex')).not.toBe('04' + gx.toString('hex') + gy);
    expect(decompressPubkey(2, Buffer.alloc(32, 0xff))).toBeNull();
  });
});
