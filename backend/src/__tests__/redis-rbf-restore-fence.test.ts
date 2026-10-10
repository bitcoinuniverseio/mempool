jest.mock('redis', () => ({ createClient: jest.fn(() => { throw new Error('No network clients in restore-fence fixtures'); }) }));
jest.mock('../api/mempool', () => ({ __esModule: true, default: { $setMempool: jest.fn(), getMempool: () => ({}), getSpendMap: () => new Map() } }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: { setBlocks: jest.fn(), setBlockSummaries: jest.fn() } }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: { load: jest.fn(async () => true) } }));
jest.mock('../api/transaction-utils', () => ({ __esModule: true, default: {} }));

function fixture(): any {
  let result: any;
  jest.isolateModules(() => {
    const config = require('../config').default; config.REDIS.ENABLED = false;
    const redis = jest.requireActual('../api/redis-cache').default;
    config.REDIS.ENABLED = true; redis.connected = true;
    redis.$getMempool = jest.fn(async () => ({})); redis.$getBlocks = jest.fn(async () => []);
    redis.$getBlockSummaries = jest.fn(async () => []); redis.scanKeys = jest.fn(async () => []);
    result = { redis, state: require('../api/rbf-snapshot').rbfRestoreState, rbf: require('../api/rbf-cache').default };
  });
  return result;
}
describe('Redis retained-history qualification owns a pending fence', () => {
  it('writes complete JSON body bytes verbatim and refuses quarantined writes', async () => {
    const { redis, state } = fixture(); state.beginRestore(); state.completeRestore('no-file');
    redis.client = { set: jest.fn(async () => undefined) };
    const id = 'a'.repeat(64), full = JSON.stringify({ txid: id, vin: [{ witness: ['complete'] }], status: { confirmed: true }, unknown: { original: true } });
    await redis.$setRbfRawEntry(id, full);
    expect(redis.client.set).toHaveBeenCalledWith('rbf:tx:' + id, full);
    state.fail('snapshot-invalid');
    await expect(redis.$setRbfRawEntry(id, full)).rejects.toThrow('snapshot-read-failed');
    expect(redis.client.set).toHaveBeenCalledTimes(1);
  });
  it('does not treat disconnected strict restore reads as an empty eligible history', async () => {
    const { redis, state } = fixture(); redis.connected = false;
    await expect(redis.$getRbfEntries('tx', true)).rejects.toThrow('snapshot-read-failed');
    expect(await redis.$getRbfEntries('tx')).toEqual([]); expect(redis.scanKeys).not.toHaveBeenCalled();
    await redis.$loadCache(); expect(state.diagnostic().reason).toBe('snapshot-read-failed');
  });
  it('sanitizes a failed scan and never invokes import/publishes available', async () => {
    const { redis, state, rbf } = fixture(); redis.scanKeys.mockRejectedValue(new Error('fixture-only untrusted secret-looking details'));
    await redis.$loadCache(); expect(rbf.load).not.toHaveBeenCalled();
    expect(state.diagnostic()).toEqual({schemaVersion:'universe-rbf-history-availability-v1',status:'unavailable',reason:'snapshot-read-failed'});
  });
  it('keeps actual import pending until settlement and rejects duplicate restore dispatch', async () => {
    const { redis, state, rbf } = fixture(); let release!: (success: boolean) => void;
    rbf.load.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const restoring = redis.$loadCache();
    for (let n = 0; n < 20 && !release; n++) { await Promise.resolve(); }
    expect(state.diagnostic().reason).toBe('rbf_restore_pending'); expect(state.unavailable).toBe(true);
    await redis.$loadCache(); expect(rbf.load).toHaveBeenCalledTimes(1); expect(redis.scanKeys).toHaveBeenCalledTimes(3);
    release(true); await restoring; expect(state.unavailable).toBe(false);
  });
  it('marks a failed import unavailable and never clears it with repeat/no-file completion', async () => {
    const { redis, state, rbf } = fixture(); rbf.load.mockResolvedValueOnce(false);
    await redis.$loadCache(); expect(state.diagnostic().reason).toBe('snapshot-restore-failed');
    await redis.$loadCache(); expect(rbf.load).toHaveBeenCalledTimes(1);
    expect(state.completeRestore('no-file')).toBe(false);
  });
});
