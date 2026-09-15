import { Transaction } from 'bitcoinjs-lib';
import { TapdAuthority, TapdHttp, tapdConfigFromEnvironment } from './taproot-assets.authority';
import { TaprootAssetsService } from './taproot-assets.service';
import { SPV_GENESIS } from '../intelligence/verification/spv-proof';

const id = '11'.repeat(32), block = '22'.repeat(32), genesis = '33'.repeat(32) + ':0';
const tx = new Transaction();
tx.addInput(Buffer.alloc(32, 1), 0);
tx.addOutput(Buffer.from('5120' + '44'.repeat(32), 'hex'), 1000);
const encoded = Buffer.from('synthetic contract fixture: not a native proof').toString('base64');
const claim = () => ({ proof_at_depth: 0, number_of_proofs: 2, asset: { asset_genesis: { asset_id: id, genesis_point: genesis },
  chain_anchor: { anchor_tx: tx.toHex(), anchor_outpoint: tx.getId() + ':0', anchor_block_hash: block, block_height: 100 } } });
function setup(change: (path: string, body: any, call: number) => any = (_p, body) => body,
  coreChange: (method: string, result: any, count: number) => any = (_m, result) => result) {
  const calls: any[] = []; let count = 0;
  const http: TapdHttp = { request: async (method, path, body) => {
    calls.push({ method, path, body });
    const response = path.endsWith('getinfo') ? { network: 'signet', version: '0.6.0', sync_to_chain: true, block_height: 100, block_hash: block }
      : path.endsWith('/verify') ? { valid: true, decoded_proof: claim() } : path.endsWith('/decode') ? { decoded_proof: claim() }
      : path.includes('assets?') ? { assets: [] } : path.endsWith('/groups') ? { groups: {} } : { buy_quotes: [], sell_quotes: [] };
    return { status: 200, body: change(path, response, calls.length) };
  } };
  const core = { network: 'signet', call: async (method: string, params: unknown[]) => {
    const result = method === 'getblockchaininfo' ? { chain: 'signet', blocks: 100, bestblockhash: block, initialblockdownload: false }
      : method === 'getblockhash' ? params[0] === 0 ? SPV_GENESIS.signet : block
      : method === 'getblockheader' ? { hash: block, height: 100, confirmations: 1 } : tx.toHex();
    return coreChange(method, result, ++count);
  } };
  const authority = new TapdAuthority('signet', http, core);
  return { calls, authority, http, core, service: new TaprootAssetsService({ authority }) };
}

