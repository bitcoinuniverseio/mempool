import * as fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RbfRawBackingCandidate } from '../api/rbf-raw-backing';
const id = 'a'.repeat(64);
const value = (): any => ({ network: 'signet', rbfCacheSchemaVersion: 1, rbf: {
  txs: [[id, { txid: id, weight: 400, vin: [{ sequence: 1 }], vout: [{ value: 3 }],
    witness: 'x'.repeat(200_000), originalFields: { complete: true } }]], trees: [], expiring: [],
} });
describe('fixed raw RBF backing ownership candidate', () => {
  let directory: string, file: string;
  const owned: RbfRawBackingCandidate[] = [];
  beforeEach(() => { directory = fs.mkdtempSync(join(tmpdir(), 'rbf-raw-backing-')); file = join(directory, 'raw.json'); fs.writeFileSync(file, JSON.stringify(value())); });
  afterEach(async () => { for (const reader of owned.splice(0)) { await reader.close(); } jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  async function open(): Promise<RbfRawBackingCandidate> { const reader = await RbfRawBackingCandidate.open(file, 'signet', 1_000_000); owned.push(reader); return reader; }
  it('returns every original body field in exact raw JSON chunks, never the compact projection', async () => {
    const reader = await open(); const chunks: Buffer[] = [];
    for await (const chunk of reader.body(id)) { expect(chunk.length).toBeLessThanOrEqual(65536); chunks.push(chunk); }
    expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify(value().rbf.txs[0][1]));
    expect(reader.qualified).toBe(false); expect(reader.closure.qualified).toBe(false);
    expect(reader.closure.internalProjection.txs[0][1].witness).toBeUndefined();
    expect(reader.activeReads).toBe(0);
  });
  it('fences late admission and keeps a paused reader descriptor owned until actual consumer settlement', async () => {
    const reader = await open(); const iterator = reader.body(id)[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false); expect(reader.activeReads).toBe(1);
    let closed = false; const close = reader.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); expect(reader.admitting).toBe(false);
    await expect(reader.body(id)[Symbol.asyncIterator]().next()).rejects.toThrow();
    await iterator.return?.(); await close; expect(closed).toBe(true); expect(reader.activeReads).toBe(0);
    await reader.close();
  });
  it('caller cancellation releases actual read ownership, and close waits for the rejected continuation', async () => {
    const reader = await open(); const controller = new AbortController();
    const iterator = reader.body(id, controller.signal)[Symbol.asyncIterator](); await iterator.next();
    controller.abort(); const close = reader.close();
    await expect(iterator.next()).rejects.toThrow('snapshot-read-failed'); await close;
    expect(reader.activeReads).toBe(0);
  });
  it('bounds simultaneous derived body owners without a queued read or changing RPC budgets', async () => {
    const reader = await open(); const first = reader.body(id)[Symbol.asyncIterator](); const second = reader.body(id)[Symbol.asyncIterator]();
    await first.next(); await second.next(); expect(reader.activeReads).toBe(2);
    await expect(reader.body(id)[Symbol.asyncIterator]().next()).rejects.toThrow('admission busy');
    expect(reader.activeReads).toBe(2); await first.return?.(); await second.return?.(); expect(reader.activeReads).toBe(0);
  });
  it('rejects an in-place source mutation instead of completing a trusted body response', async () => {
    const reader = await open(); const iterator = reader.body(id)[Symbol.asyncIterator](); await iterator.next();
    const fd = fs.openSync(file, 'r+'); fs.writeSync(fd, Buffer.from('y'), 0, 1, 100_000); fs.closeSync(fd);
    let failure: unknown;
    try { while (!(await iterator.next()).done) { /* Consume remaining chunks to reach completion check. */ } } catch (e) { failure = e; }
    expect(failure).toMatchObject({ code: 'snapshot-changed' }); expect(reader.activeReads).toBe(0);
  });
  it('rejects source budget before any body read and closes the rejected descriptor', async () => {
    const openOriginal = fs.promises.open.bind(fs.promises); let read: jest.SpyInstance | undefined, close: jest.SpyInstance | undefined;
    jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await openOriginal(...args); read = jest.spyOn(handle, 'read'); close = jest.spyOn(handle, 'close'); return handle;
    });
    await expect(RbfRawBackingCandidate.open(file, 'signet', 100)).rejects.toMatchObject({ code: 'snapshot-oversize' });
    expect(read).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed closure, foreign network and missing body without publishing qualification', async () => {
    await expect(RbfRawBackingCandidate.open(file, 'mainnet', 1_000_000)).rejects.toThrow();
    const reader = await open(); await expect(reader.body('b'.repeat(64))[Symbol.asyncIterator]().next()).rejects.toThrow('snapshot-invalid');
    const invalid = value(); invalid.rbf.expiring = [[id, -1]]; fs.writeFileSync(file, JSON.stringify(invalid));
    await expect(RbfRawBackingCandidate.open(file, 'signet', 1_000_000)).rejects.toThrow('snapshot-invalid');
  });
  it('does not let mutation of public candidate metadata replace protected body ranges/hashes', async () => {
    const reader = await open(); reader.closure.raw.bodies[0].offset = 0; reader.closure.raw.bodies[0].sha256 = 'f'.repeat(64);
    const chunks: Buffer[] = []; for await (const chunk of reader.body(id)) { chunks.push(chunk); }
    expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(value().rbf.txs[0][1]);
  });
});
