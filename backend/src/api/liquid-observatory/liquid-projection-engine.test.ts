import { LiquidProjectionEngine } from './liquid-projection-engine';
import { LiquidProjectionState } from './liquid-projection-store';
import { LiquidPairObservation } from './liquid-paired-source';

const hash = 'a'.repeat(64), second = 'b'.repeat(64), profile = 'c'.repeat(64);
function fixture(): any {
  let state: LiquidProjectionState = { schema: 'universe-liquid-public-projection-v2', profileSha256: profile, blocks: [], updatedAt: new Date().toISOString() };
  const observation: LiquidPairObservation = { profileSha256: profile, observedAt: new Date().toISOString(),
    elements: { height: 0, hash, genesis: hash, parametersRoot: hash, epochAge: 0, epochLength: 10 },
    parent: { height: 10, hash, genesis: hash }, federation: { signblockScript: '51', fedpegScript: '51', fedpegProgram: '51' },
    profile: { schema: 'universe-liquid-pair-profile-v1', network: 'elementsregtest', parentNetwork: 'regtest',
      elementsGenesis: hash, parentGenesis: hash, policyAsset: hash, elementsVersion: 230304, parentVersion: 300300,
      elementsSourceRevision: 'a'.repeat(40), parentSourceRevision: 'b'.repeat(40), epochLength: 10, peginConfirmationDepth: 10 } };
  const block = { height: 0, hash, time: 1, tx: [{ txid: hash, vin: [{ coinbase: '00' }], vout: [{ asset: hash, value: 0 }] }] };
  const header = { height: 0, hash, signblock_challenge: '51' };
  const source = { observe: jest.fn(async () => observation), elements: { call: jest.fn(async (method: string) => {
    if (method === 'getblockhash') return hash;
    if (method === 'getblockheader') return header;
    if (method === 'getblock') return block;
    throw new Error('unsupported');
  }) }, parent: { call: jest.fn() } };
  const store = { read: jest.fn(async () => structuredClone(state)), transaction: jest.fn(async (work: any) => {
    const next = await work(structuredClone(state)); state = next; return structuredClone(state);
  }) };
  return { source, store, observation, engine: new LiquidProjectionEngine(source, store), getState: () => state };
}
describe('bounded explicit Liquid projection engine', () => {
  test('ordinary read remains partial and does not silently scan history', async () => {
    const { engine, source, store } = fixture();
    const result = await engine.snapshot(new AbortController().signal);
    expect(result.status).toBe('PARTIAL');
    expect(result.progress.nextHeight).toBe(0);
    expect(source.elements.call).not.toHaveBeenCalled();
    expect(store.transaction).not.toHaveBeenCalled();
  });
  test('explicit page binds genesis and closes the observed pair', async () => {
    const { engine } = fixture();
    const result = await engine.advance(-1, null, new AbortController().signal);
    expect(result.status).toBe('COMPLETE_AT_OBSERVED_PAIR');
    expect(result.state.blocks[0].hash).toBe(hash);
    expect(result.progress.pageLimit).toBe(16);
  });
  test('lost-response cursor replay does not advance another page', async () => {
    const { engine, source } = fixture();
    await engine.advance(-1, null, new AbortController().signal);
    source.elements.call.mockClear();
    await expect(engine.advance(-1, null, new AbortController().signal)).rejects.toThrow('cursor already changed');
    expect(source.elements.call).not.toHaveBeenCalled();
  });
  test('changed source fence does not commit acquired blocks', async () => {
    const { engine, source, observation, getState } = fixture();
    source.observe.mockResolvedValueOnce(observation).mockResolvedValueOnce({ ...observation, parent: { height: 11, hash: second } });
    await expect(engine.advance(-1, null, new AbortController().signal)).rejects.toThrow('pair changed');
    expect(getState().blocks).toHaveLength(0);
  });
  test('deadline failure during block acquisition does not commit progress', async () => {
    const { engine, source, getState } = fixture();
    const controller = new AbortController();
    const original = source.elements.call.getMockImplementation();
    source.elements.call.mockImplementation(async (method: string) => { const result = await original(method); if (method === 'getblock') controller.abort(); return result; });
    await expect(engine.advance(-1, null, controller.signal)).rejects.toThrow('cancelled');
    expect(getState().blocks).toHaveLength(0);
  });
  test('wrong selected source cannot publish stored observations', async () => {
    const { engine, source, observation } = fixture();
    source.observe.mockResolvedValue({ ...observation, profileSha256: second });
    await expect(engine.snapshot(new AbortController().signal)).rejects.toThrow('pair changed');
  });
  test('a single page cannot retain oversized public evidence before the durable byte guard', async () => {
    const { engine, source, getState } = fixture();
    const original = source.elements.call.getMockImplementation();
    source.elements.call.mockImplementation(async (method: string) => {
      const value = await original(method);
      if (method === 'getblock') {
        value.tx[0].vin = Array.from({ length: 60000 }, (_, vin) => ({ issuance: { asset: hash,
          assetEntropy: hash, token: hash, isreissuance: false, assetamount: 1, tokenamount: 1 }, vout: vin }));
      }
      return value;
    });
    await expect(engine.advance(-1, null, new AbortController().signal)).rejects.toThrow('byte budget');
    expect(getState().blocks).toHaveLength(0);
  });
});
