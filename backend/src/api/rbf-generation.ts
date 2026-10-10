import * as fs from 'fs';
import { FileHandle } from 'fs/promises';
import { join, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import { captureHistoryJson } from './intelligence/time-machine/history-json';
import { RbfRawBackingCandidate } from './rbf-raw-backing';

const cancelled = (signal?: AbortSignal): void => { if (signal?.aborted) { throw new Error('RBF generation publication cancelled'); } };
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** One derived publisher under the existing cache owner. No canonical producer, RPC or queue.
 * A completed source-only generation is not native readiness, adoption or whole artifact qualification.
 */
export class RbfGenerationPublisher {
  private job: Promise<{ path: string; sourceSha256: string; manifestSha256: string; nativeQualified: false }> | null = null;
  private accepting = true;
  private failure: unknown;
  get busy(): boolean { return this.job !== null; }
  stopAdmission(): void { this.accepting = false; }
  /** @asyncUnsafe Returns explicit active publication failure; never forces descriptor/producer exit. */
  async drain(): Promise<void> { this.stopAdmission(); if (this.job) { await this.job; } if (this.failure) { throw this.failure; } }

  /** Exclusive generation, unchanged raw source and complete manifest; no existing generation overwritten.
   * @asyncUnsafe Rejects admission/path/source/IO/cancellation/durability failures; incomplete namespace is retained.
   */
  publish(root: string, source: RbfRawBackingCandidate, signal?: AbortSignal): Promise<{ path: string; sourceSha256: string; manifestSha256: string; nativeQualified: false }> {
    if (!this.accepting || this.job) { return Promise.reject(new Error('RBF generation publisher unavailable')); }
    const job = this.write(root, source, signal);
    this.job = job;
    // The returned owner settles only after finally releases the sole publication slot.
    return job.catch(e => { this.accepting = false; this.failure = e; throw e; })
      .finally(() => { if (this.job === job) { this.job = null; } });
  }

  /** @asyncUnsafe Bounded writes retain incomplete files on failure; never publish a prefix. */
  private async write(root: string, source: RbfRawBackingCandidate, signal?: AbortSignal): Promise<{ path: string; sourceSha256: string; manifestSha256: string; nativeQualified: false }> {
    cancelled(signal);
    const normalized = resolve(root), named = await fs.promises.lstat(normalized);
    if (!named.isDirectory() || named.isSymbolicLink() || !samePath(await fs.promises.realpath(normalized), normalized)) {
      throw new Error('RBF generation root is not an owned plain directory');
    }
    const closure = source.closure;
    const suffix = randomUUID(), pending = join(normalized, '.rbf-incomplete-' + suffix);
    const final = join(normalized, 'rbf-generation-' + closure.raw.sourceSha256 + '-' + suffix);
    await fs.promises.mkdir(pending, { mode: 0o700 });
    let file: FileHandle | undefined;
    try {
      file = await fs.promises.open(join(pending, 'snapshot.json'), 'wx', 0o600);
      const digest = createHash('sha256'); let bytes = 0;
      for await (const chunk of source.snapshot(signal)) {
        cancelled(signal);
        let offset = 0;
        while (offset < chunk.length) {
          const wrote = await file.write(chunk, offset, chunk.length - offset);
          if (!wrote.bytesWritten) { throw new Error('RBF generation write did not progress'); }
          offset += wrote.bytesWritten;
        }
        digest.update(chunk); bytes += chunk.length;
      }
      if (bytes !== closure.raw.sourceBytes || digest.digest('hex') !== closure.raw.sourceSha256) {
        throw new Error('RBF generation source copy mismatch');
      }
      await file.sync(); await file.close(); file = undefined;
      await fs.promises.chmod(join(pending, 'snapshot.json'), 0o444);
      // Independent bounded readback/closure proves file bytes rather than assuming write success.
      const copied = await RbfRawBackingCandidate.open(join(pending, 'snapshot.json'), closure.raw.network, bytes, signal);
      try {
        if (copied.closure.raw.sourceSha256 !== closure.raw.sourceSha256) { throw new Error('RBF generation readback mismatch'); }
      } finally { await copied.close(); }
      const manifest = captureHistoryJson({ schemaVersion: 'universe-rbf-generation-candidate-v1', complete: true,
        nativeQualified: false, snapshotFile: 'snapshot.json', ...closure }, 32 * 1024 * 1024);
      file = await fs.promises.open(join(pending, 'manifest.json'), 'wx', 0o600);
      for (const chunk of manifest.chunks) {
        cancelled(signal);
        const bytes = Buffer.from(chunk); let offset = 0;
        while (offset < bytes.length) {
          const wrote = await file.write(bytes, offset, bytes.length - offset);
          if (!wrote.bytesWritten) { throw new Error('RBF manifest write did not progress'); }
          offset += wrote.bytesWritten;
        }
      }
      await file.sync(); await file.close(); file = undefined;
      await fs.promises.chmod(join(pending, 'manifest.json'), 0o444);
      cancelled(signal);
      // Windows local source tests do not qualify Linux directory durability.
      if (process.platform !== 'win32') { await this.syncDirectory(pending); }
      await fs.promises.rename(pending, final);
      if (process.platform !== 'win32') { await this.syncDirectory(normalized); }
      // No current-generation pointer or runtime availability marker is changed by this candidate.
      return { path: final, sourceSha256: closure.raw.sourceSha256, manifestSha256: manifest.sha256, nativeQualified: false };
    } finally { if (file) { await file.close(); } }
  }

  /** @asyncUnsafe Directory sync failure remains an unacknowledged publication, never auto-retried. */
  private async syncDirectory(path: string): Promise<void> {
    const directory = await fs.promises.open(path, fs.constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
