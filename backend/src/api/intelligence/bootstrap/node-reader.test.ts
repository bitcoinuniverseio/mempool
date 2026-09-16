import { BootstrapNodeReader } from './node-reader';
import { BootstrapService } from './bootstrap.service';

const tip = '11'.repeat(32),
  base = '22'.repeat(32),
  genesis = '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206';
function fixture() {
  const info = {
    chain: 'regtest',
    blocks: 204,
    headers: 204,
    bestblockhash: tip,
    initialblockdownload: false,
    size_on_disk: 100000,
  };
  const state = {
    blocks: 204,
    bestblockhash: tip,
    verificationprogress: 1,
    validated: true,
    coins_db_cache_bytes: 1000,
    coins_tip_cache_bytes: 2000,
  };
  const states = { headers: 204, chainstates: [state] };
  const call = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockhash') return params[0] === 0 ? genesis : base;
    if (method === 'getblockchaininfo') return info;
    if (method === 'getnetworkinfo')
      return { version: 290000, subversion: '/Satoshi:29.0.0/' };
    if (method === 'getchainstates') return states;
    if (method === 'help')
      return 'dumptxoutset "path"\nloadtxoutset "path"\ngetchainstates';
    if (method === 'getbestblockhash') return tip;
    if (method === 'getblockheader')
      return { height: 100, hash: base, confirmations: 105 };
    throw Error('Unexpected RPC');
  });
  return {
    info,
    state,
    states,
    call,
    reader: new BootstrapNodeReader({ network: 'regtest', call }),
  };
}
describe('Owned bootstrap chainstates', () => {
  it('reports actual Core capabilities and validated chainstate without invented snapshot pins or ETA', async () => {
    const f = fixture(),
      r = await f.reader.read();
    expect(r.capability).toMatchObject({
      supports_loadtxoutset: true,
      compiled_assumeutxo_heights: null,
      current_phase: 'fully_validated',
    });
    expect(r.observation).toMatchObject({
      tip_height: 204,
      background_ibd_height: null,
      snapshot_chainstate_height: null,
      estimated_time_to_validation_completion_sec: null,
    });
    expect(
      f.call.mock.calls.every(
        ([method]) => !['loadtxoutset', 'dumptxoutset'].includes(method)
      )
    ).toBe(true);
  });
  it('distinguishes validated history from IBD still syncing', async () => {
    const f = fixture();
    f.info.initialblockdownload = true;
    f.info.headers = 205;
    f.states.headers = 205;
    expect((await f.reader.read()).observation.current_phase).toBe(
      'traditional_ibd'
    );
  });
  it('reads background work and resolves actual snapshot base height', async () => {
    const f = fixture();
    Object.assign(f.state, { snapshot_blockhash: base, validated: false });
    f.states.chainstates.unshift({
      ...f.state,
      blocks: 80,
      bestblockhash: '33'.repeat(32),
      snapshot_blockhash: undefined,
      validated: true,
    } as any);
    expect((await f.reader.read()).observation).toMatchObject({
      current_phase: 'background_validation',
      background_chainstate: { height: 80, target_height: 100 },
    });
  });
  it.each(['network', 'tip', 'height', 'progress', 'validated', 'headers'])(
    'rejects inconsistent %s evidence',
    async (kind) => {
      const f = fixture();
      if (kind === 'network') f.info.chain = 'main';
      if (kind === 'tip') f.state.bestblockhash = base;
      if (kind === 'height') f.state.blocks = 203;
      if (kind === 'progress') f.state.verificationprogress = NaN;
      if (kind === 'validated') (f.state as any).validated = 'true';
      if (kind === 'headers') f.states.headers = 205;
      await expect(f.reader.read()).rejects.toThrow();
    }
  );
  it('deduplicates concurrent probes and independently reports unavailable snapshot catalogue', async () => {
    const f = fixture();
    await Promise.all([f.reader.read(), f.reader.read()]);
    expect(
      f.call.mock.calls.filter(([m]) => m === 'getchainstates')
    ).toHaveLength(1);
    const service = new BootstrapService(f.reader),
      overview = await service.getOverview();
    expect(overview).toMatchObject({
      configured_nodes_count: 1,
      total_snapshots: null,
      snapshot_catalogue_status: 'unavailable',
    });
    expect(await service.getNodeChainstates('invented')).toBeUndefined();
  });
});
