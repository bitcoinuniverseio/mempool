jest.mock('../../bitcoin/bitcoin-client', () => ({ __esModule: true, default: { rpc: { call: jest.fn() } } }));
jest.mock('../../mempool-blocks', () => ({ __esModule: true, default: { getMempoolBlocksWithTransactions: () => [] } }));
import config from '../../../config';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import { eventBus } from '../events/intelligence-event-bus';
import { templateCollectorService as collector } from './template-collector.service';

const parent = 'a'.repeat(64), genesis = 'b'.repeat(64), blockOne = 'c'.repeat(64);
const originalNetwork = config.MEMPOOL.NETWORK;
const gbt = () => ({ height: 100, previousblockhash: parent, transactions: [], coinbasevalue: 5000 });
describe('captured native template context and honest projection weight', () => {
  beforeEach(() => {
    config.MEMPOOL.NETWORK = 'mainnet'; collector.resetForTests(); collector.readProjection = () => null;
    collector.fetchCoreTemplate = async () => gbt();
    (bitcoinClient.rpc.call as jest.Mock).mockReset().mockImplementation(async (method: string, args: number[]) => {
      if (method === 'getblockchaininfo') return { chain: 'main', blocks: 99, bestblockhash: parent, initialblockdownload: false };
      if (method === 'getblockhash') return args[0] === 0 ? genesis : args[0] === 1 ? blockOne : parent;
      throw new Error('Unexpected native method');
    });
  });
  afterEach(() => { config.MEMPOOL.NETWORK = originalNetwork; });
  it('binds collection to independently read native identity and the exact GBT parent', async () => {
    const template = await collector.collectCoreTemplate();
    expect(template).toMatchObject({ configured_network: 'mainnet', observation_context: {
      schema: 'universe-template-observation-context-v1', chain: 'bitcoin', network: 'mainnet', genesis_hash: genesis,
      block_one_hash: blockOne, signet_challenge: null, checkpoint: { height: 99, block_hash: parent },
      provenance: 'bitcoin-core-gbt', input_core_template_id: null,
    } });
    expect((bitcoinClient.rpc.call as jest.Mock).mock.calls.filter(c => c[0] === 'getblockchaininfo')).toHaveLength(2);
  });
  it('does not relabel a captured template when the configured selector changes', async () => {
    const template = await collector.collectCoreTemplate(); config.MEMPOOL.NETWORK = 'signet';
    expect(collector.getTemplateById(template!.template_id)).toMatchObject({ configured_network: 'mainnet', observation_context: { network: 'mainnet' } });
  });
  it('does not claim virtual size multiplied by four is measured native transaction weight', async () => {
    await collector.collectCoreTemplate(); collector.readProjection = () => ({ transactionIds: [], totalFees: 0, blockVSize: 101, nTx: 0 });
    expect(await collector.collectProjection()).toMatchObject({ total_weight: null, estimated_weight: 404, weight_basis: 'vsize-derived-estimate' });
  });
  it('does not expose private RPC locations or guessed software versions', () => {
    expect(collector.getSources().every(source => source.endpoint === null && source.software_version === null)).toBe(true);
  });
  it('refuses a GBT parent that differs from the independently observed native tip', async () => {
    collector.fetchCoreTemplate = async () => ({ ...gbt(), previousblockhash: 'd'.repeat(64) });
    expect(await collector.collectCoreTemplate()).toBeNull(); expect(collector.getTemplatesForHeight()).toEqual([]);
  });
  it.each([
    { chain: 'signet', blocks: 99, bestblockhash: parent, initialblockdownload: false },
    { chain: 'main', blocks: 99, bestblockhash: parent, initialblockdownload: true },
    { chain: 'main', blocks: 99, bestblockhash: parent },
  ])('refuses foreign or unready native identity before fetching GBT: %j', async info => {
    const fetch = jest.fn(async () => gbt()); collector.fetchCoreTemplate = fetch;
    (bitcoinClient.rpc.call as jest.Mock).mockResolvedValue(info);
    expect(await collector.collectCoreTemplate()).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses tip movement between independent source reads without publishing', async () => {
    const native = bitcoinClient.rpc.call as jest.Mock;
    native.mockImplementation(async (method: string, args: number[]) => method === 'getblockchaininfo'
      ? { chain: 'main', blocks: native.mock.calls.filter(c => c[0] === method).length === 1 ? 99 : 100, bestblockhash: parent, initialblockdownload: false }
      : args[0] === 0 ? genesis : args[0] === 1 ? blockOne : parent);
    expect(await collector.collectCoreTemplate()).toBeNull(); expect(collector.getTemplatesForHeight()).toHaveLength(0);
  });
  it('distinguishes unmeasured projection weight from measured Core weight for a comparable pair', async () => {
    const a = await collector.collectCoreTemplate();
    collector.readProjection = () => ({ transactionIds: [], totalFees: 5, blockVSize: 101, nTx: 0 });
    const b = await collector.collectProjection();
    expect(b?.observation_context).toMatchObject({ provenance: 'backend-mempool-projection', input_core_template_id: a!.template_id });
    expect(collector.computeTemplateDiff(a!.template_id, b!.template_id)).toMatchObject({ comparison_context: 'same-observed-context', fee_delta_sats: 5, weight_delta: null });
  });
  it('withholds numeric deltas for templates captured on different observed parents', async () => {
    const a = await collector.collectCoreTemplate();
    const next = 'd'.repeat(64);
    collector.fetchCoreTemplate = async () => ({ ...gbt(), height: 101, previousblockhash: next });
    (bitcoinClient.rpc.call as jest.Mock).mockImplementation(async (method: string, args: number[]) => method === 'getblockchaininfo'
      ? { chain: 'main', blocks: 100, bestblockhash: next, initialblockdownload: false }
      : args[0] === 0 ? genesis : args[0] === 1 ? blockOne : next);
    const b = await collector.collectCoreTemplate();
    expect(collector.computeTemplateDiff(a!.template_id, b!.template_id)).toMatchObject({ comparison_context: 'different-observed-context', fee_delta_sats: null, weight_delta: null });
  });
  it('keeps retained history immutable through returned objects and block observations', async () => {
    const a = await collector.collectCoreTemplate(); a!.txids.push('e'.repeat(64));
    expect(collector.getTemplateById(a!.template_id)?.txids).toEqual([]);
    collector.observeBlock({ height: 100, id: 'd'.repeat(64), previousblockhash: parent, extras: { totalFees: 0 } } as any, []);
    expect(collector.getCurrentObservationContext()).toBeNull();
    expect(collector.getTemplateById(a!.template_id)?.observation_context?.checkpoint.block_hash).toBe(parent);
  });
  it.each([undefined, -1, NaN, 1.5])('rejects unmeasured or invalid native transaction weight %s', async weight => {
    collector.fetchCoreTemplate = async () => ({ ...gbt(), transactions: [{ txid: 'e'.repeat(64), hash: 'e'.repeat(64), fee: 1, weight: weight as number }] });
    expect(await collector.collectCoreTemplate()).toBeNull(); expect(collector.getTemplatesForHeight()).toEqual([]);
  });
  it('rejects configured foreign Signet challenge before template IO', async () => {
    const prior = process.env.UNIVERSE_SIGNET_CHALLENGE;
    config.MEMPOOL.NETWORK = 'signet'; process.env.UNIVERSE_SIGNET_CHALLENGE = '51';
    const fetch = jest.fn(async () => gbt()); collector.fetchCoreTemplate = fetch;
    (bitcoinClient.rpc.call as jest.Mock).mockResolvedValue({ chain: 'signet', blocks: 99, bestblockhash: parent, initialblockdownload: false, signet_challenge: '52' });
    try { expect(await collector.collectCoreTemplate()).toBeNull(); expect(fetch).not.toHaveBeenCalled(); }
    finally { if (prior === undefined) delete process.env.UNIVERSE_SIGNET_CHALLENGE; else process.env.UNIVERSE_SIGNET_CHALLENGE = prior; }
  });
  it('stops new native calls and publication after an ignored cancellation reaches its deadline', async () => {
    jest.useFakeTimers();
    const prior = config.CORE_RPC.TIMEOUT; config.CORE_RPC.TIMEOUT = 10;
    let resolve!: (value: unknown) => void;
    (bitcoinClient.rpc.call as jest.Mock).mockImplementation(() => new Promise(r => { resolve = r; }));
    try {
      const pending = collector.collectCoreTemplate();
      jest.advanceTimersByTime(11); expect(await pending).toBeNull();
      resolve({ chain: 'main', blocks: 99, bestblockhash: parent, initialblockdownload: false });
      await Promise.resolve(); await Promise.resolve();
      expect(bitcoinClient.rpc.call).toHaveBeenCalledTimes(1); expect(collector.getTemplatesForHeight()).toEqual([]);
    } finally { config.CORE_RPC.TIMEOUT = prior; jest.useRealTimers(); }
  });
  it('retains acknowledged history without overwriting a tip observed during publication', async () => {
    let acknowledge!: (value: boolean) => void;
    let entered!: () => void;
    const publishing = new Promise<void>(resolve => { entered = resolve; });
    const publish = jest.spyOn(eventBus, 'publish').mockImplementation(() => { entered(); return new Promise<boolean>(resolve => { acknowledge = resolve; }); });
    try {
      const collecting = collector.collectCoreTemplate(); await publishing;
      collector.observeBlock({ height: 100, id: 'd'.repeat(64), previousblockhash: parent, extras: { totalFees: 0 } } as any, []);
      acknowledge(true); const historical = await collecting;
      expect(historical?.observation_context?.checkpoint.height).toBe(99);
      expect(collector.getTemplateById(historical!.template_id)).not.toBeNull();
      expect(collector.getCurrentObservationContext()).toBeNull();
      expect(collector.getSources()[0].status).toBe('degraded');
      collector.readProjection = () => ({ transactionIds: [], totalFees: 0, blockVSize: 0, nTx: 0 });
      expect(await collector.collectProjection()).toBeNull();
    } finally { publish.mockRestore(); }
  });
  it.each([
    () => { throw new Error('private projection path'); },
    () => ({ transactionIds: null, totalFees: 0, blockVSize: 0, nTx: 0 }),
    () => ({ transactionIds: [], totalFees: 0.1, blockVSize: 0, nTx: 0 }),
    () => ({ transactionIds: [], totalFees: 2100000000000001, blockVSize: 0, nTx: 0 }),
  ])('classifies thrown or malformed projections as unavailable without stale active status', async reader => {
    await collector.collectCoreTemplate(); collector.readProjection = reader as any;
    expect(await collector.collectProjection()).toBeNull();
    expect(collector.getSources()[1]).toMatchObject({ status: 'degraded' });
  });
  it.each(['coinbase', 'individual-fee', 'total-fees'])('rejects Bitcoin money-range overflow in %s before retention', async field => {
    collector.fetchCoreTemplate = async () => ({ ...gbt(), coinbasevalue: field === 'coinbase' ? 2100000000000001 : 5000,
      transactions: field === 'coinbase' ? [] : ['d', 'e'].map(id => ({ txid: id.repeat(64), hash: id.repeat(64), fee: field === 'individual-fee' ? 2100000000000001 : 1100000000000000, weight: 400 })) });
    expect(await collector.collectCoreTemplate()).toBeNull(); expect(collector.getTemplatesForHeight()).toEqual([]);
  });
});
