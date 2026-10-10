/// <reference lib="es2021.weakref" />
import * as fs from 'fs';
import { FileHandle } from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { join, resolve } from 'path';
import { captureHistoryJson } from './intelligence/time-machine/history-json';
import { RbfRawBackingCandidate } from './rbf-raw-backing';
import { RbfSnapshotError, RBF_SNAPSHOT_MAX_BYTES } from './rbf-snapshot';
import { scanRbfCompactClosure } from './rbf-compact-closure';
import { RbfMetadataInput } from './rbf-metadata';

export interface RbfBodyReference { txid: string; bytes: number; sha256: string; file?: string; source?: string; sourceFile?: string; sourceBytes?: number }
type RecordBody = RbfBodyReference & { chunks?: string[]; backing?: RbfRawBackingCandidate; writing?: boolean; memoryReaders?: number; live?: WeakRef<{ txid: string }>; verifiedIdentity?: fs.BigIntStats };
const invalid = (): never => { throw new RbfSnapshotError('snapshot-invalid'); };
const cancelled = (signal?: AbortSignal): void => { if (signal?.aborted) { throw new RbfSnapshotError('snapshot-read-failed'); } };
const same = (a: fs.BigIntStats, b: fs.BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Complete bodies are kept apart from compact graph metadata. One owner writes immutable segments.
 * Memory-only mode preserves the offered response with an explicit encoded-retention admission fence.
 */
export class RbfBodyStore {
  private records = new Map<string, RecordBody>();
  private pendingBytes = 0;
  private responseBytes = 0;
  private root?: string;
  private writing?: Promise<void>;
  private failure?: unknown;
  private accepting = true;
  private owners = new Set<Promise<void>>();
  private backings = new Set<RbfRawBackingCandidate>();
  private ownedSegments = new Map<string, fs.BigIntStats>();
  private maintenanceCursor?: Iterator<string>;
  get count(): number { return this.records.size; }
  get activeReads(): number { return this.owners.size; }
  get retainedEncodedBytes(): number { return this.pendingBytes; }
  has(txid: string): boolean { return this.records.has(txid); }

  /** No partial batch is installed when capture/size/schema fails. */
  captureBatch(bodies: Array<{ txid: string }>, trackLive = true): void {
    if (!this.accepting || this.failure) { throw new RbfSnapshotError('snapshot-restore-failed'); }
    const staged = new Map<string, RecordBody>(); let bytes = 0;
    for (const body of bodies) {
      if (!/^[0-9a-f]{64}$/.test(body.txid)) { return invalid(); }
      if (this.records.has(body.txid) || staged.has(body.txid)) { continue; }
      let captured: ReturnType<typeof captureHistoryJson>;
      const remaining = RBF_SNAPSHOT_MAX_BYTES - this.pendingBytes - bytes;
      if (remaining < 1) { throw new RbfSnapshotError('snapshot-oversize'); }
      try { captured = captureHistoryJson(body, remaining); }
      catch (e) { throw new RbfSnapshotError(e instanceof TypeError ? 'snapshot-invalid' : 'snapshot-oversize'); }
      bytes += captured.bytes;
      staged.set(body.txid, { txid: body.txid, bytes: captured.bytes, sha256: captured.sha256, chunks: captured.chunks,
        ...(trackLive ? { live: new WeakRef(body) } : {}) });
    }
    if (this.records.size + staged.size > 100_000) { throw new RbfSnapshotError('snapshot-oversize'); }
    for (const [id, record] of staged) { this.records.set(id, record); }
    this.pendingBytes += bytes;
  }

  /** Called before the mempool releases its strong owner. Preserve the final full DTO, not a field whitelist. */
  freezeLive(body: { txid: string }, detach = true): boolean {
    const previous = this.records.get(body.txid);
    if (!previous || previous.live?.deref() !== body) { return false; }
    let captured: ReturnType<typeof captureHistoryJson>;
    try { captured = captureHistoryJson(body, RBF_SNAPSHOT_MAX_BYTES - this.pendingBytes); }
    catch { throw new RbfSnapshotError('snapshot-oversize'); }
    if (captured.sha256 === previous.sha256) { if (detach) { previous.live = undefined; } return true; }
    this.records.delete(body.txid); this.releaseEncoded(previous);
    this.records.set(body.txid, { txid: body.txid, bytes: captured.bytes, sha256: captured.sha256, chunks: captured.chunks,
      ...(!detach ? { live: new WeakRef(body) } : {}) });
    this.pendingBytes += captured.bytes;
    return true;
  }

  liveInputs(): RbfMetadataInput[] {
    return [...this.records.values()].flatMap(record => {
      const live = record.live?.deref(); return live ? [live as RbfMetadataInput] : [];
    });
  }

  refreshLive(): RbfMetadataInput[] {
    const refreshed: RbfMetadataInput[] = [];
    for (const record of [...this.records.values()]) {
      const live = record.live?.deref(); if (!live) { continue; }
      this.freezeLive(live, false); refreshed.push(live as RbfMetadataInput);
    }
    return refreshed;
  }

  /** Only this owner-created segments are eligible. No directory scan or legacy-source deletion.
   * A fixed 128-reference slice runs without await, so admission cannot race the idle check.
   * Crash-orphan files are preserved for separate, independently qualified offline maintenance.
   */
  maintainSegments(protectedFiles: ReadonlySet<string>): void {
    if (!this.root || this.writing || this.owners.size || this.failure) { return; }
    const active = new Set([...this.records.values()].flatMap(record => record.file ? [record.file] : []));
    this.maintenanceCursor ??= this.ownedSegments.keys();
    for (let i = 0; i < 128; i++) {
      const next = this.maintenanceCursor.next();
      if (next.done) { this.maintenanceCursor = undefined; break; }
      const file = next.value;
      if (active.has(file) || protectedFiles.has(file)) { continue; }
      const path = join(this.root, file), stat = fs.lstatSync(path, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !same(stat, this.ownedSegments.get(file)!)) {
        throw new RbfSnapshotError('snapshot-changed');
      }
      fs.unlinkSync(path); this.ownedSegments.delete(file);
    }
  }

  adopt(backing: RbfRawBackingCandidate, sourceFile?: string): void {
    if (!this.accepting || this.failure) { throw new RbfSnapshotError('snapshot-restore-failed'); }
    const source = backing.sourceDescriptor(), ranges = backing.rangeReferences();
    if (this.records.size + ranges.length > 100_000) { throw new RbfSnapshotError('snapshot-oversize'); }
    for (const range of ranges) {
      if (this.records.has(range.txid)) { return invalid(); }
    }
    for (const range of ranges) { this.records.set(range.txid, { txid: range.txid, bytes: range.bytes,
      sha256: range.sha256, source: source.sourceSha256, sourceFile, sourceBytes: source.sourceBytes, backing }); }
    this.backings.add(backing);
  }

  remove(txid: string): void {
    const record = this.records.get(txid);
    this.records.delete(txid);
    if (record) { this.releaseEncoded(record); }
    // Immutable evidence files/backings are retained; no reader-owned file is unlinked here.
  }

  private releaseEncoded(record: RecordBody): void {
    if (record.chunks && !record.writing && !record.memoryReaders && (record.file || this.records.get(record.txid) !== record)) {
      this.pendingBytes -= record.bytes; record.chunks = undefined;
    }
  }

  references(ids: Iterable<string>): RbfBodyReference[] {
    return Array.from(ids, txid => {
      const record = this.records.get(txid); if (!record) { return invalid(); }
      return { txid, bytes: record.bytes, sha256: record.sha256, ...(record.file ? { file: record.file } : {}),
        ...(record.source ? { source: record.source, sourceFile: record.sourceFile, sourceBytes: record.sourceBytes } : {}) };
    });
  }

  /** Full immutable inputs are revalidated before installing any reference or returning metadata.
   * @asyncUnsafe Missing/tampered/foreign inputs reject the complete restore, never install a prefix.
   */
  async loadReferences(refs: RbfBodyReference[], network: string): Promise<RbfMetadataInput[]> {
    if (!this.root || this.records.size || refs.length > 100_000) { return invalid(); }
    const staged = new Map<string, RecordBody>(), inputs: RbfMetadataInput[] = [];
    const sources = new Map<string, { backing: RbfRawBackingCandidate; inputs: Map<string, RbfMetadataInput>; file: string }>();
    try {
      for (const ref of refs) {
        if (!/^[0-9a-f]{64}$/.test(ref.txid) || staged.has(ref.txid) || !/^[0-9a-f]{64}$/.test(ref.sha256)
          || !Number.isSafeInteger(ref.bytes) || ref.bytes < 2) { return invalid(); }
        if (ref.source) {
          if (ref.file || !/^[0-9a-f]{64}$/.test(ref.source) || typeof ref.sourceFile !== 'string'
            || !new RegExp('^rbf-generation-' + ref.source + '-[0-9a-f-]{36}/snapshot\\.json$').test(ref.sourceFile)
            || !Number.isSafeInteger(ref.sourceBytes) || ref.sourceBytes! < ref.bytes || ref.sourceBytes! > 512 * 1024 * 1024) { return invalid(); }
          let source = sources.get(ref.source);
          if (!source) {
            const backing = await RbfRawBackingCandidate.open(join(this.root, ref.sourceFile), network, ref.sourceBytes!);
            const description = backing.sourceDescriptor();
            if (description.sourceSha256 !== ref.source || description.sourceBytes !== ref.sourceBytes) { await backing.close(); return invalid(); }
            const closure = backing.takeClosure();
            source = { backing, inputs: new Map(closure.internalProjection.txs.map(([id, input]) => [id, input])), file: ref.sourceFile };
            sources.set(ref.source, source);
          }
          if (source.file !== ref.sourceFile || source.backing.sourceDescriptor().sourceBytes !== ref.sourceBytes) { return invalid(); }
          const range = source.backing.rangeReference(ref.txid), input = source.inputs.get(ref.txid);
          if (!range || !input || range.bytes !== ref.bytes || range.sha256 !== ref.sha256) { return invalid(); }
          inputs.push(input); staged.set(ref.txid, { ...ref, backing: source.backing });
        } else {
          if (!ref.file || ref.sourceFile || ref.sourceBytes || ref.bytes > RBF_SNAPSHOT_MAX_BYTES) { return invalid(); }
          const record: RecordBody = { ...ref };
          const self = this;
          const wrapped = async function* (): AsyncIterable<Buffer> {
            yield Buffer.from('{"network":' + JSON.stringify(network) + ',"rbfCacheSchemaVersion":1,"rbf":{"txs":[[' + JSON.stringify(ref.txid) + ',');
            yield* self.readSegment(record);
            yield Buffer.from(']],"trees":[],"expiring":[]}}');
          };
          const scanned = await scanRbfCompactClosure(wrapped(), network);
          if (scanned.raw.bodies[0]?.sha256 !== ref.sha256) { return invalid(); }
          inputs.push(scanned.internalProjection.txs[0][1]); staged.set(ref.txid, record);
        }
      }
      this.records = staged;
      for (const record of staged.values()) {
        if (record.file && record.verifiedIdentity) { this.ownedSegments.set(record.file, record.verifiedIdentity); }
      }
      for (const source of sources.values()) { this.backings.add(source.backing); }
      return inputs;
    } catch (e) {
      await Promise.all([...sources.values()].map(source => source.backing.close()));
      throw e;
    }
  }

  /** @asyncUnsafe Only a canonical plain existing cache directory is accepted; no alias or new transport. */
  async configure(root: string): Promise<void> {
    const path = resolve(root), stat = await fs.promises.lstat(path), real = await fs.promises.realpath(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform === 'win32' ? real.toLowerCase() !== path.toLowerCase() : real !== path)) { return invalid(); }
    if (this.root && this.root !== path) { return invalid(); }
    this.root = path;
  }

  /** One write job; new batches remain within the same 32MiB pending budget, never an unbounded queue.
   * @asyncUnsafe Every failed write remains sticky and prevents new body admission/publication.
   */
  flush(): Promise<void> {
    if (this.failure) { return Promise.reject(this.failure); }
    if (!this.root) { return Promise.resolve(); }
    if (this.writing) { return this.writing; }
    const job = this.writePending();
    this.writing = job.catch(e => { this.failure = e; this.accepting = false; throw e; })
      .finally(() => { this.writing = undefined; });
    return this.writing;
  }

  /** @asyncUnsafe Writes only exclusive complete segments; no existing file is replaced. */
  private async writePending(): Promise<void> {
    const batch = [...this.records.values()].filter(record => !!record.chunks);
    for (const record of batch) { record.writing = true; }
    try { for (const record of batch) {
      if (!record.chunks) { continue; }
      if (this.ownedSegments.size >= 100_000) { throw new RbfSnapshotError('snapshot-oversize'); }
      const chunks = record.chunks, file = 'rbf-body-' + record.sha256 + '-' + randomUUID() + '.json';
      let handle: FileHandle | undefined;
      try {
        handle = await fs.promises.open(join(this.root!, file), 'wx', 0o600);
        for (const text of chunks) {
          const bytes = Buffer.from(text); let offset = 0;
          while (offset < bytes.length) {
            const result = await handle.write(bytes, offset, bytes.length - offset);
            if (!result.bytesWritten) { throw new RbfSnapshotError('snapshot-read-failed'); }
            offset += result.bytesWritten;
          }
        }
        await handle.sync(); await handle.close(); handle = undefined;
        await fs.promises.chmod(join(this.root!, file), 0o444);
        for await (const _ of this.readSegment({ ...record, file })) { /* Verify independently before publishing reference. */ }
        // No await between publishing the reference and releasing retained encoded bytes.
        record.file = file;
        this.ownedSegments.set(file, await fs.promises.lstat(join(this.root!, file), { bigint: true }));
      } finally { if (handle) { await handle.close(); } }
    } } finally {
      for (const record of batch) {
        record.writing = false;
        this.releaseEncoded(record);
      }
    }
  }

  /** @asyncUnsafe Exact complete raw JSON; a failing/aborted sink must not finalize a partial response. */
  async *body(txid: string, signal?: AbortSignal): AsyncIterable<Buffer> {
    cancelled(signal);
    if (!this.accepting || this.failure) { throw new RbfSnapshotError('snapshot-restore-failed'); }
    if (this.owners.size >= 2) { throw new Error('RBF body read admission busy'); }
    const record = this.records.get(txid); if (!record) { return invalid(); }
    let settle!: () => void; const owner = new Promise<void>(resolve => { settle = resolve; }); this.owners.add(owner);
    let memoryOwner = false;
    let responseOwner = 0;
    try {
      const live = record.live?.deref();
      if (live) {
        // The old fullbody cache shared this object with the live mempool. Capture synchronously
        // before any backpressure await, preserving every dynamic/unknown DTO field consistently.
        let captured: ReturnType<typeof captureHistoryJson>;
        try { captured = captureHistoryJson(live, RBF_SNAPSHOT_MAX_BYTES - this.responseBytes); }
        catch { throw new RbfSnapshotError('snapshot-oversize'); }
        responseOwner = captured.bytes; this.responseBytes += responseOwner;
        for (const text of captured.chunks) { cancelled(signal); yield Buffer.from(text); }
        cancelled(signal); return;
      }
      if (record.backing) { yield* record.backing.body(txid, signal); return; }
      const digest = createHash('sha256'); let count = 0;
      if (!record.file && record.chunks) {
        const captured = record.chunks;
        memoryOwner = true; record.memoryReaders = (record.memoryReaders || 0) + 1;
        for (const text of captured) { cancelled(signal); const chunk = Buffer.from(text); digest.update(chunk); count += chunk.length; yield chunk; }
      } else {
        yield* this.readSegment(record, signal); return;
      }
      cancelled(signal);
      if (count !== record.bytes || digest.digest('hex') !== record.sha256) { throw new RbfSnapshotError('snapshot-changed'); }
    } finally {
      this.responseBytes -= responseOwner;
      if (memoryOwner) { record.memoryReaders!--; this.releaseEncoded(record); }
      this.owners.delete(owner); settle();
    }
  }

  /** @asyncUnsafe Independently verifies complete bytes and both FD/path identities before completion. */
  private async *readSegment(record: RbfBodyReference, signal?: AbortSignal): AsyncIterable<Buffer> {
    if (!record.file || !this.root || !/^rbf-body-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(record.file)) { return invalid(); }
    const path = join(this.root, record.file), named = await fs.promises.lstat(path, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink()) { return invalid(); }
    const handle = await fs.promises.open(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || !same(named, before) || before.size !== BigInt(record.bytes)) { throw new RbfSnapshotError('snapshot-changed'); }
      const digest = createHash('sha256'); let count = 0;
      while (count < record.bytes) {
        cancelled(signal); const buffer = Buffer.allocUnsafe(Math.min(65536, record.bytes - count));
        const result = await handle.read(buffer, 0, buffer.length, count);
        if (!result.bytesRead) { throw new RbfSnapshotError('snapshot-changed'); }
        const chunk = buffer.subarray(0, result.bytesRead); digest.update(chunk); count += chunk.length; yield chunk;
      }
      cancelled(signal);
      if (digest.digest('hex') !== record.sha256 || !same(before, await handle.stat({ bigint: true }))
        || !same(before, await fs.promises.lstat(path, { bigint: true }))) { throw new RbfSnapshotError('snapshot-changed'); }
      (record as RecordBody).verifiedIdentity = before;
    } finally { await handle.close(); }
  }

  /** Fullbody JSON for optional Redis serialization, never the compact projection.
   * @asyncUnsafe A per-record bounded string is required by Redis SET; source data remains retained on failure.
   */
  async json(txid: string): Promise<string> {
    const record = this.records.get(txid); if (!record || record.bytes > RBF_SNAPSHOT_MAX_BYTES) { throw new RbfSnapshotError('snapshot-oversize'); }
    const chunks: Buffer[] = []; for await (const chunk of this.body(txid)) { chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Synchronous legacy diagnostic only; runtime persistence uses references, not this fullbody aggregate. */
  memoryValue(txid: string): unknown {
    const record = this.records.get(txid); if (!record?.chunks) { throw new RbfSnapshotError('snapshot-restore-failed'); }
    return JSON.parse(record.chunks.join(''));
  }

  /** @asyncUnsafe Fence admissions; wait actual reads/writes/backing descriptor exits without forcing busy closure. */
  async close(): Promise<void> {
    this.accepting = false;
    await Promise.all([...this.owners]);
    if (this.writing) { await this.writing; }
    await Promise.all([...this.backings].map(backing => backing.close()));
    if (this.failure) { throw this.failure; }
  }
}
