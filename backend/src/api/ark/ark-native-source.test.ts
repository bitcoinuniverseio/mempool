import { allowedArkReadPath, ArkNativeProfile, ArkNativeSource, validateArkNativeProfile } from './ark-native-source';
import { ArkService } from './ark.service';

const genesis = '0'.repeat(64), one = '1'.repeat(64), original = '2'.repeat(64), future = '3'.repeat(64);
const profile: ArkNativeProfile = { schema: 'universe-ark-native-profile-v1', dialect: 'arkade', version: 'v0.9.16',
  sourceRevision: 'e2d9ed443df7a0dfb3aa1e5c824de9541ff71047', providerId: 'owned-signet', providerName: 'Owned Signet qualification',
  signerPubkey: '02' + '4'.repeat(64), forfeitPubkey: '03' + '5'.repeat(64), network: 'signet', genesisHash: genesis,
  blockOneHash: one, signetChallenge: '51', publicationIntent: 'owned-public-indexer' };
const info = { version: 'v0.9.16', network: 'signet', signerPubkey: profile.signerPubkey, forfeitPubkey: profile.forfeitPubkey,
  sessionDuration: '30', unilateralExitDelay: '86016', boardingExitDelay: '7775744', scheduledSession: null, digest: '6'.repeat(64) };
function fixture() {
  let height = 10, hash = original;
  const core = jest.fn(async (method: string, params: unknown[]): Promise<any> => method === 'getblockchaininfo'
    ? { chain: 'signet', signet_challenge: '51', initialblockdownload: false, blocks: height, bestblockhash: hash }
    : params[0] === 0 ? genesis : params[0] === 1 ? one : params[0] === 10 ? original : future);
  const read = jest.fn(async (_path: string, _admin: boolean, _signal: AbortSignal): Promise<any> => ({ ...info }));
  return { core, read, source: new ArkNativeSource(profile, core, read), advance: () => { height = 11; hash = future; } };
}
describe('native Ark provider source fencing', () => {
  it('preserves native seconds rather than inventing block timelocks or round intervals', async () => {
    const f = fixture(); const { observation } = await f.source.observe();
    expect(observation.info.unilateralExitDelay).toEqual({ unit: 'seconds', value: '86016' });
    expect(observation.info.sessionDurationSeconds).toBe('30');
    expect(observation.info.scheduledSession).toBeNull();
    expect(observation.anchor).toEqual({ height: 10, hash: original });
    expect(observation.profileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(observation.info).not.toHaveProperty('activeVtxoCount');
  });
  it('publishes observed provider identity without inventing inventory or cadence', async () => {
    const f = fixture(); const service = new ArkService({ nativeSource: f.source });
    expect(await service.$getOperators()).toEqual([expect.objectContaining({ id: 'owned-signet', status: 'observed',
      providerVersion: 'v0.9.16', sessionDurationSeconds: '30', activeVtxoCount: null, currentBatchHeight: null,
      totalVolumeSats: null, roundIntervalSec: null })]);
    await expect(service.$getBatches()).rejects.toMatchObject({ code: 'unavailable-ark-provider' });
  });
  it('maps failed provider identity to the public unavailable boundary', async () => {
    const f = fixture(); f.read.mockResolvedValue({ ...info, network: 'bitcoin' });
    await expect(new ArkService({ nativeSource: f.source }).$getOperators()).rejects.toMatchObject({ code: 'unavailable-ark-native-source', status: 503 });
  });
  it('accepts canonical tip growth while preserving the original independently checked anchor', async () => {
    const f = fixture(); f.read.mockImplementation(async () => { f.advance(); return { ...info }; });
    expect((await f.source.observe()).observation.anchor.height).toBe(10);
  });
  it.each(['signerPubkey', 'forfeitPubkey', 'network', 'version'])( 'rejects provider %s mismatch', async field => {
    const f = fixture(); f.read.mockResolvedValue({ ...info, [field]: 'wrong' });
    await expect(f.source.observe()).rejects.toMatchObject({ code: 'unavailable-ark-native-source' });
  });
  it('rejects same-provider runtime policy changes between independent waves', async () => {
    const f = fixture(); f.read.mockResolvedValueOnce({ ...info }).mockResolvedValueOnce({ ...info, unilateralExitDelay: '512' });
    await expect(f.source.observe()).rejects.toMatchObject({ code: 'ark-native-source-changed', status: 409 });
  });
  it('rejects reorg below the original anchor even if the new tip is higher', async () => {
    const f = fixture(); const old = f.core.getMockImplementation()!;
    let reads = 0;
    f.core.mockImplementation(async (method, params) => {
      if (method === 'getblockhash' && params[0] === 10 && ++reads > 1) return future;
      return old(method, params);
    });
    await expect(f.source.observe()).rejects.toMatchObject({ code: 'unavailable-ark-native-source' });
  });
  it.each(['chain', 'signet_challenge', 'initialblockdownload'])( 'rejects independent Core %s mismatch', async field => {
    const f = fixture(); const old = f.core.getMockImplementation()!;
    f.core.mockImplementation(async (method, params) => method === 'getblockchaininfo'
      ? { ...await old(method, params), [field]: field === 'initialblockdownload' ? true : 'wrong' } : old(method, params));
    await expect(f.source.observe()).rejects.toMatchObject({ code: 'unavailable-ark-native-source' });
  });
  it.each([86016, '1.5', '-1', '086016', '184467440737095516160', '4294967296', '86017'])( 'rejects malformed native duration %s', async value => {
    const f = fixture(); f.read.mockResolvedValue({ ...info, unilateralExitDelay: value });
    await expect(f.source.observe()).rejects.toMatchObject({ code: 'unavailable-ark-native-source' });
  });
  it.each([['511', 'blocks'], ['512', 'seconds'], ['65536', 'seconds']])('retains native duration %s unit %s', async (value, unit) => {
    const f = fixture(); f.read.mockResolvedValue({ ...info, unilateralExitDelay: value });
    expect((await f.source.observe()).observation.info.unilateralExitDelay).toEqual({ unit, value });
  });
  it('preserves bounded admin payload without declaring global completeness', async () => {
    const f = fixture(); f.read.mockImplementation(async path => path === '/v1/info' ? { ...info } : { rounds: [], summaries: [] });
    const result = await f.source.observe('/v1/admin/rounds?after=1&before=100&limit=10', true);
    expect(result.payload).toEqual({ rounds: [], summaries: [] });
    expect(result.observation).not.toHaveProperty('globalInventoryComplete');
  });
  it.each(['/v1/wallet/seed', '/v1/wallet/unlock', 'http://mainnet/v1/info', '/v1/info?x=1', '/v1/indexer/script/subscription/x'])( 'rejects arbitrary or private path %s', path => {
    expect(allowedArkReadPath(path, false)).toBe(false);
  });
  it.each(['/v1/admin/rounds?after=1&before=1&limit=10', '/v1/admin/rounds?after=0&before=100&limit=0', '/v1/admin/rounds?after=0&before=100&limit=101', '/v1/admin/rounds?after=0&before=100&limit=1&limit=2'])( 'rejects unbounded or invalid inventory path %s', path => {
    expect(allowedArkReadPath(path, true)).toBe(false);
  });
  it('requires explicit pinned dialect, network and publication intent', () => {
    for (const changed of [{ dialect: 'bark' }, { sourceRevision: '0'.repeat(40) }, { publicationIntent: 'all-wallet-data' }, { network: 'mainnet' }]) {
      expect(() => validateArkNativeProfile({ ...profile, ...changed })).toThrow();
    }
  });
});
