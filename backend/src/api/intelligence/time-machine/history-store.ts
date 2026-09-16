import { promises as fs, readFileSync, existsSync, statSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { hostname } from 'os';
import { createHash, randomUUID } from 'crypto';
import { gzip, gunzipSync } from 'zlib';
import { promisify } from 'util';

const compress = promisify(gzip);
const MAX_BYTES = 128 * 1024 * 1024;

/** Stable cluster roles preserve their own history across worker replacement. */
export function historyPathForRole(basePath: string, clustered: boolean, primary: boolean, workerId?: string): string | null {
  if (!clustered) return basePath;
  if (primary) return null;
  if (!workerId || !/^\d+$/.test(workerId)) throw new Error('Cluster history requires a stable numeric workerId.');
  return basePath + '.worker-' + workerId;
}
/** Network-scoped, checksummed snapshots published by atomic file replacement. */
export class HistoryStore {
  readonly path: string;
  private ownsLock = false;
  private readonly lockToken = randomUUID();
  private get ownerFile(): string { return this.path + '.writer-lock/' + this.lockToken + '.json'; }
  private readonly onExit = () => this.close();
  constructor(file: string, private readonly network: string) { this.path = resolve(file); }

  private acquire(): void {
    if (this.ownsLock) return;
    mkdirSync(dirname(this.path), { recursive: true });
    // Keep ownership for the lifetime of this observer, not just one write:
    // serial writes from two independent histories would still lose data.
    try { mkdirSync(this.path + '.writer-lock'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !this.reclaimDeadWriter()) throw error;
      // A competing valid claimant may win here: fail closed instead of overwriting it.
      mkdirSync(this.path + '.writer-lock');
    }
    try { writeFileSync(this.ownerFile, JSON.stringify({ pid: process.pid, host: hostname(), token: this.lockToken, started: new Date().toISOString() }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { rmdirSync(this.path + '.writer-lock'); throw error; }
    this.ownsLock = true;
    process.once('exit', this.onExit);
  }

  private reclaimDeadWriter(): boolean {
    try {
      const directory = this.path + '.writer-lock';
      const files = readdirSync(directory);
      if (files.length !== 1 || !/^[0-9a-f-]{36}\.json$/.test(files[0])) return false;
      if (statSync(directory + '/' + files[0]).size > 4096) return false;
      const owner = JSON.parse(readFileSync(directory + '/' + files[0], 'utf8'));
      if (owner.host !== hostname() || owner.token + '.json' !== files[0] || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
      try { process.kill(owner.pid, 0); return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false; }
      // The unique filename acts as a compare-and-delete token. Only the winner
      // of this unlink may remove the directory; another reclaimer must stop
      // on ENOENT and can never remove a replacement owner's token.
      unlinkSync(directory + '/' + files[0]);
      rmdirSync(directory);
      return true;
    } catch { return false; }
  }

  close(): void {
    if (!this.ownsLock) return;
    this.ownsLock = false;
    process.removeListener('exit', this.onExit);
    try { unlinkSync(this.ownerFile); rmdirSync(this.path + '.writer-lock'); } catch { /* Preserve an unexpected lock for operator inspection. */ }
  }

  read(): unknown | null {
    this.acquire();
    if (!existsSync(this.path)) return null;
    if (statSync(this.path).size > MAX_BYTES) throw new Error('History snapshot exceeds the storage limit.');
    const envelope = JSON.parse(gunzipSync(readFileSync(this.path), { maxOutputLength: MAX_BYTES }).toString('utf8'));
    if (envelope.schema !== 'mempool-history-v1' || envelope.network !== this.network || typeof envelope.body !== 'string' ||
        createHash('sha256').update(envelope.body).digest('hex') !== envelope.sha256) {
      throw new Error('History snapshot integrity or network check failed.');
    }
    return JSON.parse(envelope.body);
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  async write(value: unknown): Promise<void> {
    this.acquire();
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > MAX_BYTES / 2) throw new Error('History snapshot exceeds the storage limit.');
    const envelope = JSON.stringify({ schema: 'mempool-history-v1', network: this.network,
      sha256: createHash('sha256').update(body).digest('hex'), body });
    const bytes = await compress(envelope);
    await fs.mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, this.path);
      // Linux persists the directory entry as well as the file contents.
      if (process.platform !== 'win32') {
        const directory = await fs.open(dirname(this.path), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error; }
  }
}
