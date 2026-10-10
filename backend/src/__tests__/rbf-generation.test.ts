import * as fs from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { RbfRawBackingCandidate } from '../api/rbf-raw-backing';
import { RbfGenerationPublisher } from '../api/rbf-generation';
const id = 'a'.repeat(64);
const value = { network: 'signet', rbfCacheSchemaVersion: 1, extraOriginalRoot: { retainExactly: true }, rbf: {
  txs: [[id, { txid: id, weight: 400, vin: [], vout: [], witness: 'x'.repeat(200_000), originalFields: { complete: true } }]], trees: [], expiring: [],
} };
describe('exclusive derived RBF generation candidate under one writer', () => {
  let directory: string, sourcePath: string, source: RbfRawBackingCandidate;
  beforeEach(async () => {
    directory = fs.mkdtempSync(join(await fs.promises.realpath(tmpdir()), 'rbf-generation-')); sourcePath = join(directory, 'legacy.json');
    fs.writeFileSync(sourcePath, JSON.stringify(value)); source = await RbfRawBackingCandidate.open(sourcePath, 'signet', 1_000_000);
  });
  afterEach(async () => { await source.close(); jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
  it('publishes exact complete raw source plus qualified compact metadata without touching legacy bytes or declaring native readiness', async () => {
    const publisher = new RbfGenerationPublisher(), before = fs.readFileSync(sourcePath);
    const output = await publisher.publish(directory, source);
    expect(fs.readFileSync(sourcePath)).toEqual(before); expect(fs.readFileSync(join(output.path, 'snapshot.json'))).toEqual(before);
    expect(output.sourceSha256).toBe(createHash('sha256').update(before).digest('hex'));
    const bytes = fs.readFileSync(join(output.path, 'manifest.json')); expect(output.manifestSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    const manifest = JSON.parse(bytes.toString()); expect(manifest.complete).toBe(true); expect(manifest.qualified).toBe(false);
    expect(manifest.nativeQualified).toBe(false); expect(manifest.internalProjection.txs[0][1].witness).toBeUndefined();
    expect(publisher.busy).toBe(false); expect(fs.existsSync(join(directory, 'current-generation.json'))).toBe(false);
    const again = await publisher.publish(directory, source); expect(again.path).not.toBe(output.path);
    expect(fs.readFileSync(join(output.path, 'snapshot.json'))).toEqual(before);
  });
  it('rejects parallel admission, fences drain and retains real write ownership until late completion', async () => {
    const originalOpen = fs.promises.open.bind(fs.promises);
    let unblock!: () => void, entered!: () => void;
    const wait = new Promise<void>(resolve => { unblock = resolve; }), start = new Promise<void>(resolve => { entered = resolve; });
    jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).includes('.rbf-incomplete-') && String(args[0]).endsWith('snapshot.json') && args[1] === 'wx') {
        const write = handle.write.bind(handle); let first = true;
        jest.spyOn(handle, 'write').mockImplementation(async (...args: any[]) => {
          const result = await (write as any)(...args);
          if (first) { first = false; entered(); await wait; } return result;
        });
      }
      return handle;
    });
    const publisher = new RbfGenerationPublisher(), job = publisher.publish(directory, source); await start;
    await expect(publisher.publish(directory, source)).rejects.toThrow('unavailable');
    let drained = false; const drain = publisher.drain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false); expect(publisher.busy).toBe(true);
    unblock(); await job; await drain; expect(drained).toBe(true); expect(publisher.busy).toBe(false);
    await expect(publisher.publish(directory, source)).rejects.toThrow('unavailable');
  });
  it('keeps interrupted publication incomplete and preserves original bytes instead of overwriting/retrying', async () => {
    const publisher = new RbfGenerationPublisher(), controller = new AbortController();
    const original = source.snapshot.bind(source);
    jest.spyOn(source, 'snapshot').mockImplementation(async function* (signal) {
      for await (const chunk of original(signal)) { yield chunk; controller.abort(); }
    });
    await expect(publisher.publish(directory, source, controller.signal)).rejects.toThrow();
    expect(publisher.busy).toBe(false); expect(source.activeReads).toBe(0);
    await expect(publisher.drain()).rejects.toThrow();
    await expect(publisher.publish(directory, source)).rejects.toThrow('unavailable');
    const dirs = fs.readdirSync(directory).filter(name => name.startsWith('.rbf-incomplete-'));
    expect(dirs).toHaveLength(1); expect(fs.existsSync(join(directory, dirs[0], 'manifest.json'))).toBe(false);
    expect(fs.readdirSync(directory).some(name => name.startsWith('rbf-generation-'))).toBe(false);
    expect(fs.readFileSync(sourcePath).toString()).toBe(JSON.stringify(value));
  });
  it('rejects linked publication roots before creating any target', async () => {
    const link = join(directory, 'linked'); fs.symlinkSync(directory, link, 'junction');
    await expect(new RbfGenerationPublisher().publish(link, source)).rejects.toThrow('plain directory');
    expect(fs.readdirSync(directory).filter(name => name.startsWith('.rbf-') || name.startsWith('rbf-generation-'))).toEqual([]);
    fs.unlinkSync(link);
  });
  it('independently reads written bytes and refuses a mismatched copy even when writes report success', async () => {
    const originalOpen = fs.promises.open.bind(fs.promises);
    jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      const handle = await originalOpen(...args);
      if (String(args[0]).includes('.rbf-incomplete-') && String(args[0]).endsWith('snapshot.json') && args[1] === 'wx') {
        const write = handle.write.bind(handle); let changed = false;
        jest.spyOn(handle, 'write').mockImplementation(async (...args: any[]) => {
          const copied = Buffer.from(args[0]); const at = copied.indexOf('xxxxxxxx');
          if (!changed && at >= 0) { copied[at] = 121; changed = true; }
          return (write as any)(copied, ...args.slice(1));
        });
      }
      return handle;
    });
    await expect(new RbfGenerationPublisher().publish(directory, source)).rejects.toThrow('readback mismatch');
    expect(fs.readdirSync(directory).some(name => name.startsWith('rbf-generation-'))).toBe(false);
    expect(fs.readFileSync(sourcePath).toString()).toBe(JSON.stringify(value));
  });
  it('new sole owner publishes independently after a failed manifest write, preserving incomplete namespace', async () => {
    const originalOpen = fs.promises.open.bind(fs.promises);
    const fault = jest.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]).endsWith('manifest.json') && args[1] === 'wx') { throw new Error('fixture manifest-write failure'); }
      return originalOpen(...args);
    });
    await expect(new RbfGenerationPublisher().publish(directory, source)).rejects.toThrow('fixture manifest-write failure');
    const incomplete = fs.readdirSync(directory).filter(name => name.startsWith('.rbf-incomplete-')); expect(incomplete).toHaveLength(1);
    fault.mockRestore(); const output = await new RbfGenerationPublisher().publish(directory, source);
    expect(fs.existsSync(join(directory, incomplete[0], 'snapshot.json'))).toBe(true);
    expect(fs.existsSync(join(directory, incomplete[0], 'manifest.json'))).toBe(false);
    expect(fs.existsSync(join(output.path, 'manifest.json'))).toBe(true);
  });
});
