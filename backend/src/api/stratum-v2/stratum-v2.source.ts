import { constants, promises as fs } from 'fs';
import { isAbsolute } from 'path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { request } from 'http';
import { invalid, StratumV2EvidenceError } from './stratum-v2.evidence';
import { Sv2Acquisition, Sv2Profile, Sv2Source } from './stratum-v2.native-types';
import { requireValue, validateSv2Profile, validateSv2Snapshot } from './stratum-v2.validation';

/** Selected file IO failures are normalized by the caller. @asyncUnsafe */
export async function readSv2File(file: string, maximum: number, privateFile: boolean): Promise<Buffer> {
  requireValue(isAbsolute(file));
  const before = await fs.lstat(file);
  const guarded = (stat: typeof before): boolean => stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= maximum &&
    (process.platform === 'win32' || stat.uid === process.getuid?.() && (!privateFile || (stat.mode & 0o777) === 0o600));
  requireValue(guarded(before));
  const fd = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await fd.stat(); requireValue(guarded(opened) && opened.ino === before.ino && opened.dev === before.dev);
    const bytes = Buffer.alloc(maximum + 1); const read = await fd.read(bytes, 0, bytes.length, 0); const after = await fd.stat();
    requireValue(guarded(after) && read.bytesRead === opened.size && opened.size === after.size && opened.mtimeMs === after.mtimeMs && opened.ctimeMs === after.ctimeMs);
    return bytes.subarray(0, read.bytesRead);
  } finally { await fd.close(); }
}
export interface Sv2SourceConfiguration { origin: string; keyFile: string; profileFile: string; }
export class AuthenticatedSv2Source implements Sv2Source {
  private readonly origin: URL;
  constructor(private readonly configuration: Sv2SourceConfiguration, private readonly now = Date.now) {
    this.origin = new URL(configuration.origin);
    requireValue(this.origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(this.origin.hostname) && !!this.origin.port && this.origin.pathname === '/' && !this.origin.username && !this.origin.password && !this.origin.search && !this.origin.hash);
  }
  /** Authenticates raw bytes before decoding or exposing any source data. @asyncSafe */
  async read(signal: AbortSignal): Promise<Sv2Acquisition> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    const abort = (): void => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    let key: Buffer | undefined;
    try {
      const files = await Promise.all([readSv2File(this.configuration.keyFile, 32, true), readSv2File(this.configuration.profileFile, 16384, false)]);
      key = files[0]; requireValue(key.length === 32 && !controller.signal.aborted);
      const profile: Sv2Profile = validateSv2Profile(JSON.parse(files[1].toString('utf8')));
      const profileSha256 = createHash('sha256').update(files[1]).digest('hex'), nonce = randomBytes(16).toString('hex');
      const signature = createHmac('sha256', key).update(`GET\n/v1/snapshot\n${nonce}`).digest('hex');
      const wire = await new Promise<{ bytes: Buffer; mac: string }>((resolve, reject) => {
        const req = request(new URL('/v1/snapshot', this.origin), { method: 'GET', signal: controller.signal, headers: { 'X-Universe-SV2-Nonce': nonce, 'X-Universe-SV2-Auth': signature } }, response => {
          if (response.statusCode !== 200 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(response.headers['content-type'])) || response.headers['content-encoding']) { response.destroy(); reject(invalid()); return; }
          const chunks: Buffer[] = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size > 1048576) { response.destroy(); reject(invalid()); } else chunks.push(chunk); });
          response.on('end', () => resolve({ bytes: Buffer.concat(chunks), mac: String(response.headers['x-universe-sv2-signature']) }));
          response.on('error', reject); response.on('aborted', () => reject(invalid()));
        });
        req.on('error', reject); req.end();
      });
      requireValue(!controller.signal.aborted && /^[0-9a-f]{64}$/.test(wire.mac));
      const actual = Buffer.from(wire.mac, 'hex'), expected = createHmac('sha256', key).update(`${nonce}\n`).update(wire.bytes).digest();
      requireValue(timingSafeEqual(actual, expected));
      const text = wire.bytes.toString('utf8'); requireValue(Buffer.from(text, 'utf8').equals(wire.bytes));
      const snapshot = validateSv2Snapshot(JSON.parse(text), profile, profileSha256, this.now());
      return { snapshot, rawSha256: createHash('sha256').update(wire.bytes).digest('hex'), bytes: wire.bytes.length };
    } catch {
      if (controller.signal.aborted) throw new StratumV2EvidenceError('sv2-source-deadline', 'The bounded SV2 source observation was cancelled or exceeded its deadline.', 504);
      throw new StratumV2EvidenceError('unavailable-sv2-roles', 'The authenticated operator-bound SV2 source is unavailable or failed validation.');
    } finally { key?.fill(0); clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
}
export function configuredSv2Source(): Sv2Source {
  const origin = process.env.UNIVERSE_SV2_SOURCE_ORIGIN, keyFile = process.env.UNIVERSE_SV2_SOURCE_KEY_FILE, profileFile = process.env.UNIVERSE_SV2_SOURCE_PROFILE_FILE;
  if (!origin || !keyFile || !profileFile) throw new StratumV2EvidenceError('unavailable-sv2-roles', 'SV2 observations require an explicitly configured authenticated native collector and independent source profile.');
  try { return new AuthenticatedSv2Source({ origin, keyFile, profileFile }); } catch { throw invalid(); }
}
