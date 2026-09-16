import { Transaction } from 'bitcoinjs-lib';
import { digest } from './conformance-evidence';
export interface CampaignInput {
  id: string;
  hex: string;
  expected?: Record<string, string>;
  context?: any;
  title: string;
}
export function parserCorpus(target: string, seed: number, genesis?: string): CampaignInput[] {
  let rows: CampaignInput[] = [];
  if (target === 'transaction_parse') {
    const tx = new Transaction();
    tx.version = 2;
    tx.addInput(Buffer.alloc(32, 0x11), 0, 0xfffffffe);
    tx.addOutput(Buffer.from('6a', 'hex'), 0);
    const legacy = tx.toHex();
    tx.setWitness(0, [Buffer.from('01', 'hex')]);
    const witness = tx.toHex();
    rows = [
      {
        id: 'legacy-roundtrip',
        hex: legacy,
        title: 'Canonical legacy transaction',
        expected: { 'bitcoin-core': 'accepted', 'rust-bitcoin': 'accepted', bitcoinjs: 'accepted' },
      },
      {
        id: 'witness-roundtrip',
        hex: witness,
        title: 'Canonical witness serialization',
        expected: { 'bitcoin-core': 'accepted', 'rust-bitcoin': 'accepted', bitcoinjs: 'accepted' },
      },
      {
        id: 'truncated',
        hex: legacy.slice(0, -2),
        title: 'Truncated locktime',
        expected: { 'bitcoin-core': 'rejected', 'rust-bitcoin': 'rejected', bitcoinjs: 'rejected' },
      },
      {
        id: 'nonminimal-input-count',
        hex: legacy.slice(0, 8) + 'fd0100' + legacy.slice(10),
        title: 'Nonminimal input CompactSize',
        expected: { 'bitcoin-core': 'rejected', 'rust-bitcoin': 'rejected' },
      },
      {
        id: 'trailing-byte',
        hex: legacy + '00',
        title: 'Trailing byte',
        expected: { 'rust-bitcoin': 'rejected', bitcoinjs: 'rejected' },
      },
    ];
    let n = parseInt(digest(String(seed)).slice(0, 8), 16);
    for (let i = 0; i < 8; i++) {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      const raw = Buffer.from(i % 2 ? witness : legacy, 'hex');
      raw[n % raw.length] ^= 1 << (n % 8);
      rows.push({ id: 'seeded-bit-' + i, hex: raw.toString('hex'), title: 'Deterministic byte mutation ' + i });
    }
  } else if (target === 'compact_size') {
    rows = [
      ['zero', '00'],
      ['maximum-single-byte', 'fc'],
      ['minimal-253', 'fdfd00'],
      ['nonminimal-zero', 'fd0000'],
      ['nonminimal-one', 'fd0100'],
      ['nonminimal-32', 'fe01000000'],
      ['uint64-maximum', 'ffffffffffffffffff'],
      ['truncated-u64', 'ff000000'],
      ['trailing', '0000'],
    ].map(([id, hex]): CampaignInput => ({
      id,
      hex,
      title: 'CompactSize ' + id,
      expected: id.startsWith('nonminimal')
        ? { 'rust-bitcoin': 'rejected' }
        : id === 'truncated-u64' || id === 'trailing'
          ? { 'rust-bitcoin': 'rejected', bitcoinjs: 'rejected' }
          : undefined,
    }));
  } else if (target === 'block_parse' && genesis) {
    const bad = Buffer.from(genesis, 'hex');
    bad[36] ^= 1;
    rows = [
      {
        id: 'regtest-genesis',
        hex: genesis,
        title: 'Owned isolated Core regtest genesis block',
        expected: { 'rust-bitcoin': 'accepted', bitcoinjs: 'accepted' },
      },
      {
        id: 'wrong-merkle-root',
        hex: bad.toString('hex'),
        title: 'Serialized block with wrong Merkle commitment',
        expected: { 'rust-bitcoin': 'accepted', bitcoinjs: 'accepted' },
      },
      {
        id: 'truncated-block',
        hex: genesis.slice(0, -2),
        title: 'Truncated block transaction',
        expected: { 'rust-bitcoin': 'rejected', bitcoinjs: 'rejected' },
      },
    ];
  }
  return rows;
}
