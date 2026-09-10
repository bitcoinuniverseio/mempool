import { TapdAuthority, TapdHttp, tapdConfigFromEnvironment } from './taproot-assets.authority';
import { TaprootAssetsService } from './taproot-assets.service';

const ASSET_ID = '4a19b872019842fbc9e19842a98712344a19b872019842fbc9e19842a9871234';
const ANCHOR_HASH = '00000010' + 'ab'.repeat(28);
const GENESIS_POINT = 'e3'.repeat(32) + ':0';

/** A tapd on Signet holding one minted asset and one transferred asset, answering its documented REST shapes. */
function fakeTapd(overrides: Partial<Record<string, (body?: unknown) => { status: number; body: unknown }>> = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const answers: Record<string, (body?: unknown) => { status: number; body: unknown }> = {
    'GET /v1/taproot-assets/getinfo': () => ({ status: 200, body: { version: '0.6.0', network: 'signet' } }),
    'GET /v1/taproot-assets/assets?include_leased=true': () => ({ status: 200, body: { assets: [
      { asset_genesis: { genesis_point: GENESIS_POINT, name: 'universe-signet-test', asset_id: ASSET_ID, asset_type: 'NORMAL', output_index: 0 },
        amount: '1000', script_key: '02' + 'cd'.repeat(32), asset_group: null, prev_witnesses: [],
        chain_anchor: { anchor_outpoint: 'f1'.repeat(32) + ':1', anchor_block_hash: ANCHOR_HASH, block_height: 234000, block_timestamp: '1757400000' } },
      { asset_genesis: { genesis_point: 'a1'.repeat(32) + ':0', name: 'moved', asset_id: 'ef'.repeat(32), asset_type: 'COLLECTIBLE' },
        amount: '1', script_key: '03' + '11'.repeat(32), asset_group: { tweaked_group_key: '02' + '22'.repeat(32) }, prev_witnesses: [{}],
        chain_anchor: { anchor_outpoint: 'f2'.repeat(32) + ':0', anchor_block_hash: 'cc'.repeat(32), block_height: 234100, block_timestamp: '1757410000' } },
    ], unconfirmed_transfers: '0', unconfirmed_mints: '0' } }),
    'GET /v1/taproot-assets/assets/groups': () => ({ status: 200, body: { groups: { ['02' + '22'.repeat(32)]: { assets: [
      { id: 'ef'.repeat(32), amount: '1', tag: 'moved', type: 'COLLECTIBLE' }, { id: 'ee'.repeat(32), amount: '4', tag: 'moved', type: 'COLLECTIBLE' } ] } } } }),
    'GET /v1/taproot-assets/rfq/quotes/peeraccepted': () => ({ status: 200, body: {
      buy_quotes: [{ peer: 'p', id: 'q1', asset_spec: { id: ASSET_ID }, ask_asset_rate: { coefficient: '12345', scale: 2 }, expiry: '1757500000' }],
      sell_quotes: [{ peer: 'p', id: 'q2', asset_spec: { group_pub_key: '02' + '22'.repeat(32) }, bid_asset_rate: { coefficient: '5', scale: 3 }, expiry: 1757500100 }],
    } }),
    'POST /v1/taproot-assets/proofs/decode': () => ({ status: 200, body: { decoded_proof: { number_of_proofs: 2, asset: {
      asset_genesis: { genesis_point: GENESIS_POINT, asset_id: ASSET_ID }, chain_anchor: { anchor_outpoint: 'f1'.repeat(32) + ':1', anchor_block_hash: ANCHOR_HASH, block_height: 234000 } } } } }),
    'POST /v1/taproot-assets/proofs/verify': () => ({ status: 200, body: { valid: true, decoded_proof: { number_of_proofs: 2, asset: {
      asset_genesis: { genesis_point: GENESIS_POINT, asset_id: ASSET_ID }, chain_anchor: { anchor_outpoint: 'f1'.repeat(32) + ':1', anchor_block_hash: ANCHOR_HASH, block_height: 234000 } } } } }),
    ...overrides,
  };
  const http: TapdHttp = {
    async request(method, path, body) {
      calls.push({ method, path, body });
      const answer = answers[`${method} ${path}`];
      if (!answer) {throw new Error(`unexpected tapd request ${method} ${path}`);}
      return answer(body);
    },
  };
  return { http, calls };
}

const owned = { $getBlockHash: async (height: number) => height === 234000 ? ANCHOR_HASH : 'ff'.repeat(32) };