describe('Taproot authority proof contract (synthetic source responses, no native validity claim)', () => {
  it('binds exact hex bytes, identity, full anchor and fresh source checkpoint', async () => {
    const s = setup(); const result = await s.authority.verifyProof(id, encoded);
    expect(result).toMatchObject({ valid: true, stage: 'verified', asset_id: id, network: 'signet', proofs_in_file: 2,
      anchor: { txid: tx.getId(), outpoint: tx.getId() + ':0', block_hash: block, block_height: 100 },
      source: { genesis_hash: SPV_GENESIS.signet, tapd_version: '0.6.0' }, proof_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(s.calls.find(c => c.path.endsWith('/decode')).body.raw_proof).toBe(Buffer.from(encoded, 'base64').toString('hex'));
    expect(s.calls.find(c => c.path.endsWith('/verify')).body.raw_proof_file).toBe(Buffer.from(encoded, 'base64').toString('hex'));
    expect(s.calls.filter(c => c.path.endsWith('/getinfo'))).toHaveLength(2);
  });
  it.each([
    ['different verified asset', (b: any) => { b.decoded_proof.asset.asset_genesis.asset_id = '55'.repeat(32); }],
    ['different verified genesis', (b: any) => { b.decoded_proof.asset.asset_genesis.genesis_point = '55'.repeat(32) + ':0'; }],
    ['different proof count', (b: any) => { b.decoded_proof.number_of_proofs = 3; }],
    ['missing verified evidence', (b: any) => { delete b.decoded_proof; }],
    ['missing depth', (b: any) => { delete b.decoded_proof.proof_at_depth; }],
    ['nonboolean verdict', (b: any) => { b.valid = 'true'; }],
    ['negative height', (b: any) => { b.decoded_proof.asset.chain_anchor.block_height = -1; }],
    ['overflow output index', (b: any) => { b.decoded_proof.asset.chain_anchor.anchor_outpoint = tx.getId() + ':4294967296'; }],
    ['missing anchor transaction', (b: any) => { delete b.decoded_proof.asset.chain_anchor.anchor_tx; }],
    ['different anchor block', (b: any) => { b.decoded_proof.asset.chain_anchor.anchor_block_hash = '55'.repeat(32); }],
    ['wrong transaction ID', (b: any) => { b.decoded_proof.asset.chain_anchor.anchor_outpoint = '55'.repeat(32) + ':0'; }],
  ])('refuses %s as inconsistent source evidence', async (_label, mutate) => {
    const s = setup((path, body) => { if (path.endsWith('/verify')) mutate(body); return body; });
    expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ valid: false, stage: 'unavailable-verifier' });
  });
  it('distinguishes native invalid from wrong requested asset', async () => {
    const s = setup((p, b) => p.endsWith('/verify') ? { valid: false } : b);
    expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'invalid-proof' });
    expect(await s.authority.verifyProof('66'.repeat(32), encoded)).toMatchObject({ stage: 'asset-mismatch' });
  });
  it('does not interpret HTTP 500 as cryptographic invalidity or expose its body', async () => {
    const s = setup(); s.http.request = async () => ({ status: 500, body: { message: encoded } });
    const result = await s.authority.verifyProof(id, encoded);
    expect(result).toMatchObject({ stage: 'unavailable-verifier' }); expect(JSON.stringify(result)).not.toContain(encoded);
  });
  it.each(['genesis', 'transaction', 'header', 'checkpoint'])('refuses owned %s mismatch', async kind => {
    const s = setup(undefined, (method, result, count) => {
      if (kind === 'genesis' && method === 'getblockhash' && result === SPV_GENESIS.signet) return '66'.repeat(32);
      if (kind === 'transaction' && method === 'getrawtransaction') return '00';
      if (kind === 'header' && method === 'getblockheader') return { ...result, confirmations: -1 };
      if (kind === 'checkpoint' && method === 'getblockchaininfo' && count > 1) return { ...result, bestblockhash: '66'.repeat(32) };
      return result;
    });
    expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'unavailable-verifier' });
  });
  it('rejects a daemon network switch during proof verification', async () => {
    let infos = 0; const s = setup((p, b) => { if (p.endsWith('getinfo') && ++infos > 1) b.network = 'mainnet'; return b; });
    expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'unavailable-verifier' });
  });
  it('refreshes listing network instead of caching a previous source forever', async () => {
    let infos = 0; const s = setup((p, b) => { if (p.endsWith('getinfo') && ++infos > 1) b.network = 'mainnet'; return b; });
    expect(await s.authority.listAssets()).toEqual([]);
    await expect(s.authority.listAssets()).rejects.toMatchObject({ code: 'network-mismatch' });
  });
  it.each(['Zh==', 'Zg=', ' ', 'not base64!'])('rejects noncanonical base64 %s before submitting it', async input => {
    const s = setup(); expect(await s.service.$verifyProof(id, input)).toMatchObject({ stage: 'invalid-input' }); expect(s.calls).toHaveLength(0);
  });
  it('bounds hostile RFQ decimal scale', async () => {
    const s = setup((p, b) => p.endsWith('peeraccepted') ? { buy_quotes: [{ id: 'quote', expiry: '1757400000', asset_spec: { id }, ask_asset_rate: { coefficient: '1', scale: 0x7fffffff } }], sell_quotes: [] } : b);
    await expect(s.authority.getRfqQuotes()).rejects.toMatchObject({ code: 'unavailable-universe' });
  });
});
describe('tapd credential transport configuration', () => {
  it('accepts a certificate authenticated origin and absent source', () => {
    expect(tapdConfigFromEnvironment({})).toBeNull();
    expect(tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: 'https://127.0.0.1:8089/', UNIVERSE_TAPD_MACAROON_HEX: 'abcd' })?.origin).toBe('https://127.0.0.1:8089');
  });
  it.each(['https://user:secret@example.org', 'https://example.org/path', 'https://example.org/?secret=x', 'http://example.org', 'not a URL'])('rejects unsafe origin without echoing it', origin => {
    expect(() => tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: origin, UNIVERSE_TAPD_MACAROON_HEX: 'abcd' })).toThrow();
  });
  it('rejects odd-length macaroon hex', () => {
    expect(() => tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: 'https://localhost', UNIVERSE_TAPD_MACAROON_HEX: 'abc' })).toThrow(/macaroon/);
  });
});

