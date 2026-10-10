import * as fs from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { readRbfHistoryManifest } from '../api/rbf-history-manifest';
import { RbfRawBackingCandidate } from '../api/rbf-raw-backing';
import { RbfGenerationPublisher } from '../api/rbf-generation';
jest.mock('../api/bitcoin/bitcoin-api-factory', () => ({ __esModule: true, default: {
  $getRawTransaction: jest.fn(async (txid: string) => ({ txid, status: { confirmed: false } })),
} }));
jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask', 'Date'] });
const { RbfCache } = jest.requireActual('../api/rbf-cache');
const id = (n: number): string => n.toString(16).padStart(64, '0');
const tx = (n: number): any => ({ txid: id(n), weight: 400, fee: n, effectiveFeePerVsize: 1, firstSeen: 1,
  vin: [{ sequence: 1, txid: id(100), vout: n }], vout: [{ value: n }], status: { confirmed: false },
  witness: 'x'.repeat(200_000), unknownOriginal: { retained: true } });
const fixture = (): any => ({ network: 'signet', rbfCacheSchemaVersion: 1, rbf: { txs: [0, 1].map(n => [id(n), tx(n)]),
  trees: [{ root: id(1), [id(1)]: { tx: id(1), time: 10, fullRbf: false, replaces: [id(0)] },
    [id(0)]: { tx: id(0), time: 1, fullRbf: false, replaces: [] } }], expiring: [0, 1].map(n => [id(n), Date.now() + 86400000]) } });
