import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LiquidObservatoryService } from './liquid-observatory.service';
import { LiquidProjectionSnapshot } from './liquid-projection-engine';
import { LiquidRegistryReader } from './liquid-registry-publication';

const h = (value: string): string => value.repeat(64);
function snapshot(): LiquidProjectionSnapshot {
  const hash = h('a'), asset = h('b');
  return { schema: 'universe-liquid-observatory-projection-v1', status: 'COMPLETE_AT_OBSERVED_PAIR',
    observation: { profileSha256: h('c'), observedAt: new Date().toISOString(),
      elements: { height: 0, hash, genesis: hash, parametersRoot: hash, epochLength: 10, epochAge: 0 },
      parent: { height: 113, hash: h('d'), genesis: h('e') },
      federation: { signblockScript: '51', fedpegScript: '51', fedpegProgram: '51' },
      profile: { schema: 'universe-liquid-pair-profile-v1', network: 'elementsregtest', parentNetwork: 'regtest',
        elementsGenesis: hash, parentGenesis: h('e'), policyAsset: h('f'), elementsVersion: 230304, parentVersion: 300300,
        elementsSourceRevision: 'a'.repeat(40), parentSourceRevision: 'b'.repeat(40), epochLength: 10, peginConfirmationDepth: 10 } },
    state: { schema: 'universe-liquid-public-projection-v2', profileSha256: h('c'), updatedAt: new Date().toISOString(), blocks: [{
      height: 0, hash, previousHash: null, time: 123, parameterRoot: hash, parameterType: 'full', signblockScript: '51',
      fedpegScript: '51', fedpegProgram: '51', blockWitnessBytes: 1, confidentialOutputs: 3, explicitOutputs: 1,
      issuances: [{ txid: h('1'), vin: 0, asset, entropy: h('2'), token: h('3'), isReissuance: false,
        assetAmountAtomic: null, assetAmountCommitment: '08' + h('4'), tokenAmountAtomic: '100000000', tokenAmountCommitment: null }], pegInputs: [], pegOutputs: [] }] },
    verifiedPegInputs: [], progress: { processedBlocks: 1, expectedBlocks: 1, nextHeight: 1, pageLimit: 16 } };
}
function publication(): any {
  return { schema: 'universe-liquid-registry-publication-v1', network: 'elementsregtest', genesisHash: h('a'),
    publicationRevision: 'qualification-1', scope: 'Explicit test publication, no global issuer claim', assets: [{
      assetId: h('b'), name: 'Observed public issuance', ticker: 'PUB', precision: 8, issuanceTxid: h('1'), issuanceVin: 0,
      assetEntropy: h('2'), reissuanceToken: h('3'), provenance: 'Test operator assertion' }] };
}
describe('Liquid public DTO and publication boundaries', () => {
  let directory: string, file: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'liquid-catalog-')); file = join(directory, 'publication.json'); await writeFile(file, JSON.stringify(publication())); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  function service(value = snapshot()): { service: LiquidObservatoryService; engine: any } {
    const engine = { snapshot: jest.fn(async () => value), advance: jest.fn(async () => value) };
    return { service: new LiquidObservatoryService({ engine, registry: new LiquidRegistryReader(file) }), engine };
  }
  test('summary exposes measured public outputs and no reserve, signer or confidential percentage invention', async () => {
    const { service: reader, engine } = service();
    const summary = await reader.$getSummary();
    expect(summary.coverage.status).toBe('COMPLETE_AT_OBSERVED_PAIR');
    expect(summary.coverage.source.profile.network).toBe('elementsregtest');
    expect(summary.peggedReserveSats).toBeNull(); expect(summary.activeAssetCount).toBeNull();
    expect(summary.confidentialTxPercentage).toBeNull(); expect(summary.dynamicFederation.signersOnline).toBeNull();
    expect(summary.observedOutputCounts.confidential).toBe(3);
    expect(engine.advance).not.toHaveBeenCalled();
  });
  test('asset metadata is publication-bound, opaque issuance remains opaque, no circulating amount', async () => {
    const { service: reader } = service(); const result = await reader.$getAssets(0, 1);
    expect(result.assets[0].initialIssuanceAmountAtomic).toBeNull();
    expect(result.assets[0].initialIssuanceAmountCommitment).toBe('08' + h('4'));
    expect(result.assets[0].circulatingAmount).toBeNull(); expect(result.assets[0].issuerPubkey).toBeNull();
    expect(result.publication.sha256).toMatch(/^[0-9a-f]{64}$/); expect(result.nextOffset).toBeNull();
    expect(await reader.$getAsset(h('b'))).toMatchObject({ assetId: h('b'), hasProof: true });
    expect(await reader.$getAsset(h('9'))).toBeNull();
    await expect(reader.$getAsset('L-BTC')).rejects.toMatchObject({ status: 400 });
  });
  test('partial negative lookup is unavailable rather than asset-nonexistence or a complete empty set', async () => {
    const value = snapshot(); value.status = 'PARTIAL'; value.progress.expectedBlocks = 2;
    const { service: reader } = service(value);
    await expect(reader.$getAsset(h('9'))).rejects.toMatchObject({ status: 409 });
    expect((await reader.$getPegs()).coverage.status).toBe('PARTIAL');
    expect((await reader.$getPegs()).pegOuts.status).toBe('OBSERVED_REQUESTS_ONLY');
    expect((await reader.$getPegs()).pegOuts.parentPayoutStatus).toBe('UNKNOWN');
  });
  test('federation uses actual scripts and roots but never counts witness bytes as signers', async () => {
    const { service: reader } = service(); const result = await reader.$getFederation();
    expect(result.signblockscript).toBe('51'); expect(result.parametersRoot).toBe(h('a'));
    expect(result.activeSigners).toBeNull(); expect(result.threshold).toBeNull(); expect(result.blockSignerCounts).toBeNull();
    expect(result.observedFullParameterRecordsTotal).toBe(1);
  });
  test('canonical policy-asset peg-out request never implies parent payment or completion', async () => {
    const value = snapshot();
    value.state.blocks[0].pegOutputs = [{ txid: h('5'), vout: 0, parentGenesis: h('e'), parentScript: '51',
      parentAddress: null, asset: h('f'), amountAtomic: '200000' }];
    const { service: reader } = service(value), result = await reader.$getPegs();
    expect(result.pegOuts.total).toBe(1);
    expect(result.pegOuts.requests[0]).toMatchObject({ status: 'request-confirmed', amountAtomic: '200000', bitcoinTxid: null, parentPayoutStatus: 'UNKNOWN' });
    value.state.blocks[0].pegOutputs[0].parentGenesis = h('9');
    expect((await reader.$getPegs()).pegOuts.total).toBe(0);
  });
  test.each(['genesis', 'entropy', 'duplicate', 'wrong-network'])('rejects mismatched publication %s', async variant => {
    const raw = publication();
    if (variant === 'genesis') raw.genesisHash = h('9');
    if (variant === 'entropy') raw.assets[0].assetEntropy = h('9');
    if (variant === 'duplicate') raw.assets.push(raw.assets[0]);
    if (variant === 'wrong-network') raw.network = 'liquidv1';
    await writeFile(file, JSON.stringify(raw));
    await expect(new LiquidRegistryReader(file).read(snapshot(), new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-asset-registry' });
  });
  test('catalog outage is unavailable and cannot resolve as an empty publication', async () => {
    await rm(file); const { service: reader } = service();
    await expect(reader.$getAssets()).rejects.toMatchObject({ code: 'unavailable-asset-registry', status: 503 });
  });
  test('pagination bounds reject before reading the native source', async () => {
    const { service: reader, engine } = service();
    await expect(reader.$getAssets(0, 101)).rejects.toMatchObject({ status: 400 });
    await expect(reader.$getPegs(-1, 10)).rejects.toMatchObject({ status: 400 });
    expect(engine.snapshot).not.toHaveBeenCalled();
  });
});
