import { LiquidNativeReader, LiquidPairedSource, LiquidPairProfile, LiquidRpcReader, validateLiquidPairProfile } from './liquid-paired-source';

// Controlled native-contract regressions. These do not claim a mounted live Liquid journey.
const profile: LiquidPairProfile = {
  schema: 'universe-liquid-pair-profile-v1', network: 'elementsregtest', parentNetwork: 'regtest',
  elementsGenesis: 'cd179c84c35f51825f20a3b91a18d45f0c53b5ceb744a5b6ef8f0babe809396f',
  parentGenesis: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
  policyAsset: 'b2e15d0d7a0c94e4e2ce0fe6e8691b9e451377f6e46e8045a86f7c4b5d4f0f23',
  elementsVersion: 230304, parentVersion: 300300,
  elementsSourceRevision: 'ca172806f66f03712b1050f7ee0020fd588a30bb', parentSourceRevision: '49faec4f87f5cd19c88db01a82e5c68b087c8227',
  epochLength: 10, peginConfirmationDepth: 10,
};
function fixture() {
  const e: any = { chain: 'elementsregtest', blocks: 3, bestblockhash: 'a'.repeat(64), initialblockdownload: false,
    epoch_length: 10, epoch_age: 3, current_params_root: 'c'.repeat(64), current_signblock_hex: '51', current_fedpeg_script: '51', current_fedpeg_program: '51' };
  const p: any = { chain: 'regtest', blocks: 113, bestblockhash: 'b'.repeat(64), initialblockdownload: false };
  const sidechain: any = { parent_blockhash: profile.parentGenesis, pegged_asset: profile.policyAsset, pegin_confirmation_depth: 10 };
  const header: any = { hash: e.bestblockhash, height: e.blocks, dynamic_parameters: { current: { root: e.current_params_root } } };
  let eReads = 0, pReads = 0;
  const after: { elements?: any; parent?: any } = {};
  const elements = { call: jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockchaininfo') return { ...(++eReads > 1 && after.elements || e) };
    if (method === 'getblockhash') return params[0] === 0 ? profile.elementsGenesis : e.bestblockhash;
    if (method === 'getsidechaininfo') return sidechain;
    if (method === 'getnetworkinfo') return { version: profile.elementsVersion };
    if (method === 'getblockheader') return header;
    throw Error('Unexpected source method');
  }) };
  const parent = { call: jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockchaininfo') return { ...(++pReads > 1 && after.parent || p) };
    if (method === 'getblockhash') return params[0] === 0 ? profile.parentGenesis : p.bestblockhash;
    if (method === 'getnetworkinfo') return { version: profile.parentVersion };
    throw Error('Unexpected parent method');
  }) };
  return { e, p, sidechain, header, after, elements, parent, source: new LiquidPairedSource(profile, elements, parent) };
}
const observe = (f: ReturnType<typeof fixture>) => f.source.observe(new AbortController().signal);
describe('Liquid native pair binding', () => {
  it('independently proves both genesis and tip hashes without equating chain heights or inventing metrics', async () => {
    const f = fixture(), view = await observe(f);
    expect(view.elements.height).toBe(3); expect(view.parent.height).toBe(113);
    expect(f.elements.call).toHaveBeenCalledWith('getblockhash', [0], expect.anything());
    expect(f.parent.call).toHaveBeenCalledWith('getblockhash', [113], expect.anything());
    expect(view).not.toHaveProperty('reserveSats'); expect(view.federation).not.toHaveProperty('signersOnline');
  });
  it.each(['elements', 'parent'] as const)('rejects missing and true IBD on %s', async kind => {
    for (const value of [undefined, true]) { const f = fixture(); (kind === 'elements' ? f.e : f.p).initialblockdownload = value; await expect(observe(f)).rejects.toMatchObject({ code: 'invalid-liquid-pair' }); }
  });
  it('rejects a wrong parent network before any further source IO', async () => {
    const f = fixture(); f.p.chain = 'main'; await expect(observe(f)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
    expect(f.elements.call.mock.calls).toHaveLength(1); expect(f.parent.call.mock.calls).toHaveLength(1);
  });
  it.each(['parent_blockhash', 'pegged_asset', 'pegin_confirmation_depth'])('rejects incompatible consensus field %s', async field => {
    const f = fixture(); f.sidechain[field] = field === 'pegin_confirmation_depth' ? 9 : 'd'.repeat(64);
    await expect(observe(f)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
  });
  it('rejects header policy-root contradiction at an otherwise matching block hash', async () => {
    const f = fixture(); f.header.dynamic_parameters.current.root = 'd'.repeat(64);
    await expect(observe(f)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
  });
  it.each(['elements', 'parent'] as const)('rejects a changed %s checkpoint after acquisition', async kind => {
    const f = fixture(); f.after[kind] = { ...(kind === 'elements' ? f.e : f.p), bestblockhash: 'e'.repeat(64) };
    await expect(observe(f)).rejects.toMatchObject({ code: 'liquid-pair-changed', status: 409 });
  });
  it('does not dispatch more reads after an ignored-signal initial reply arrives late', async () => {
    const f = fixture(), controller = new AbortController();
    const elements: LiquidNativeReader = { call: jest.fn(async () => { controller.abort(); return f.e; }) };
    const source = new LiquidPairedSource(profile, elements, f.parent);
    await expect(source.observe(controller.signal)).rejects.toMatchObject({ code: 'liquid-source-deadline' });
    expect(elements.call).toHaveBeenCalledTimes(1); expect(f.parent.call).toHaveBeenCalledTimes(1);
  });
  it('retains a normalized immutable profile rather than an externally mutable object', () => {
    const input = { ...profile }, source = new LiquidPairedSource(input); input.parentGenesis = 'e'.repeat(64);
    expect(source.profile.parentGenesis).toBe(profile.parentGenesis); expect(Object.isFrozen(source.profile)).toBe(true);
  });
  it.each([{ ...profile, elementsGenesis: [profile.elementsGenesis] }, { ...profile, parentNetwork: 'main' }, { ...profile, epochLength: 0 }])('rejects malformed configuration shape', value => {
    expect(() => validateLiquidPairProfile(value)).toThrow();
  });
  it('denies any write method before reading credentials or opening a native transport', async () => {
    await expect(new LiquidRpcReader('elements').call('sendrawtransaction', ['00'], new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-liquid-pair' });
  });
});
