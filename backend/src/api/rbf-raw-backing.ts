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
  private readonly sourceSha256: string;
  private readonly descriptor: { network: string; sourceSha256: string; sourceBytes: number };
  private sealedClosure: RbfCompactClosureCandidate | null;
  private constructor(private handle: FileHandle, private stamp: fs.BigIntStats, closure: RbfCompactClosureCandidate, private readonly path: string) {
    this.sealedClosure = closure;
    this.ranges = new Map(closure.raw.bodies.map(range => [range.txid, { ...range }]));
    this.sourceSha256 = closure.raw.sourceSha256;
    this.descriptor = { network: closure.raw.network, sourceSha256: closure.raw.sourceSha256, sourceBytes: closure.raw.sourceBytes };
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
      handle = await fs.promises.open(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const stamp = await handle.stat({ bigint: true });
      if (!stamp.isFile()) { return invalid(); }
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
      if (!after.isFile()) { return invalid(); }
      if (!same(stamp, after) || !same(stamp, await fs.promises.lstat(path, { bigint: true }))) { return changed(); }
      const result = new RbfRawBackingCandidate(handle, stamp, closure, path);
      handle = undefined; // Ownership transfers only after complete validation.
      return result;
    } catch (e) {
      if (e instanceof RbfSnapshotError) { throw e; }
      throw new RbfSnapshotError('snapshot-read-failed');
    } finally { if (handle) { await handle.close(); } }
  }

  has(txid: string): boolean { return this.ranges.has(txid); }
  get closure(): RbfCompactClosureCandidate { if (!this.sealedClosure) { return invalid(); } return structuredClone(this.sealedClosure); }
  takeClosure(): RbfCompactClosureCandidate {
    if (!this.sealedClosure) { return invalid(); }
    const owned = this.sealedClosure; this.sealedClosure = null; return owned;
  }
  sourceDescriptor(): { network: string; sourceSha256: string; sourceBytes: number } { return { ...this.descriptor }; }
  rangeReferences(): RbfBodyRange[] { return Array.from(this.ranges.values(), range => ({ ...range })); }
  rangeReference(txid: string): RbfBodyRange | undefined { const range = this.ranges.get(txid); return range ? { ...range } : undefined; }
  get activeReads(): number { return this.owners.size; }
  get admitting(): boolean { return !this.closing; }
  stopAdmission(): void { this.closing = true; }

  /** Completion verifies complete bytes/hash/stamp. A sink must abort a partial response on rejection.
   * @asyncUnsafe Rejects missing/changed source, cancellation and closed admission.
   */
  async *body(txid: string, signal?: AbortSignal): AsyncIterable<Buffer> {
    const range = this.ranges.get(txid);
    if (!range) { return invalid(); }
    yield* this.readRange(range, signal);
  }

  /** Full source copy for a new exclusive generation; never materializes all bodies.
   * @asyncUnsafe The sink must discard an incomplete publication if read/hash/ownership fails.
   */
  async *snapshot(signal?: AbortSignal): AsyncIterable<Buffer> {
    yield* this.readRange({ txid: '', offset: 0, bytes: Number(this.stamp.size), sha256: this.sourceSha256 }, signal);
  }

  /** @asyncUnsafe Propagates cancellation, source mutation and descriptor errors. */
  private async *readRange(range: RbfBodyRange, signal?: AbortSignal): AsyncIterable<Buffer> {
    cancelled(signal);
    if (this.closing) { throw new RbfSnapshotError('snapshot-read-failed'); }
    // Derived file reads only; this is not an RPC pool or a change to native/RPC budgets.
    if (this.owners.size >= 2) { throw new Error('RBF body read admission busy'); }
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
      if (hash.digest('hex') !== range.sha256 || !same(this.stamp, await this.handle.stat({ bigint: true }))
        || !same(this.stamp, await fs.promises.lstat(this.path, { bigint: true }))) { return changed(); }
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
