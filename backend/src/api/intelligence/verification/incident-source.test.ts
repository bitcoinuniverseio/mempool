import { createHash } from 'crypto';
import { chmodSync, mkdtempSync, promises as fs, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { IncidentProfile } from './incident-types';
import { IncidentCoreReader, IncidentRpcReader, observeIncidentSource, readIncidentProtected } from './incident-source';

function header(parent: string, height: number) {
  const bytes = Buffer.alloc(80); bytes.writeInt32LE(1); Buffer.from(parent, 'hex').reverse().copy(bytes, 4);
  bytes.writeUInt32LE(100 + height, 68); bytes.writeUInt32LE(height, 76);
  return { raw: bytes.toString('hex'), hash: createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest().reverse().toString('hex') };
}
function fixture() {
  const first = header('0'.repeat(64), 0), second = header(first.hash, 1), third = header(second.hash, 2), headers = [first, second, third];
  const p: IncidentProfile = { schema: 'universe-incident-profile-v1', network: 'signet', stale_after_seconds: 30,
    sources: [{ source_id: 'own-core', independence_id: 'own-instance', implementation: 'bitcoin-core', source_revision: null,
      binary_sha256: '1'.repeat(64), configuration_sha256: '2'.repeat(64), genesis_hash: first.hash, block_one_hash: second.hash, signet_challenge: '51' }] };
  const tip = { chain: 'signet', initialblockdownload: false, blocks: 2, bestblockhash: third.hash, signet_challenge: '51' };
  const call = jest.fn(async (method: string, params: unknown[]) => {
    if (method === 'getblockchaininfo') return { ...tip };
    if (method === 'getblockhash') return headers[params[0] as number].hash;
    if (method === 'getblockheader') return headers.find(h => h.hash === params[0])?.raw;
    throw Error('Unexpected');
  });
  return { p, headers, tip, reader: { call } as IncidentCoreReader, call };
}
it('hashes actual header bytes and returns a contiguous before/after-fenced observation', async () => {
  const f = fixture(); const result = await observeIncidentSource(f.p, f.p.sources[0], f.reader, new AbortController().signal);
  expect(result.headers.map(h => h.hash)).toEqual(f.headers.map(h => h.hash));
  expect(result.headers[2].parent).toBe(f.headers[1].hash);
  expect(f.call.mock.calls.filter(c => c[0] === 'getblockchaininfo')).toHaveLength(2);
});
it.each(['foreign-genesis', 'foreign-block-one', 'foreign-challenge', 'missing-ibd', 'ibd'])('rejects %s independently of configured network label', async mode => {
  const f = fixture();
  if (mode === 'foreign-genesis') f.p.sources[0].genesis_hash = 'a'.repeat(64);
  if (mode === 'foreign-block-one') f.p.sources[0].block_one_hash = 'b'.repeat(64);
  if (mode === 'foreign-challenge') f.tip.signet_challenge = '52';
  if (mode === 'missing-ibd') delete (f.tip as any).initialblockdownload;
  if (mode === 'ibd') f.tip.initialblockdownload = true;
  await expect(observeIncidentSource(f.p, f.p.sources[0], f.reader, new AbortController().signal)).rejects.toMatchObject({ code: 'incident-source-identity' });
});
it('rejects altered header bytes and a tip change rather than committing a mixed snapshot', async () => {
  const f = fixture(); f.headers[2].raw = '00'.repeat(80);
  await expect(observeIncidentSource(f.p, f.p.sources[0], f.reader, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-incident-header' });
  const g = fixture(); let reads = 0; const call = g.reader.call;
  g.reader.call = async (method, params, signal) => { const result = await call(method, params, signal); if (method === 'getblockchaininfo' && ++reads === 2) result.bestblockhash = 'c'.repeat(64); return result; };
  await expect(observeIncidentSource(g.p, g.p.sources[0], g.reader, new AbortController().signal)).rejects.toMatchObject({ code: 'incident-source-changed' });
});
it('does not start another source read after cancellation even when a reader ignores abort', async () => {
  const f = fixture(), controller = new AbortController();
  f.reader.call = jest.fn(async () => { controller.abort(); return f.tip; });
  await expect(observeIncidentSource(f.p, f.p.sources[0], f.reader, controller.signal)).rejects.toMatchObject({ code: 'incident-deadline' });
  expect(f.reader.call).toHaveBeenCalledTimes(1);
});
it('rejects caller-selected remote origins, credentials in URLs and non-loopback bindings', () => {
  for (const url of ['http://example.com', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/path', 'https://127.0.0.1', 'http://localhost']) expect(() => new IncidentRpcReader(url, '/not-read')).toThrow();
});
it('reads only bounded regular protected credential files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'incident-source-owned-')), file = join(dir, 'cookie');
  try { writeFileSync(file, '__cookie__:controlled', { mode: 0o600 }); expect((await readIncidentProtected(file, 4096, new AbortController().signal)).toString()).toBe('__cookie__:controlled');
    writeFileSync(file, 'x'.repeat(4097)); await expect(readIncidentProtected(file, 4096, new AbortController().signal)).rejects.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('rejects same-sized in-place writes during the protected read, while allowing complete rotation between calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'incident-source-owned-')), file = join(dir, 'cookie');
  writeFileSync(file, '__cookie__:controlled-a', { mode: 0o600 });
  const originalOpen = fs.open.bind(fs);
  const spy = jest.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await originalOpen(...args), originalRead = handle.read.bind(handle);
    (handle as any).read = async (...readArgs: any[]) => {
      const result = await (originalRead as any)(...readArgs);
      writeFileSync(file, '__cookie__:controlled-b'); const changed = new Date(Date.now() + 1000); utimesSync(file, changed, changed);
      return result;
    };
    return handle;
  });
  try { await expect(readIncidentProtected(file, 4096, new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable-incident-registration' }); }
  finally { spy.mockRestore(); }
  try { expect((await readIncidentProtected(file, 4096, new AbortController().signal)).toString()).toBe('__cookie__:controlled-b'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
(process.platform === 'win32' ? it.skip : it)('rejects POSIX symlinks and group-readable credentials before source dispatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'incident-source-owned-')), file = join(dir, 'cookie'), link = join(dir, 'link');
  try { writeFileSync(file, '__cookie__:controlled', { mode: 0o600 }); symlinkSync(file, link);
    await expect(readIncidentProtected(link, 4096, new AbortController().signal)).rejects.toThrow();
    chmodSync(file, 0o640); await expect(readIncidentProtected(file, 4096, new AbortController().signal)).rejects.toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
