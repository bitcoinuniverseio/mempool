import { createHash } from 'crypto';
import { decodeMerkleProof } from './merkle-proof';
import { SpvProofReader } from './spv-proof';
const fixture = require('./regtest-proof.fixture.json');
jest.mock('../workbench/workbench-core', () => ({ ownedWorkbenchCore: {} }));
const request = () => ({ txid: fixture.txid, proof_hex: fixture.proof_hex, network: 'regtest' });
function source(override: Record<string, any> = {}) {
  const call = jest.fn(async (method: string, params: any[]) => {
    if (override[method]) return override[method](params);
    if (method === 'getblockchaininfo') return fixture.chain;
    if (method === 'getblockhash') return params[0] === 0 ? fixture.genesis : fixture.header.hash;
    if (method === 'getblockheader') return params[1] ? fixture.header : fixture.proof_hex.slice(0, 160);
    if (method === 'gettxoutproof') return fixture.proof_hex;
    if (method === 'verifytxoutproof') return fixture.verified;
    throw Error('Unexpected RPC');
  });
  return { network: 'regtest', call };
}
const digest = (data: Buffer) => createHash('sha256').update(createHash('sha256').update(data).digest()).digest();

describe('Core-compatible bounded partial Merkle decoding', () => {
  it('independently reconstructs a real mined Core29 proof with the exact transaction index', () => {
    const result = decodeMerkleProof(fixture.proof_hex);
    expect(result.blockHash).toBe(fixture.header.hash); expect(result.merkleRoot).toBe(fixture.header.merkleroot);
    expect(result.matches).toEqual([{ txid: fixture.txid, index: 1 }]); expect(result.transactionCount).toBe(2);
  });
  it('follows Core flag-byte exhaustion while permitting unused high padding bits', () => {
    const bytes = Buffer.from(fixture.proof_hex, 'hex'); bytes[bytes.length - 1] |= 128;
    expect(decodeMerkleProof(bytes.toString('hex')).nonzeroPadding).toBe(true);
    const extraFlags = Buffer.concat([bytes.subarray(0, -2), Buffer.from([2, bytes[bytes.length - 1], 0])]);
    expect(() => decodeMerkleProof(extraFlags.toString('hex'))).toThrow();
  });
  it.each(['', '00', 'gg', fixture.proof_hex + '00', fixture.proof_hex.slice(0, -2)])('rejects malformed/trailing/truncated proof bytes', value => {
    expect(() => decodeMerkleProof(value)).toThrow();
  });
  it('rejects noncanonical counts and exhausted hashes/flags', () => {
    const b = Buffer.from(fixture.proof_hex, 'hex');
    const noncanonical = Buffer.concat([b.subarray(0, 84), Buffer.from([253, 2, 0]), b.subarray(85)]);
    expect(() => decodeMerkleProof(noncanonical.toString('hex'))).toThrow('Noncanonical');
    const tooMany = Buffer.from(b); tooMany[84] = 3; expect(() => decodeMerkleProof(tooMany.toString('hex'))).toThrow();
    const noFlags = Buffer.from(b); noFlags[noFlags.length - 2] = 0; expect(() => decodeMerkleProof(noFlags.toString('hex'))).toThrow();
    const unusedHash = Buffer.from(b); unusedHash[unusedHash.length - 1] = 0; expect(() => decodeMerkleProof(unusedHash.toString('hex'))).toThrow();
  });
  it('rejects equal real siblings even if their committed root matches', () => {
    const b = Buffer.from(fixture.proof_hex, 'hex'); b.copy(b, 117, 85, 117);
    digest(b.subarray(85, 149)).copy(b, 36); b[b.length - 1] = 7;
    expect(() => decodeMerkleProof(b.toString('hex'))).toThrow('Mutated');
  });
  it('uses Core29 maximum4000000/(4*60)=16666 rather than66666 transactions', () => {
    const header = Buffer.from(fixture.proof_hex.slice(0, 160), 'hex');
    const total = Buffer.alloc(4); total.writeUInt32LE(16666);
    const b = Buffer.concat([header, total, Buffer.from([1]), header.subarray(36, 68), Buffer.from([1, 0])]);
    expect(decodeMerkleProof(b.toString('hex')).transactionCount).toBe(16666);
    b.writeUInt32LE(16667, 80); expect(() => decodeMerkleProof(b.toString('hex'))).toThrow('transaction count');
  });
});