describe('TapdAuthority', () => {
  it('reads assets, groups and quotes from the owned tapd on the same network', async () => {
    const tapd = fakeTapd();
    const authority = new TapdAuthority('signet', tapd.http, owned);
    const assets = await authority.listAssets();
    expect(assets).toEqual([
      expect.objectContaining({ assetId: ASSET_ID, assetType: 'normal', name: 'universe-signet-test', genesisPoint: GENESIS_POINT, genesisHeight: 234000,
        totalAmountAtomic: '1000', anchorTxid: 'f1'.repeat(32), anchorOutpoint: 'f1'.repeat(32) + ':1', mintTime: 1757400000, groupKey: undefined }),
      expect.objectContaining({ assetId: 'ef'.repeat(32), assetType: 'collectible', genesisHeight: null, groupKey: '02' + '22'.repeat(32), totalAmountAtomic: '1' }),
    ]);
    expect(await authority.getAsset(ASSET_ID.toUpperCase())).toMatchObject({ assetId: ASSET_ID });
    expect(await authority.getAsset('ab'.repeat(32))).toBeNull();
    expect(await authority.listGroups()).toEqual([{ groupKey: '02' + '22'.repeat(32), name: 'moved', totalAssetsCount: 2, totalCirculatingSupplyAtomic: '5' }]);
    expect(await authority.getRfqQuotes()).toEqual([
      { quoteId: 'q1', baseAsset: ASSET_ID, quoteAsset: 'BTC', askRate: '123.45', bidRate: null, spreadBps: null, validUntil: 1757500000 },
      { quoteId: 'q2', baseAsset: '02' + '22'.repeat(32), quoteAsset: 'BTC', askRate: null, bidRate: '0.005', spreadBps: null, validUntil: 1757500100 },
    ]);
    // The network was checked once, before the first read.
    expect(tapd.calls.filter(call => call.path.endsWith('/getinfo'))).toHaveLength(1);
    expect(tapd.calls[0].path).toBe('/v1/taproot-assets/getinfo');
  });

  it('refuses a tapd on another network before reading anything from it', async () => {
    const tapd = fakeTapd({ 'GET /v1/taproot-assets/getinfo': () => ({ status: 200, body: { version: '0.6.0', network: 'mainnet' } }) });
    const authority = new TapdAuthority('signet', tapd.http, owned);
    await expect(authority.listAssets()).rejects.toMatchObject({ code: 'network-mismatch' });
    expect(tapd.calls.map(call => call.path)).toEqual(['/v1/taproot-assets/getinfo']);
  });

  it('reports an unreachable or malformed tapd as unavailable, never as an empty directory', async () => {
    const down: TapdHttp = { async request() { throw new Error('connect ECONNREFUSED 127.0.0.1:8089'); } };
    await expect(new TapdAuthority('signet', down, owned).listAssets()).rejects.toMatchObject({ code: 'unavailable-universe', message: expect.stringContaining('ECONNREFUSED') });
    const malformed = fakeTapd({ 'GET /v1/taproot-assets/assets?include_leased=true': () => ({ status: 200, body: { unexpected: true } }) });
    await expect(new TapdAuthority('signet', malformed.http, owned).listAssets()).rejects.toMatchObject({ code: 'unavailable-universe' });
    const denied = fakeTapd({ 'GET /v1/taproot-assets/assets/groups': () => ({ status: 401, body: { message: 'permission denied' } }) });
    await expect(new TapdAuthority('signet', denied.http, owned).listGroups()).rejects.toMatchObject({ code: 'unavailable-universe', message: expect.stringContaining('permission denied') });
  });

  it('verifies a proof only when tapd accepts it and the anchor is the owned chain block', async () => {
    const tapd = fakeTapd();
    const authority = new TapdAuthority('signet', tapd.http, owned);
    const proof = Buffer.from('proof-file').toString('base64');
    expect(await authority.verifyProof(ASSET_ID, proof)).toEqual({
      valid: true, stage: 'verified', asset_id: ASSET_ID, genesis_point: GENESIS_POINT, proofs_in_file: 2,
      anchor: { txid: 'f1'.repeat(32), outpoint: 'f1'.repeat(32) + ':1', block_height: 234000, block_hash: ANCHOR_HASH },
    });
    const verify = tapd.calls.find(call => call.path.endsWith('/proofs/verify'));
    expect(verify?.body).toEqual({ raw_proof_file: proof, genesis_point: GENESIS_POINT });
  });

  it.each([
    ['a proof for another asset', {}, 'ab'.repeat(32), 'asset-mismatch'],
    ['a proof tapd cannot decode', { 'POST /v1/taproot-assets/proofs/decode': () => ({ status: 400, body: { message: 'unable to decode proof' } }) }, ASSET_ID, 'invalid-proof'],
    ['a proof file tapd finds invalid', { 'POST /v1/taproot-assets/proofs/verify': () => ({ status: 200, body: { valid: false } }) }, ASSET_ID, 'invalid-proof'],
    ['an anchor the owned chain does not have', { 'POST /v1/taproot-assets/proofs/verify': () => ({ status: 200, body: { valid: true, decoded_proof: { asset: {
      asset_genesis: { genesis_point: GENESIS_POINT, asset_id: ASSET_ID }, chain_anchor: { anchor_outpoint: 'f1'.repeat(32) + ':1', anchor_block_hash: 'dd'.repeat(32), block_height: 234000 } } } } }) }, ASSET_ID, 'anchor-mismatch'],
  ])('rejects %s distinctly', async (_label, overrides, assetId, stage) => {
    const tapd = fakeTapd(overrides as Parameters<typeof fakeTapd>[0]);
    const verdict = await new TapdAuthority('signet', tapd.http, owned).verifyProof(assetId, Buffer.from('x').toString('base64'));
    expect(verdict).toMatchObject({ valid: false, stage });
  });

  it('answers unavailable-verifier when the owned reader cannot serve the anchor height', async () => {
    const tapd = fakeTapd();
    const authority = new TapdAuthority('signet', tapd.http, { $getBlockHash: async () => { throw new Error('reader down'); } });
    expect(await authority.verifyProof(ASSET_ID, Buffer.from('x').toString('base64'))).toMatchObject({ valid: false, stage: 'unavailable-verifier', error: expect.stringContaining('reader down') });
  });
});

