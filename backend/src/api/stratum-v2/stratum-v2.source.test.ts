import { createServer, Server } from 'http';
import { createHash, createHmac, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuthenticatedSv2Source } from './stratum-v2.source';
import { sv2Fixture } from './stratum-v2.fixture';
import { validateSv2Snapshot } from './stratum-v2.validation';

describe('SV2 authenticated raw native observations', () => {
  let directory: string, server: Server, key: Buffer, source: AuthenticatedSv2Source;
  let mode: string, calls: number, now: number;
  beforeEach(async () => {
    now = Date.now(); directory = await fs.mkdtemp(join(tmpdir(), 'sv2-wire-')); key = randomBytes(32); mode = 'valid'; calls = 0;
    const profile = Buffer.from(JSON.stringify(sv2Fixture(now).profile));
    await fs.writeFile(join(directory, 'key'), key, { mode: 0o600 }); await fs.writeFile(join(directory, 'profile'), profile, { mode: 0o600 });
    server = createServer((req, res) => {
      calls++; const nonce = String(req.headers['x-universe-sv2-nonce']);
      expect(req.method).toBe('GET'); expect(req.url).toBe('/v1/snapshot'); expect(nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(req.headers['x-universe-sv2-auth']).toBe(createHmac('sha256', key).update(`GET\n/v1/snapshot\n${nonce}`).digest('hex'));
      if (mode === 'stall') return;
      if (mode === 'redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end(); return; }
      const body = sv2Fixture(now); body.profileSha256 = createHash('sha256').update(profile).digest('hex');
      if (mode === 'stale') body.observedAt = new Date(now - 30001).toISOString();
      if (mode === 'foreign') body.profile.genesisHash = 'b'.repeat(64);
      if (mode === 'header') body.core.checkpoint.blockHash = 'b'.repeat(64);
      let raw = Buffer.from(mode === 'oversize' ? ' '.repeat(1048577) : JSON.stringify(body));
      const mac = createHmac('sha256', key).update(`${nonce}\n`).update(raw).digest('hex');
      if (mode === 'tampered') raw = Buffer.from('{}');
      res.writeHead(200, { 'content-type': 'application/json', 'x-universe-sv2-signature': mac }); res.end(raw);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    source = new AuthenticatedSv2Source({ origin: `http://127.0.0.1:${(server.address() as any).port}`, keyFile: join(directory, 'key'), profileFile: join(directory, 'profile') }, () => now);
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); });
  it('authenticates exact bytes and preserves u64 values, nullable facts and per-direction transport', async () => {
    const result = await source.read(new AbortController().signal);
    expect(result.snapshot.links[0].templateIdAtomic).toBe('18446744073709551615');
    expect(result.snapshot.roles[3].transports[0]).toMatchObject({ protocol: 'SV1', security: 'plaintext' });
    expect(result.snapshot.roles[0].uptimeSecondsAtomic).toBeNull(); expect(calls).toBe(1);
  });
  it.each(['tampered', 'redirect', 'stale', 'foreign', 'header', 'oversize'])('rejects %s before exposing a source observation', async selected => {
    mode = selected; await expect(source.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  });
  it('cancels a stalled source and does not expose private paths or authentication', async () => {
    mode = 'stall'; const controller = new AbortController(); const read = source.read(controller.signal); setTimeout(() => controller.abort(), 20);
    await expect(read).rejects.toMatchObject({ code: 'sv2-source-deadline', status: 504 });
  });
  it('rejects a key symlink before issuing HTTP', async () => {
    await fs.symlink(join(directory, 'key'), join(directory, 'key-link'));
    const selected = new AuthenticatedSv2Source({ origin: `http://127.0.0.1:${(server.address() as any).port}`, keyFile: join(directory, 'key-link'), profileFile: join(directory, 'profile') });
    await expect(selected.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(calls).toBe(0);
  });
  (process.platform === 'win32' ? it.skip : it)('rejects non-0600 selected keys before issuing HTTP', async () => {
    await fs.chmod(join(directory, 'key'), 0o640); await expect(source.read(new AbortController().signal)).rejects.toMatchObject({ status: 503 }); expect(calls).toBe(0);
  });
  it.each(['http://localhost:123/', 'https://127.0.0.1:123/', 'http://127.0.0.1:123/other', 'http://user:secret@127.0.0.1:123/'])('rejects non-selected loopback origin %s', origin => {
    expect(() => new AuthenticatedSv2Source({ origin, keyFile: join(directory, 'key'), profileFile: join(directory, 'profile') })).toThrow();
  });
});

describe('SV2 bounded typed native joins', () => {
  it('preserves genuine UTC microsecond/nanosecond timestamps and rejects invalid dates', () => {
    const now = Date.now(), value = sv2Fixture(now), expected = JSON.parse(JSON.stringify(value.profile));
    const prefix = new Date(now - 1000).toISOString().slice(0, 19);
    value.observedAt = prefix + '.123456+00:00'; value.core.verifiedAt = value.observedAt;
    for (const link of value.links) { link.observedAt = prefix + '.123456789Z'; link.declarationSuccess.observedAt = prefix + '.123455Z'; }
    expect(validateSv2Snapshot(value, expected, 'a'.repeat(64), now).links[0].observedAt).toBe(prefix + '.123456789Z');
    value.observedAt = '2026-02-30T00:00:00Z'; expect(() => validateSv2Snapshot(value, expected, 'a'.repeat(64), now)).toThrow();
  });
  it.each([
    ['IBD', value => { value.core.initialBlockDownload = true; }],
    ['rounded ID', value => { value.links[0].templateIdAtomic = Number('18446744073709551615'); }],
    ['duplicate sequence', value => { value.links[1].sequenceAtomic = '0'; }],
    ['fabricated event', value => { value.links[0].eventId = 'b'.repeat(64); }],
    ['missing prior declaration', value => { value.links[0].declarationSuccess = null; }],
    ['future declaration', value => { value.links[0].declarationSuccess.observedAt = new Date(Date.now() + 60000).toISOString(); }],
    ['unknown field', value => { value.roles[0].privateToken = 'not-public'; }],
    ['truncated unknown history', value => { value.retention.droppedLinksAtomic = null; }],
    ['misstated retained count', value => { value.retention.retainedLinksAtomic = '4'; }],
    ['fabricated lifetime coverage', value => { value.retention.completeHistory = true; }],
  ] as [string, (value: any) => void][])('rejects %s', (_name, change) => {
    const now = Date.now(), value = sv2Fixture(now), expected = JSON.parse(JSON.stringify(value.profile)); change(value);
    expect(() => validateSv2Snapshot(value, expected, 'a'.repeat(64), now)).toThrow();
  });
});
