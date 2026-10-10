import * as fs from 'fs';
import { createHash, randomUUID } from 'crypto';
import { join } from 'path';
import { TextDecoder } from 'util';
import { captureHistoryJson } from './intelligence/time-machine/history-json';
import { RBF_SNAPSHOT_MAX_BYTES, RbfSnapshotError } from './rbf-snapshot';
import { RbfBodyReference } from './rbf-body-store';
import { RbfTxMetadata } from './rbf-metadata';

export interface RbfHistoryManifest {
  schemaVersion: 'mempool-rbf-history-v2'; network: string;
  metadata: Array<[string, RbfTxMetadata]>; bodies: RbfBodyReference[]; trees: any[]; expiring: Array<[string, number]>;
}
const same = (a: fs.BigIntStats, b: fs.BigIntStats): boolean => a.dev === b.dev && a.ino === b.ino
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Small pointer/index only. Full transaction bodies are never decoded through this reader. */
function readJson(path: string, maximum: number): { value: any; sha256: string } | null {
  let fd: number | undefined, seen = false;
  try {
    const named = fs.lstatSync(path, { bigint: true }); seen = true;
    if (!named.isFile() || named.isSymbolicLink()) { throw new RbfSnapshotError('snapshot-invalid'); }
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || !same(named, before)) { throw new RbfSnapshotError('snapshot-changed'); }
    if (before.size > BigInt(maximum)) { throw new RbfSnapshotError('snapshot-oversize'); }
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) { throw new RbfSnapshotError('snapshot-changed'); } offset += count;
    }
    if (!same(before, fs.fstatSync(fd, { bigint: true })) || !same(before, fs.lstatSync(path, { bigint: true }))) { throw new RbfSnapshotError('snapshot-changed'); }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!same(before, fs.fstatSync(fd, { bigint: true })) || !same(before, fs.lstatSync(path, { bigint: true }))) { throw new RbfSnapshotError('snapshot-changed'); }
    return { value, sha256: digest(bytes) };
  } catch (e: any) {
    if (!seen && e?.code === 'ENOENT') { return null; }
    if (e instanceof RbfSnapshotError) { throw e; }
    throw new RbfSnapshotError(seen ? 'snapshot-invalid' : 'snapshot-read-failed');
  } finally { if (fd !== undefined) { fs.closeSync(fd); } }
}

export function readRbfHistoryManifest(root: string, network: string): RbfHistoryManifest | null {
  const pointer = readJson(join(root, 'rbf-history-current.json'), 4096); if (!pointer) { return null; }
  const value = pointer.value;
  if (!value || value.schemaVersion !== 'mempool-rbf-pointer-v2' || typeof value.file !== 'string'
    || !/^rbf-history-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(value.file) || !/^[0-9a-f]{64}$/.test(value.sha256)) {
    throw new RbfSnapshotError('snapshot-invalid');
  }
  const loaded = readJson(join(root, value.file), RBF_SNAPSHOT_MAX_BYTES);
  if (!loaded || loaded.sha256 !== value.sha256) { throw new RbfSnapshotError('snapshot-changed'); }
  const manifest = loaded.value;
  if (!manifest || manifest.schemaVersion !== 'mempool-rbf-history-v2' || manifest.network !== network
    || !Array.isArray(manifest.metadata) || !Array.isArray(manifest.bodies) || !Array.isArray(manifest.trees) || !Array.isArray(manifest.expiring)
    || manifest.metadata.length > 100_000 || manifest.bodies.length !== manifest.metadata.length) { throw new RbfSnapshotError('snapshot-invalid'); }
  return manifest;
}

function readPointer(root: string, file: string, network: string): { pointer: any; manifest: RbfHistoryManifest } | null {
  const loaded = readJson(join(root, file), 4096); if (!loaded) { return null; }
  const pointer = loaded.value;
  if (!pointer || pointer.schemaVersion !== 'mempool-rbf-pointer-v2'
    || typeof pointer.file !== 'string' || !/^rbf-history-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(pointer.file)
    || !/^[0-9a-f]{64}$/.test(pointer.sha256)) { throw new RbfSnapshotError('snapshot-invalid'); }
  const index = readJson(join(root, pointer.file), RBF_SNAPSHOT_MAX_BYTES);
  if (!index || index.sha256 !== pointer.sha256) { throw new RbfSnapshotError('snapshot-changed'); }
  const manifest = index.value;
  if (!manifest || manifest.schemaVersion !== 'mempool-rbf-history-v2' || manifest.network !== network
    || !Array.isArray(manifest.bodies) || manifest.bodies.length > 100_000) { throw new RbfSnapshotError('snapshot-invalid'); }
  for (const body of manifest.bodies) {
    if (body.file && (typeof body.file !== 'string' || !/^rbf-body-[0-9a-f]{64}-[0-9a-f-]{36}\.json$/.test(body.file))) {
      throw new RbfSnapshotError('snapshot-invalid');
    }
  }
  return { pointer, manifest };
}

