import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RbfBodyStore } from '../api/rbf-body-store';
const id = (n: number): string => n.toString(16).padStart(64, '0');
const body = (n: number): any => ({ txid: id(n), weight: 400, vin: [{ sequence: 1 }], vout: [{ value: 3 }],
  witness: 'x'.repeat(200_000), extra: { preserve: true } });
async function read(store: RbfBodyStore, txid: string): Promise<string> { const bytes: Buffer[] = []; for await (const chunk of store.body(txid)) { bytes.push(chunk); } return Buffer.concat(bytes).toString(); }
describe('complete body store with bounded immutable segment ownership', () => {
  let directory: string, store: RbfBodyStore;
  beforeEach(async () => { directory = fs.mkdtempSync(join(await fs.promises.realpath(tmpdir()), 'rbf-body-store-')); store = new RbfBodyStore(); });
  afterEach(async () => { await store.close().catch(() => undefined); jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  it('keeps every fullbody field before and after immutable segment persistence', async () => {
    store.captureBatch([body(0), body(1)], false); const bytes = store.retainedEncodedBytes;
    expect(bytes).toBeGreaterThan(400_000); expect(await read(store, id(0))).toBe(JSON.stringify(body(0)));
    await store.configure(directory); await store.flush(); expect(store.retainedEncodedBytes).toBe(0);
    expect(store.references([id(0), id(1)]).every(ref => ref.file?.startsWith('rbf-body-'))).toBe(true);
    expect(await read(store, id(0))).toBe(JSON.stringify(body(0))); expect(await store.json(id(1))).toBe(JSON.stringify(body(1)));
    store.remove(id(0)); expect(store.has(id(0))).toBe(false); expect(fs.readdirSync(directory)).toHaveLength(2);
  });
  it('reclaims only owner-created obsolete segments after readers exit and rollback references release', async () => {
    store.captureBatch([body(0)], false); await store.configure(directory); await store.flush();
    const file = store.references([id(0)])[0].file!, path = join(directory, file);
    const unrelated = join(directory, 'rbf-body-' + 'f'.repeat(64) + '-00000000-0000-0000-0000-000000000000.json');
    fs.writeFileSync(unrelated, 'unowned'); fs.writeFileSync(join(directory, 'rbfcache.json'), 'legacy');
    const iterator = store.body(id(0))[Symbol.asyncIterator](); await iterator.next(); store.remove(id(0));
    store.maintainSegments(new Set()); expect(fs.existsSync(path)).toBe(true);
    await iterator.return?.(); store.maintainSegments(new Set([file])); expect(fs.existsSync(path)).toBe(true);
    store.maintainSegments(new Set()); expect(fs.existsSync(path)).toBe(false);
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('unowned');
    expect(fs.readFileSync(join(directory, 'rbfcache.json'), 'utf8')).toBe('legacy');
  });
  it('requalifies manifest segment ownership after restart before reclaiming expired membership', async () => {
    const full = { ...body(0), fee: 1, time: 1, vin: [{ sequence: 1, txid: id(99), vout: 0 }] };
    store.captureBatch([full], false); await store.configure(directory); await store.flush();
    const refs = store.references([id(0)]), file = refs[0].file!;
    await store.close(); store = new RbfBodyStore(); await store.configure(directory);
    await store.loadReferences(refs, 'signet'); store.remove(id(0));
    store.maintainSegments(new Set([file])); expect(fs.existsSync(join(directory, file))).toBe(true);
    store.maintainSegments(new Set()); expect(fs.existsSync(join(directory, file))).toBe(false);
  });
  it('refuses deletion when an owner-created obsolete pathname has been replaced', async () => {
    store.captureBatch([body(0)], false); await store.configure(directory); await store.flush();
    const file = store.references([id(0)])[0].file!, path = join(directory, file); store.remove(id(0));
    fs.chmodSync(path, 0o600); fs.unlinkSync(path); fs.writeFileSync(path, 'foreign replacement');
    expect(() => store.maintainSegments(new Set())).toThrow('snapshot-changed');
    expect(fs.readFileSync(path, 'utf8')).toBe('foreign replacement');
  });
  it('captures atomically and does not install a prefix when one body is invalid', () => {
    const cyclic: any = body(1); cyclic.loop = cyclic;
    expect(() => store.captureBatch([body(0), cyclic])).toThrow('snapshot-invalid');
    expect(store.count).toBe(0); expect(store.retainedEncodedBytes).toBe(0);
  });
  it('retains encoded memory ownership for a removed body until its paused reader settles', async () => {
    store.captureBatch([body(0)], false); const bytes = store.retainedEncodedBytes;
    const iterator = store.body(id(0))[Symbol.asyncIterator](); await iterator.next();
    store.remove(id(0)); expect(store.retainedEncodedBytes).toBe(bytes); expect(store.activeReads).toBe(1);
    await iterator.return?.(); expect(store.retainedEncodedBytes).toBe(0); expect(store.activeReads).toBe(0);
  });
  it('a paused memory reader remains accounted through publication until its actual exit', async () => {
    store.captureBatch([body(0)], false); const bytes = store.retainedEncodedBytes;
    const iterator = store.body(id(0))[Symbol.asyncIterator](); await iterator.next();
    await store.configure(directory); await store.flush(); expect(store.retainedEncodedBytes).toBe(bytes);
    expect(await read(store, id(0))).toBe(JSON.stringify(body(0)));
    await iterator.return?.(); expect(store.retainedEncodedBytes).toBe(0);
  });
  it('rejects corrupt persisted bytes and does not pretend a partial response completed', async () => {
    store.captureBatch([body(0)], false); await store.configure(directory); await store.flush();
    const ref = store.references([id(0)])[0], path = join(directory, ref.file!);
    fs.chmodSync(path, 0o600); const fd = fs.openSync(path, 'r+'); fs.writeSync(fd, Buffer.from('y'), 0, 1, 100_000); fs.closeSync(fd);
    await expect(read(store, id(0))).rejects.toThrow('snapshot-changed'); expect(store.activeReads).toBe(0);
  });
  it('fences close synchronously and waits for actual consumer exit without a forced close', async () => {
    store.captureBatch([body(0)], false); const iterator = store.body(id(0))[Symbol.asyncIterator](); await iterator.next();
    let closed = false; const closing = store.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    expect(() => store.captureBatch([body(1)])).toThrow('snapshot-restore-failed');
    await iterator.return?.(); await closing; expect(closed).toBe(true);
  });
  it('preserves all live mutable DTO fields and freezes their final value before ownership release', async () => {
    const live = body(0); store.captureBatch([live]);
    live.status = { confirmed: true, block_height: 123 }; live.effectiveFeePerVsize = 12; live.acceleration = true;
    live.arbitraryNewAnnotation = { preserveExactly: true };
    expect(JSON.parse(await read(store, id(0)))).toEqual(live);
    const frozen = JSON.parse(JSON.stringify(live)); store.freezeLive(live);
    live.status = { confirmed: false }; live.arbitraryNewAnnotation.preserveExactly = false;
    expect(JSON.parse(await read(store, id(0)))).toEqual(frozen);
    await store.configure(directory); await store.flush(); expect(JSON.parse(await read(store, id(0)))).toEqual(frozen);
  });
  it('a live fullbody response captures one consistent DTO before any backpressure await', async () => {
    const live = body(0); live.extra = { version: 1 }; store.captureBatch([live]);
    const iterator = store.body(id(0))[Symbol.asyncIterator](); const bytes: Buffer[] = [];
    const first = await iterator.next(); if (!first.done) { bytes.push(first.value); }
    live.extra.version = 2; live.newField = 'after response capture';
    for (;;) { const next = await iterator.next(); if (next.done) { break; } bytes.push(next.value); }
    const captured = JSON.parse(Buffer.concat(bytes).toString()); expect(captured.extra.version).toBe(1); expect(captured.newField).toBeUndefined();
    expect(JSON.parse(await read(store, id(0))).extra.version).toBe(2);
  });
});