describe('typed owned listings without manufactured proof availability', () => {
  const asset = () => ({ asset_genesis: { asset_id: id, genesis_point: genesis, name: 'owned fixture', asset_type: 'NORMAL' },
    amount: '18446744073709551615', script_key: '02' + '11'.repeat(32), prev_witnesses: [{}],
    chain_anchor: { anchor_outpoint: tx.getId() + ':0', block_height: 100, block_timestamp: '1757400000' } });
  it('preserves exact uint64 amounts and unknown proof availability', async () => {
    const s = setup((p, b) => p.includes('assets?') ? { assets: [asset()] } : b);
    expect(await s.authority.listAssets()).toEqual([expect.objectContaining({ assetId: id, totalAmountAtomic: '18446744073709551615', hasProofFile: null, genesisHeight: null })]);
  });
  it.each(['-1', '18446744073709551616', '1e3', undefined])('rejects malformed amount %s instead of inventing zero', async amount => {
    const s = setup((p, b) => p.includes('assets?') ? { assets: [{ ...asset(), amount }] } : b);
    await expect(s.authority.listAssets()).rejects.toMatchObject({ code: 'unavailable-universe' });
  });
  it('reads valid groups and exact finite rates', async () => {
    const s = setup((p, b) => p.endsWith('/groups') ? { groups: { ['02' + id]: { assets: [{ id, amount: '42', tag: 'asset' }] } } }
      : p.endsWith('peeraccepted') ? { buy_quotes: [{ id: 'quote', expiry: '1757400000', asset_spec: { id }, ask_asset_rate: { coefficient: '12345', scale: 2 } }], sell_quotes: [] } : b);
    expect(await s.authority.listGroups()).toEqual([{ groupKey: '02' + id, name: 'asset', totalAssetsCount: 1, totalCirculatingSupplyAtomic: '42' }]);
    expect(await s.authority.getRfqQuotes()).toEqual([expect.objectContaining({ askRate: '123.45', validUntil: 1757400000 })]);
  });
});

describe('native rejection source binding', () => {
  it('does not publish native false after a daemon network switch', async () => {
    let infos = 0;
    const s = setup((p, b) => {
      if (p.endsWith('getinfo') && ++infos > 1) b.network = 'mainnet';
      return p.endsWith('/verify') ? { valid: false } : b;
    });
    expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'unavailable-verifier' });
  });
});

describe('proof resource bounds', () => {
  it('keeps concurrency slots occupied after the caller deadline until I/O settles', async () => {
    jest.useFakeTimers();
    const s = setup(); const original = s.http.request;
    let finish!: (response: { status: number; body: unknown }) => void;
    const pending = new Promise<{ status: number; body: unknown }>(resolve => { finish = resolve; });
    s.http.request = async () => pending;
    try {
      const first = s.authority.verifyProof(id, encoded), second = s.authority.verifyProof(id, encoded);
      await jest.advanceTimersByTimeAsync(45000);
      expect(await first).toMatchObject({ stage: 'unavailable-verifier', error: expect.stringContaining('deadline') });
      expect(await second).toMatchObject({ stage: 'unavailable-verifier', error: expect.stringContaining('deadline') });
      expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'unavailable-verifier', error: expect.stringContaining('busy') });
      finish({ status: 503, body: {} });
      await jest.advanceTimersByTimeAsync(0);
      s.http.request = original;
      expect(await s.authority.verifyProof(id, encoded)).toMatchObject({ stage: 'verified' });
    } finally { finish({ status: 503, body: {} }); jest.useRealTimers(); }
  });
});
