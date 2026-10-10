import * as fs from 'fs';
import { FileHandle } from 'fs/promises';
import { createHash } from 'crypto';
import { scanRbfCompactClosure, RbfCompactClosureCandidate } from './rbf-compact-closure';
import { RbfBodyRange } from './rbf-body-ranges';
import { RbfSnapshotError } from './rbf-snapshot';

const changed = (): never => { throw new RbfSnapshotError('snapshot-changed'); };
const invalid = (): never => { throw new RbfSnapshotError('snapshot-invalid'); };
const cancelled = (signal?: AbortSignal): void => { if (signal?.aborted) { throw new RbfSnapshotError('snapshot-read-failed'); } };
const same = (a: fs.BigIntStats, b: fs.BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Fixed-inode reader candidate. This alone does NOT establish immutable generation or writer ownership.
 * It preserves raw complete JSON bodies; projections are not exposed as transaction responses.
 */
export class RbfRawBackingCandidate {
  readonly qualified = false;
  private closing = false;
  private closePromise?: Promise<void>;
  private owners = new Set<Promise<void>>();
  private readonly ranges: Map<string, RbfBodyRange>;
  private constructor(private handle: FileHandle, private stamp: fs.BigIntStats, readonly closure: RbfCompactClosureCandidate) {
    this.ranges = new Map(closure.raw.bodies.map(range => [range.txid, { ...range }]));
  }

  /** Full input is scanned using one verified descriptor, never allocated as a whole string.
   * @asyncUnsafe Rejects file/scope/grammar/closure/change/cancellation/resource failures.
   */
  static async open(path: string, network: string, maximumSourceBytes: number, signal?: AbortSignal): Promise<RbfRawBackingCandidate> {
    if (!Number.isSafeInteger(maximumSourceBytes) || maximumSourceBytes < 1) { return invalid(); }
    cancelled(signal);
    let handle: FileHandle | undefined;
    try {
      const named = await fs.promises.lstat(path, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink()) { return invalid(); }
      handle = await fs.promises.open(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stamp = await handle.stat({ bigint: true });
      if (!same(named, stamp)) { return changed(); }
      if (stamp.size > BigInt(maximumSourceBytes)) { throw new RbfSnapshotError('snapshot-oversize'); }
      const reader = handle;
      const chunks = async function* (): AsyncIterable<Buffer> {
        let offset = 0;
        while (offset < Number(stamp.size)) {
          cancelled(signal);
          const chunk = Buffer.allocUnsafe(Math.min(65536, Number(stamp.size) - offset));
          let read: { bytesRead: number };
          try { read = await reader.read(chunk, 0, chunk.length, offset); }
          catch { throw new RbfSnapshotError('snapshot-read-failed'); }
          if (!read.bytesRead) { return changed(); }
          offset += read.bytesRead;
          yield chunk.subarray(0, read.bytesRead);
        }
        cancelled(signal);
      };
      let closure: RbfCompactClosureCandidate;
      try { closure = await scanRbfCompactClosure(chunks(), network, signal); }
      catch (e) {
        if (e instanceof RbfSnapshotError) { throw e; }
        throw new RbfSnapshotError('snapshot-invalid');
      }
      const after = await handle.stat({ bigint: true });
      if (!same(stamp, after)) { return changed(); }
      const result = new RbfRawBackingCandidate(handle, stamp, closure);
      handle = undefined; // Ownership transfers only after complete validation.
      return result;
    } catch (e) {
      if (e instanceof RbfSnapshotError) { throw e; }
      throw new RbfSnapshotError('snapshot-read-failed');
    } finally { if (handle) { await handle.close(); } }
  }

  has(txid: string): boolean { return this.ranges.has(txid); }
  get activeReads(): number { return this.owners.size; }
  get admitting(): boolean { return !this.closing; }
  stopAdmission(): void { this.closing = true; }

  /** Completion verifies complete bytes/hash/stamp. A sink must abort a partial response on rejection.
   * @asyncUnsafe Rejects missing/changed source, cancellation and closed admission.
   */
  async *body(txid: string, signal?: AbortSignal): AsyncIterable<Buffer> {
    cancelled(signal);
    if (this.closing) { throw new RbfSnapshotError('snapshot-read-failed'); }
    // Derived file reads only; this is not an RPC pool or a change to native/RPC budgets.
    if (this.owners.size >= 2) { throw new Error('RBF body read admission busy'); }
    const range = this.ranges.get(txid);
    if (!range) { return invalid(); }
    let settle!: () => void;
    const owner = new Promise<void>(resolve => { settle = resolve; });
    this.owners.add(owner);
    try {
      if (!same(this.stamp, await this.handle.stat({ bigint: true }))) { return changed(); }
      const hash = createHash('sha256');
      let count = 0;
      while (count < range.bytes) {
        cancelled(signal);
        const chunk = Buffer.allocUnsafe(Math.min(65536, range.bytes - count));
        const read = await this.handle.read(chunk, 0, chunk.length, range.offset + count);
        if (!read.bytesRead) { return changed(); }
        const bytes = chunk.subarray(0, read.bytesRead); hash.update(bytes); count += bytes.length;
        yield bytes;
      }
      cancelled(signal);
      if (hash.digest('hex') !== range.sha256 || !same(this.stamp, await this.handle.stat({ bigint: true }))) { return changed(); }
    } catch (e) {
      if (e instanceof RbfSnapshotError) { throw e; }
      throw new RbfSnapshotError('snapshot-read-failed');
    } finally { this.owners.delete(owner); settle(); }
  }

  /** Close fences admission synchronously and waits for actual read owners, including paused consumers.
   * @asyncUnsafe Descriptor close failure remains explicit; no deadline forces busy descriptor closure.
   */
  close(): Promise<void> {
    this.stopAdmission();
    if (!this.closePromise) {
      this.closePromise = Promise.all([...this.owners]).then(() => this.handle.close());
    }
    return this.closePromise;
  }
}
