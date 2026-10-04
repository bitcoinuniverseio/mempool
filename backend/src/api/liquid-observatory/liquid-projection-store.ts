import { createHash, randomUUID } from 'crypto';
import { constants, promises as fs } from 'fs';
import { dirname, isAbsolute } from 'path';
import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';
import { LiquidPublicBlock } from './liquid-public-projection';

export interface LiquidProjectionState {
  schema: 'universe-liquid-public-projection-v2'; profileSha256: string;
  blocks: LiquidPublicBlock[]; updatedAt: string;
}
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_BLOCKS = 100000;
const invalid = (message: string): EvidenceError => new EvidenceError('invalid-liquid-projection-store', message);
const active = (signal: AbortSignal): void => { if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The bounded Liquid projection operation was cancelled.', 504); };

/** Separate operator-owned projection. Native canonical membership is checked by its caller before publication. */
export class LiquidProjectionStore {
  constructor(public readonly file: string, private readonly profileSha256: string) {
    if (!isAbsolute(file) || !/^[0-9a-f]{64}$/.test(profileSha256)) throw invalid('Invalid operator projection path or profile binding.');
  }
  private validate(state: LiquidProjectionState): void {
    if (state?.schema !== 'universe-liquid-public-projection-v2' || state.profileSha256 !== this.profileSha256
      || !Array.isArray(state.blocks) || state.blocks.length > MAX_BLOCKS || !Number.isFinite(Date.parse(state.updatedAt))) {
      throw invalid('The durable projection does not match its selected source.');
    }
    for (let index = 0; index < state.blocks.length; index++) {
      const block = state.blocks[index];
      if (block.height !== index || !/^[0-9a-f]{64}$/.test(block.hash)
        || block.previousHash !== (index ? state.blocks[index - 1].hash : null)
        || !Array.isArray(block.issuances) || !Array.isArray(block.pegInputs) || !Array.isArray(block.pegOutputs)) throw invalid('The durable projection ancestry is malformed or predates public peg-out projection; preserve it and select a fresh projection namespace.');
    }
  }
  async read(signal: AbortSignal): Promise<LiquidProjectionState> {
    active(signal);
    try {
      const metadata = await fs.stat(this.file);
      if (!metadata.isFile() || metadata.size > MAX_BYTES) throw invalid('The durable projection exceeds its bound.');
      const envelope = JSON.parse(await fs.readFile(this.file, 'utf8'));
      active(signal);
      if (typeof envelope.payload !== 'string' || envelope.sha256 !== sha(envelope.payload)) throw invalid('The durable projection checksum is invalid.');
      const state = JSON.parse(envelope.payload); this.validate(state); return state;
    } catch (error) {
      active(signal);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 'universe-liquid-public-projection-v2',
        profileSha256: this.profileSha256, blocks: [], updatedAt: new Date().toISOString() };
      if (error instanceof EvidenceError) throw error;
      throw invalid('The durable projection could not be read.');
    }
  }
  /** @asyncUnsafe */
  private async release(lock: string, token: string): Promise<void> {
    const actual = JSON.parse(await fs.readFile(lock, 'utf8'));
    if (actual.token !== token || actual.pid !== process.pid) throw invalid('Projection lock ownership changed during release.');
    await fs.unlink(lock);
  }
  /** Lock ownership is verified; stale recovery requires an independently dead PID. @asyncUnsafe */
  async transaction(work: (state: LiquidProjectionState) => Promise<LiquidProjectionState>, signal: AbortSignal): Promise<LiquidProjectionState> {
    try { return await this.lockedTransaction(work, signal); }
    catch (error) {
      if (error instanceof EvidenceError) throw error;
      throw new EvidenceError('unavailable-liquid-projection-store', 'The operator-owned durable projection could not complete its atomic operation.');
    }
  }
  /** @asyncUnsafe */
  private async lockedTransaction(work: (state: LiquidProjectionState) => Promise<LiquidProjectionState>, signal: AbortSignal): Promise<LiquidProjectionState> {
    active(signal);
    await fs.mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const lock = this.file + '.lock', token = randomUUID(), owner = { schema: 'universe-liquid-projection-lock-v1', pid: process.pid, token };
    let handle, recovery;
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw invalid('The durable projection lock could not be acquired.');
      try { recovery = await fs.open(lock + '.recovery', 'wx', 0o600); }
      catch { throw new EvidenceError('liquid-projection-busy', 'Projection recovery ownership is already reserved; no lock was changed.', 409); }
      try {
      let prior;
      try { prior = JSON.parse(await fs.readFile(lock, 'utf8')); } catch { throw invalid('The existing projection lock is malformed.'); }
      if (prior.schema !== owner.schema || !Number.isSafeInteger(prior.pid) || prior.pid <= 0 || typeof prior.token !== 'string') throw invalid('The existing projection lock is malformed.');
      try { process.kill(prior.pid, 0); throw new EvidenceError('liquid-projection-busy', 'A verified live projection owner is active.', 409); }
      catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; }
      // Compare the immutable ownership record before archiving; do not delete an arbitrary lock.
      if (JSON.stringify(JSON.parse(await fs.readFile(lock, 'utf8'))) !== JSON.stringify(prior)) throw invalid('Projection lock ownership changed.');
      await fs.rename(lock, lock + '.dead-owner.' + randomUUID());
      active(signal); handle = await fs.open(lock, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(owner)); await handle.sync();
      } finally { await recovery.close(); await fs.unlink(lock + '.recovery'); }
    }
    let temp: string | undefined;
    try {
      await handle.write(JSON.stringify(owner), 0, 'utf8'); await handle.truncate(Buffer.byteLength(JSON.stringify(owner))); await handle.sync(); active(signal);
      const prior = await this.read(signal), priorHashes = prior.blocks.map(block => block.hash);
      const next = await work(prior); active(signal); this.validate(next);
      const payload = JSON.stringify(next), envelope = JSON.stringify({ sha256: sha(payload), payload });
      if (Buffer.byteLength(envelope) > MAX_BYTES) throw invalid('The durable projection exceeds its byte bound.');
      if (priorHashes.some((hash, index) => next.blocks[index]?.hash !== hash)) {
        const archive = this.file + '.reorg.' + token;
        await fs.copyFile(this.file, archive, constants.COPYFILE_EXCL);
        const archived = await fs.open(archive, 'r');
        try { await archived.sync(); } finally { await archived.close(); }
        active(signal);
      }
      temp = this.file + '.pending.' + token;
      const target = await fs.open(temp, 'wx', 0o600);
      try { await target.writeFile(envelope); await target.sync(); } finally { await target.close(); }
      active(signal);
      await fs.rename(temp, this.file); temp = undefined;
      const directory = await fs.open(dirname(this.file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return next;
    } finally {
      await handle.close();
      if (temp) await fs.rename(temp, temp + '.interrupted').catch(() => undefined);
      await this.release(lock, token);
    }
  }
}