describe('Owned-chain proof binding', () => {
  it('bounds concurrent owned reads and releases permits after completion', async () => {
    let release!: (value: any) => void;
    const checkpoint = new Promise(resolve => { release = resolve; });
    const reader = new SpvProofReader(source({ getblockchaininfo: () => checkpoint }));
    const pending = Array.from({ length: 4 }, () => reader.verify(request()));
    await expect(reader.verify(request())).rejects.toMatchObject({ code: 'proof-reader-busy', status: 503 });
    release(fixture.chain);
    expect((await Promise.all(pending)).every(result => result.is_valid === true)).toBe(true);
    expect((await reader.verify(request())).is_valid).toBe(true);
  });
  it('generates and verifies only after actual proof/header/genesis/checkpoint reads', async () => {
    const core = source(); const reader = new SpvProofReader(core);
    const result: any = await reader.generate({ txid: fixture.txid, block_hash: fixture.header.hash, block_height: fixture.header.height, network: 'regtest' });
    expect(result.is_verified).toBe(true); expect(result.source.genesis_hash).toBe(fixture.genesis);
    expect(core.call).toHaveBeenCalledWith('gettxoutproof', [[fixture.txid], fixture.header.hash]);
    expect(core.call).toHaveBeenCalledWith('verifytxoutproof', [fixture.proof_hex]);
  });
  it.each([{ txid: '11'.repeat(32) }, { block_hash: '11'.repeat(32) }, { tx_index: 0 }, { block_height: 103 }, { merkle_root: '11'.repeat(32) }, { hashes: [] }, { flags: '00' }, { header_hex: '00' }, { transaction_count: 3 }])('rejects supplied metadata mismatch %j', async mismatch => {
    expect((await new SpvProofReader(source()).verify({ ...request(), ...mismatch })).is_valid).toBe(false);
  });
  it('distinguishes malformed input, wrong network, unknown source and a known inactive block', async () => {
    const reader = new SpvProofReader(source());
    await expect(reader.verify({})).rejects.toMatchObject({ status: 400 });
    await expect(reader.verify({ ...request(), network: 'signet' })).rejects.toMatchObject({ code: 'wrong-network' });
    expect((await reader.verify({ ...request(), proof_hex: '00' })).is_valid).toBe(false);
    await expect(new SpvProofReader(source({ getblockheader: () => { throw Error(); } })).verify(request())).rejects.toMatchObject({ code: 'unavailable-proof-block', status: 503 });
    expect((await new SpvProofReader(source({ getblockheader: () => ({ confirmations: -1 }) })).verify(request())).is_valid).toBe(false);
  });
  it('refuses a wrong genesis, IBD source, changed checkpoint or inconsistent raw header', async () => {
    for (const overrides of [
      { getblockhash: () => 'ff'.repeat(32) },
      { getblockchaininfo: () => ({ ...fixture.chain, initialblockdownload: true }) },
      { getblockheader: (params: any[]) => params[1] ? fixture.header : '00'.repeat(80) },
    ]) await expect(new SpvProofReader(source(overrides)).verify(request())).rejects.toMatchObject({ status: 503 });
    let calls = 0;
    await expect(new SpvProofReader(source({ getblockchaininfo: () => ({ ...fixture.chain, bestblockhash: ++calls === 1 ? fixture.chain.bestblockhash : 'ff'.repeat(32) }) })).verify(request())).rejects.toMatchObject({ code: 'proof-source-changed' });
  });
  it('rejects a wrong total transaction count or Core match-set disagreement', async () => {
    expect((await new SpvProofReader(source({ getblockheader: () => ({ ...fixture.header, nTx: 3 }) })).verify(request())).is_valid).toBe(false);
    expect((await new SpvProofReader(source({ verifytxoutproof: () => [] })).verify(request())).is_valid).toBe(false);
  });
});
