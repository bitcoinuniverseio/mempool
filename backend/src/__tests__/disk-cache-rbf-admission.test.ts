import fs = require('fs');
import { join } from 'path';
import { tmpdir } from 'os';
jest.mock('../api/mempool', () => ({ __esModule: true, default: {
  getMempool: jest.fn(() => ({})), getSpendMap: jest.fn(() => new Map()), $setMempool: jest.fn(),
} }));
jest.mock('../api/blocks', () => ({ __esModule: true, default: {
  setBlocks: jest.fn(), setBlockSummaries: jest.fn(), getBlocks: jest.fn(() => []), getBlockSummaries: jest.fn(() => []),
} }));
jest.mock('../api/common', () => ({ Common: { shuffleArray: jest.fn() } }));
jest.mock('../api/rbf-cache', () => ({ __esModule: true, default: { load: jest.fn(async () => true), dump: jest.fn() } }));

describe('nonfatal RBF snapshot rejection preserves existing historical bytes', () => {
  let directory: string;
  let oldSignals: Function[];
  beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), 'rbf-loader-')); oldSignals = process.listeners('SIGINT'); });
  afterEach(() => {
    for (const listener of process.listeners('SIGINT')) { if (!oldSignals.includes(listener)) { process.removeListener('SIGINT', listener); } }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const rbf = { network: 'signet', rbfCacheSchemaVersion: 1, rbf: { txs: [], trees: [], expiring: [] } };
  function modules(): any {
    let result: any;
    jest.isolateModules(() => {
      const config = require('../config').default; config.MEMPOOL.CACHE_ENABLED = true;
      config.MEMPOOL.CACHE_DIR = directory; config.MEMPOOL.NETWORK = 'signet';
      result = { disk: jest.requireActual('../api/disk-cache').default,
        rbf: require('../api/rbf-cache').default, state: require('../api/rbf-snapshot').rbfRestoreState };
    });
    return result;
  }
  function main(): void { fs.writeFileSync(join(directory, 'cache.json'), JSON.stringify({ network: 'signet', cacheSchemaVersion: 3, mempool: {}, blocks: [], blockSummaries: [] })); }
  it.each(['malformed', 'oversize', 'foreign-network', 'partial-import'])('keeps %s history unchanged across cache save and marks it explicitly unavailable', async kind => {
    main(); const file = join(directory, 'rbfcache.json');
    if (kind === 'oversize') { const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 320675973); fs.closeSync(fd); }
    else { fs.writeFileSync(file, kind === 'malformed' ? '{' : JSON.stringify(kind === 'foreign-network' ? { ...rbf, network: 'mainnet' } : rbf)); }
    const before = fs.statSync(file); const text = kind === 'oversize' ? null : fs.readFileSync(file, 'utf8');
    const loaded = modules(); if (kind === 'partial-import') { loaded.rbf.load.mockResolvedValueOnce(false); }
    await loaded.disk.$loadMempoolCache(); expect(loaded.state.unavailable).toBe(true);
    expect(loaded.state.diagnostic().reason).toBe(kind === 'partial-import' ? 'snapshot-restore-failed' : kind === 'oversize' ? 'snapshot-oversize' : 'snapshot-invalid');
    // Ordinary mempool cache I/O is outside this retained-RBF boundary test.
    const write = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const rename = jest.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
    try { await loaded.disk.$saveCacheToDisk(); } finally { write.mockRestore(); rename.mockRestore(); }
    expect(loaded.rbf.dump).not.toHaveBeenCalled();
    expect(fs.statSync(file).size).toBe(before.size); expect(fs.statSync(file).mtimeMs).toBe(before.mtimeMs);
    if (text !== null) { expect(fs.readFileSync(file, 'utf8')).toBe(text); }
  });
  it('checks retained RBF independently when the ordinary mempool snapshot is absent', async () => {
    fs.writeFileSync(join(directory, 'rbfcache.json'), '{'); const loaded = modules();
    await loaded.disk.$loadMempoolCache(); expect(loaded.state.unavailable).toBe(true);
    expect(loaded.rbf.load).not.toHaveBeenCalled();
  });
  it.each(['outdated-schema', 'foreign-network'])('still qualifies retained RBF when ordinary cache is %s', async kind => {
    fs.writeFileSync(join(directory, 'cache.json'), JSON.stringify({ network: kind === 'foreign-network' ? 'mainnet' : 'signet', cacheSchemaVersion: kind === 'outdated-schema' ? 2 : 3 }));
    const file = join(directory, 'rbfcache.json'); fs.writeFileSync(file, '{'); const loaded = modules();
    await loaded.disk.$loadMempoolCache(); expect(loaded.state.unavailable).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('{'); expect(loaded.rbf.load).not.toHaveBeenCalled();
  });
  it('restores a valid snapshot and never calls a provider from the file reader', async () => {
    main(); fs.writeFileSync(join(directory, 'rbfcache.json'), JSON.stringify(rbf)); const loaded = modules();
    await loaded.disk.$loadMempoolCache(); expect(loaded.state.unavailable).toBe(false);
    expect(loaded.rbf.load).toHaveBeenCalledWith({ txs: [], trees: [], expiring: [], mempool: {}, spendMap: new Map() });
  });
});