/** Capture the small immutable index before asynchronous writes; no whole-body collection.
 * @asyncUnsafe Failure leaves old pointer and immutable bodies intact; no automatic retry.
 */
export async function writeRbfHistoryManifest(root: string, manifest: RbfHistoryManifest): Promise<ReadonlySet<string>> {
  const captured = captureHistoryJson(manifest, RBF_SNAPSHOT_MAX_BYTES), id = randomUUID();
  const previous = readPointer(root, 'rbf-history-current.json', manifest.network);
  const rollback = readPointer(root, 'rbf-history-rollback.json', manifest.network);
  const protectedFiles = new Set<string>();
  for (const entry of [previous, rollback]) {
    for (const body of entry?.manifest.bodies || []) { if (body.file) { protectedFiles.add(body.file); } }
  }
  if (previous?.pointer.sha256 === captured.sha256) { return protectedFiles; }
  // Persist the former complete pointer as rollback before replacing current. A crash leaves
  // current intact; no source/segment is reclaimed until current publication succeeds.
  if (previous) {
    const temporaryRollback = join(root, 'rbf-rollback-incomplete-' + id + '.json');
    const rollbackHandle = await fs.promises.open(temporaryRollback, 'wx', 0o600);
    try { await rollbackHandle.writeFile(JSON.stringify(previous.pointer)); await rollbackHandle.sync(); }
    finally { await rollbackHandle.close(); }
    await fs.promises.rename(temporaryRollback, join(root, 'rbf-history-rollback.json'));
  }
  const name = 'rbf-history-' + captured.sha256 + '-' + id + '.json';
  let handle = await fs.promises.open(join(root, name), 'wx', 0o600);
  try {
    for (const text of captured.chunks) {
      const bytes = Buffer.from(text); let offset = 0;
      while (offset < bytes.length) {
        const write = await handle.write(bytes, offset, bytes.length - offset);
        if (!write.bytesWritten) { throw new RbfSnapshotError('snapshot-read-failed'); } offset += write.bytesWritten;
      }
    }
    await handle.sync();
  } finally { await handle.close(); }
  await fs.promises.chmod(join(root, name), 0o444);
  const verified = readJson(join(root, name), RBF_SNAPSHOT_MAX_BYTES);
  if (!verified || verified.sha256 !== captured.sha256) { throw new RbfSnapshotError('snapshot-changed'); }
  const temporary = 'rbf-pointer-incomplete-' + id + '.json';
  handle = await fs.promises.open(join(root, temporary), 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({ schemaVersion: 'mempool-rbf-pointer-v2', file: name, sha256: captured.sha256 })); await handle.sync();
  } finally { await handle.close(); }
  await fs.promises.rename(join(root, temporary), join(root, 'rbf-history-current.json'));
  protectedFiles.clear();
  for (const body of [...manifest.bodies, ...(previous?.manifest.bodies || [])]) {
    if (body.file) { protectedFiles.add(body.file); }
  }
  if (rollback && rollback.pointer.file !== previous?.pointer.file && rollback.pointer.file !== name) {
    // Only the exact independently hash-validated obsolete rollback index is removed.
    // Body cleanup separately requires current/rollback/live-reference and actual-reader fences.
    const obsolete = join(root, rollback.pointer.file);
    const checked = readJson(obsolete, RBF_SNAPSHOT_MAX_BYTES);
    if (!checked || checked.sha256 !== rollback.pointer.sha256) { throw new RbfSnapshotError('snapshot-changed'); }
    await fs.promises.unlink(obsolete);
  }
  if (process.platform !== 'win32') {
    const directory = await fs.promises.open(root, fs.constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  return protectedFiles;
}
