import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
const fs = jest.requireActual<typeof import('fs')>('fs');
import { ZcashPoolLedger } from './zcash-pool-ledger';
import { ZCASH_GENESIS } from './zcash-owned-reader';

function fixture() {
  const control = { tip: 32, fork: false, changed: false, badDelta: false, ready: true, infoReads: 0 };
  const hash = (height: number) => height === 0 ? ZCASH_GENESIS.testnet : createHash('sha256').update(`${control.fork && height > 8 ? 'fork' : 'initial'}:${height}`).digest('hex');
  const pools = (height: number) => ['transparent', 'sprout', 'sapling', 'orchard', 'lockbox', 'ironwood'].map((id, i) => ({ id, chainValueZat: i === 0 ? 1000 + height * 100 : 0, valueDeltaZat: i === 0 && height > 0 ? 100 : 0, monitored: i === 0 }));
  const call = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockchaininfo') {
      control.infoReads++;
      const tip = control.changed && control.infoReads > 2 ? control.tip + 1 : control.tip;
      return { chain: 'test', blocks: tip, bestblockhash: hash(tip), consensus: { chaintip: '00000000', nextblock: '00000000' }, chainSupply: { chainValueZat: 1000 + tip * 100 }, valuePools: pools(tip) };
    }
    if (method === 'getblockhash') return hash(Number(params[0]));
    if (method === 'getblock') {
      const height = Array.from({ length: control.tip + 2 }, (_, h) => h).find(h => hash(h) === params[0]);
      if (height === undefined) throw Error('No block');
      const valuePools = pools(height);
      if (control.badDelta && height === 1) valuePools[0].valueDeltaZat++;
      return { height, hash: hash(height), previousblockhash: height > 0 ? hash(height - 1) : undefined, time: 100000 + height,
        chainSupply: { chainValueZat: 1000 + height * 100 }, valuePools };
    }
    throw Error('Unexpected method');
  });
  return { control, reader: { implementation: 'zebra' as const, ready: jest.fn(async () => control.ready), call } };
}
describe('durable canonical Zcash net pool window', () => {
  let directory: string, file: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'zcash-pool-ledger-')); file = join(directory, 'ledger'); });
  afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
  it('manually advances16 then resumes durable state in a new instance with exact net changes', async () => {
    const { reader } = fixture();
    const first = await new ZcashPoolLedger(reader, file).advance('testnet');
    expect(first).toMatchObject({ status: 'PARTIAL', nextHeight: 17, verifiedThrough: { height: 16 }, coverage: { wholeChainHistory: false, grossFlows: 'unavailable', poolTransactionCounts: 'unavailable' } });
    expect(first.blocks).toHaveLength(16);
    const second = await new ZcashPoolLedger(reader, file).advance('testnet');
    expect(second).toMatchObject({ status: 'COMPLETE_WINDOW_AT_OBSERVED_TIP', nextHeight: null, verifiedThrough: { height: 32 } });
    expect(second.blocks).toHaveLength(32);
    expect(second.blocks[0].pools.find(p => p.id === 'transparent')).toMatchObject({ balanceZat: '1100', netChangeZat: '100' });
  });
  it('archives a displaced suffix, resumes from genuine canonical ancestor, and does not retain fork rows', async () => {
    const { reader, control } = fixture(); const ledger = new ZcashPoolLedger(reader, file);
    await ledger.advance('testnet'); const prior = readFileSync(file + '.testnet.json'); control.fork = true;
    const result = await ledger.advance('testnet');
    expect(result).toMatchObject({ reorgRecovered: true, priorSnapshotArchivedThisRequest: true, verifiedThrough: { height: 24 }, status: 'PARTIAL' });
    const archive = readdirSync(directory).find(name => name.includes('.superseded-'));
    expect(archive).toBeDefined(); expect(readFileSync(join(directory, archive!))).toEqual(prior);
    expect(result.blocks.find(b => b.height === 16)?.hash).not.toBe(JSON.parse(prior.toString()).blocks.find((b: any) => b.height === 16).hash);
  });
  it('closes exactly the bounded144-block window without claiming whole-chain history', async () => {
    const { reader, control } = fixture(); control.tip = 300;
    const ledger = new ZcashPoolLedger(reader, file);
    let result = await ledger.advance('testnet');
    for (let page = 1; page < 9; page++) result = await ledger.advance('testnet');
    expect(result).toMatchObject({ status: 'COMPLETE_WINDOW_AT_OBSERVED_TIP', coverage: { fromHeight: 157, throughHeight: 300, wholeChainHistory: false } });
    expect(result.blocks).toHaveLength(144);
    expect(JSON.parse(readFileSync(file + '.testnet.json', 'utf8')).blocks).toHaveLength(145);
  });
  it('rejects source movement and leaves the exact prior checkpoint unchanged', async () => {
    const { reader, control } = fixture(); const ledger = new ZcashPoolLedger(reader, file);
    await ledger.advance('testnet'); const prior = readFileSync(file + '.testnet.json'); control.infoReads = 0; control.changed = true;
    await expect(ledger.advance('testnet')).rejects.toMatchObject({ code: 'source-changed' });
    expect(readFileSync(file + '.testnet.json')).toEqual(prior);
  });
  it('rejects inconsistent block net change before committing any history', async () => {
    const { reader, control } = fixture(); control.badDelta = true;
    await expect(new ZcashPoolLedger(reader, file).advance('testnet')).rejects.toMatchObject({ code: 'invalid-pool-history' });
    expect(existsSync(file + '.testnet.json')).toBe(false);
  });
  it('preserves a failed atomic checkpoint and resumes by archiving pending bytes after fresh source verification', async () => {
    const { reader } = fixture(); const ledger = new ZcashPoolLedger(reader, file);
    await ledger.advance('testnet'); const prior = readFileSync(file + '.testnet.json');
    const actualWrite = fs.writeFileSync;
    const failure = jest.spyOn(fs, 'writeFileSync').mockImplementation((target, bytes, options) => {
      if (typeof target === 'number' && Buffer.isBuffer(bytes)) throw Error('Controlled atomic write failure');
      actualWrite(target, bytes, options);
    });
    try { await expect(ledger.advance('testnet')).rejects.toMatchObject({ code: 'pool-history-persistence' }); }
    finally { failure.mockRestore(); }
    expect(readFileSync(file + '.testnet.json')).toEqual(prior);
    expect(readFileSync(file + '.testnet.json.pending').length).toBe(0);
    await expect(ledger.advance('testnet')).resolves.toMatchObject({ interruptedWriteRecovered: true, status: 'COMPLETE_WINDOW_AT_OBSERVED_TIP' });
    expect(readdirSync(directory).some(name => name.includes('.pending.superseded-'))).toBe(true);
  });
  it('rejects malformed stored data instead of silently replacing it', async () => {
    writeFileSync(file + '.testnet.json', '{bad');
    await expect(new ZcashPoolLedger(fixture().reader, file).advance('testnet')).rejects.toMatchObject({ code: 'invalid-pool-history' });
    expect(readFileSync(file + '.testnet.json', 'utf8')).toBe('{bad');
  });
  it('recovers a proven exited writer lock on restart and preserves its evidence', async () => {
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    writeFileSync(file + '.testnet.json.lock', JSON.stringify({ pid: Number(child.stdout) }));
    await expect(new ZcashPoolLedger(fixture().reader, file).advance('testnet')).resolves.toMatchObject({ verifiedThrough: { height: 16 } });
    expect(readdirSync(directory).some(name => name.includes('.lock.dead-'))).toBe(true);
  });
  it('does not release a lock owned by a live process', async () => {
    writeFileSync(file + '.testnet.json.lock', JSON.stringify({ pid: process.pid }));
    await expect(new ZcashPoolLedger(fixture().reader, file).advance('testnet')).rejects.toMatchObject({ code: 'pool-history-busy' });
    expect(existsSync(file + '.testnet.json.lock')).toBe(true);
  });
  it('requires strict readiness and an absolute explicit owned path', async () => {
    const { reader, control } = fixture(); control.ready = false;
    await expect(new ZcashPoolLedger(reader, file).advance('testnet')).rejects.toMatchObject({ code: 'unavailable-checkpoint' });
    await expect(new ZcashPoolLedger(reader, undefined).advance('testnet')).rejects.toMatchObject({ code: 'unavailable-pool-ledger' });
    await expect(new ZcashPoolLedger(reader, 'relative').advance('testnet')).rejects.toMatchObject({ code: 'unavailable-pool-ledger' });
    expect(existsSync(file + '.testnet.json')).toBe(false);
  });
  it('bounds unresponsive readiness and cannot publish late source results', async () => {
    jest.useFakeTimers();
    try {
      const { reader } = fixture(); let finish!: (value: boolean) => void;
      reader.ready.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
      const ledger = new ZcashPoolLedger(reader, file);
      const pending = expect(ledger.advance('testnet')).rejects.toMatchObject({ code: 'source-timeout' });
      await jest.advanceTimersByTimeAsync(15000); await pending;
      finish(true); await Promise.resolve(); await Promise.resolve();
      expect(existsSync(file + '.testnet.json')).toBe(false);
      expect(existsSync(file + '.testnet.json.lock')).toBe(false);
    } finally { jest.useRealTimers(); }
  });
});