async function read(cache: any, key: string): Promise<any> { const bytes: Buffer[] = []; for await (const chunk of cache.body(key)) { bytes.push(chunk); } return JSON.parse(Buffer.concat(bytes).toString()); }
describe('real compact cache and complete body persistence', () => {
  let directory: string; const owned: any[] = [];
  beforeEach(async () => { directory = fs.mkdtempSync(join(await fs.promises.realpath(tmpdir()), 'rbf-runtime-')); });
  afterEach(async () => { for (const cache of owned.splice(0)) { await cache.closeBodies(); cache.destroy(); } fs.rmSync(directory, { recursive: true, force: true }); });
  afterAll(() => { jest.clearAllTimers(); jest.useRealTimers(); });
  function cache(): any { const result = new RbfCache(); owned.push(result); return result; }
  it('loads whole immutable legacy bytes, persists a small reference manifest and restores identical body/tree/expiry data', async () => {
    const original = fixture(), path = join(directory, 'rbfcache.json'); fs.writeFileSync(path, JSON.stringify(original));
    const input = await RbfRawBackingCandidate.open(path, 'signet', 1_000_000);
    const output = await new RbfGenerationPublisher().publish(directory, input); await input.close();
    const backing = await RbfRawBackingCandidate.open(join(output.path, 'snapshot.json'), 'signet', 1_000_000);
    const closure = backing.takeClosure(), first = cache(); await first.configureBodyPersistence(directory);
    expect(await first.load({ txs: closure.internalProjection.txs.map(([, value]) => ({ value })), trees: closure.internalProjection.trees,
      expiring: closure.internalProjection.expiring.map(([key, value]) => ({ key, value })), mempool: {}, spendMap: new Map(),
      backing, backingFile: relative(directory, join(output.path, 'snapshot.json')).replace(/\\/g, '/') })).toBe(true);
    expect(first.txs.get(id(0)).witness).toBeUndefined(); expect(() => backing.closure).toThrow();
    await first.saveHistory(directory, 'signet'); const manifest = readRbfHistoryManifest(directory, 'signet')!;
    expect(JSON.stringify(manifest).length).toBeLessThan(10_000); expect(fs.readFileSync(path).toString()).toBe(JSON.stringify(original));
    const second = cache(); expect(await second.loadManifest(directory, manifest, {}, new Map())).toBe(true);
    expect(await read(second, id(0))).toEqual(tx(0)); expect(second.getRbfTree(id(1))).toEqual(first.getRbfTree(id(1)));
    expect([...second.expiring]).toEqual([...first.expiring]);
  });
  it('persists changed live DTO annotations in segments and restores them without writing compact metadata as a body', async () => {
    const first = cache(), old = tx(0), replacement = tx(1); first.add([old], replacement);
    replacement.acceleration = true; replacement.status = { confirmed: true, block_height: 123, block_hash: id(9), block_time: 100 }; replacement.newAnnotation = { dynamic: true };
    first.mined(id(1)); await first.saveHistory(directory, 'signet');
    const manifest = readRbfHistoryManifest(directory, 'signet')!; expect(manifest.bodies.every(ref => ref.file)).toBe(true);
    const second = cache(); expect(await second.loadManifest(directory, manifest, {}, new Map())).toBe(true);
    expect(await read(second, id(1))).toEqual(replacement); expect((await read(second, id(1))).vin[0].sequence).toBe(1);
  });
  it('does not grow storage for unchanged saves and retains exactly one previous complete manifest', async () => {
    const first = cache(), replacement = tx(1); first.add([tx(0)], replacement); first.mined(id(1));
    await first.saveHistory(directory, 'signet');
    const initial = fs.readdirSync(directory).sort(), pointer = fs.readFileSync(join(directory, 'rbf-history-current.json'), 'utf8');
    for (let n = 0; n < 5; n++) { await first.saveHistory(directory, 'signet'); }
    expect(fs.readdirSync(directory).sort()).toEqual(initial);
    expect(fs.readFileSync(join(directory, 'rbf-history-current.json'), 'utf8')).toBe(pointer);
    replacement.newAnnotation = 1; await first.saveHistory(directory, 'signet');
    expect(fs.readFileSync(join(directory, 'rbf-history-rollback.json'), 'utf8')).toBe(pointer);
    replacement.newAnnotation = 2; await first.saveHistory(directory, 'signet');
    const files = fs.readdirSync(directory);
    expect(files.filter(file => /^rbf-history-[0-9a-f]{64}-/.test(file))).toHaveLength(2);
    expect(files.filter(file => file.startsWith('rbf-body-'))).toHaveLength(3); // old body + current/rollback replacement
  });
  it('flushes full segments on ordinary updates even with Redis disabled', async () => {
    const config = require('../config').default; expect(config.REDIS.ENABLED).toBe(false);
    const state = require('../api/rbf-snapshot').rbfRestoreState;
    state.beginRestore(); state.completeRestore('no-file');
    const first = cache(), replacement = tx(1); await first.configureBodyPersistence(directory); first.add([tx(0)], replacement);
    expect(fs.readdirSync(directory)).toHaveLength(0); await first.updateCache();
    expect(fs.readdirSync(directory).filter(file => file.startsWith('rbf-body-'))).toHaveLength(2);
    expect(await read(first, id(1))).toEqual(replacement);
  });
  it('rejects oversized dynamic metadata before installing or detaching a changed body', async () => {
    const first = cache(), replacement = tx(1); first.add([tx(0)], replacement);
    const old = first.txs.get(id(1)), before = first.bodies.references([id(1)])[0];
    replacement.vin = Array.from({ length: 100000 }, () => ({ sequence: 1, txid: id(10), vout: 0 }));
    first.freezeLiveBody(replacement);
    expect(first.txs.get(id(1))).toBe(old);
    expect(first.bodies.references([id(1)])[0]).toEqual(before);
    await expect(first.saveHistory(directory, 'signet')).rejects.toThrow('snapshot-oversize');
    expect(first.txs.get(id(1))).toBe(old);
    expect(first.bodies.references([id(1)])[0]).toEqual(before);
  });
  it('rejects mismatched index hashes/network, missing body files and forged compact values', async () => {
    const first = cache(); first.add([tx(0)], tx(1)); first.mined(id(1)); await first.saveHistory(directory, 'signet');
    expect(() => readRbfHistoryManifest(directory, 'mainnet')).toThrow();
    const manifest = readRbfHistoryManifest(directory, 'signet')!;
    const forged = JSON.parse(JSON.stringify(manifest)); forged.metadata[0][1].stripped.fee += 1;
    expect(await cache().loadManifest(directory, forged, {}, new Map())).toBe(false);
    fs.unlinkSync(join(directory, manifest.bodies[0].file!));
    expect(await cache().loadManifest(directory, manifest, {}, new Map())).toBe(false);
    const pointer = JSON.parse(fs.readFileSync(join(directory, 'rbf-history-current.json'), 'utf8')); pointer.sha256 = 'f'.repeat(64);
    fs.writeFileSync(join(directory, 'rbf-history-current.json'), JSON.stringify(pointer));
    expect(() => readRbfHistoryManifest(directory, 'signet')).toThrow('snapshot-changed');
  });
});