describe('TaprootAssetsService with an owned tapd', () => {
  it('serves reads and verdicts through the authority and keeps offers unavailable', async () => {
    const tapd = fakeTapd();
    const service = new TaprootAssetsService({ authority: new TapdAuthority('signet', tapd.http, owned) });
    expect(await service.$getAssets()).toHaveLength(2);
    expect(await service.$getGroups()).toHaveLength(1);
    expect(await service.$getRfqQuotes()).toHaveLength(2);
    expect(await service.$getAsset('ab'.repeat(32))).toBeNull();
    await expect(service.$getAsset('not-hex')).rejects.toMatchObject({ code: 'invalid-input', status: 400 });
    await expect(service.$getOffers()).rejects.toMatchObject({ code: 'unavailable-offer-source', status: 503 });
    expect(await service.$verifyProof(ASSET_ID, Buffer.from('proof-file').toString('base64'))).toMatchObject({ valid: true, stage: 'verified' });
    expect(await service.$verifyProof(ASSET_ID, 'not base64!')).toMatchObject({ valid: false, stage: 'invalid-input' });
  });

  it('maps a tapd outage to unavailable answers', async () => {
    const down: TapdHttp = { async request() { throw new Error('ECONNREFUSED'); } };
    const service = new TaprootAssetsService({ authority: new TapdAuthority('signet', down, owned) });
    await expect(service.$getAssets()).rejects.toMatchObject({ code: 'unavailable-universe', status: 503 });
    expect(await service.$verifyProof(ASSET_ID, Buffer.from('x').toString('base64'))).toMatchObject({ valid: false, stage: 'unavailable-verifier' });
  });
});

describe('tapd configuration', () => {
  it('is absent without an origin and validates what is named', () => {
    expect(tapdConfigFromEnvironment({})).toBeNull();
    expect(tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: 'https://127.0.0.1:8089/', UNIVERSE_TAPD_MACAROON_HEX: 'abcd', UNIVERSE_TAPD_TLS_CERT_PATH: '/etc/tapd/tls.cert' }))
      .toEqual({ origin: 'https://127.0.0.1:8089', macaroonHex: 'abcd', tlsCertPath: '/etc/tapd/tls.cert' });
    expect(() => tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: 'https://127.0.0.1:8089' })).toThrow(/macaroon/);
    expect(() => tapdConfigFromEnvironment({ UNIVERSE_TAPD_ORIGIN: 'not a url', UNIVERSE_TAPD_MACAROON_HEX: 'ab' })).toThrow(/URL/);
  });
});
