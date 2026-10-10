import * as fs from 'fs';

/** Admission bounds for the optional serialized cache, before UTF8/JSON allocation. */
export const RBF_SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
export type RbfRestoreFailure = 'snapshot-oversize' | 'snapshot-invalid' | 'snapshot-changed' | 'snapshot-read-failed' | 'snapshot-restore-failed';
export interface RbfSnapshot { txs: Array<[string, any]>; trees: any[]; expiring: Array<[string, number]> }
export class RbfSnapshotError extends Error {
  constructor(readonly code: RbfRestoreFailure) { super('RBF retained history is unavailable: ' + code); }
}
const invalid = (): never => { throw new RbfSnapshotError('snapshot-invalid'); };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Validate graph closure before any recursive import or RPC reads. */
export function validateRbfSnapshot(value: unknown, network: string): RbfSnapshot {
  if (!record(value) || value.network !== network || value.rbfCacheSchemaVersion !== 1 || !record(value.rbf)) { return invalid(); }
  const rbf = value.rbf;
  if (!Array.isArray(rbf.txs) || !Array.isArray(rbf.trees) || !Array.isArray(rbf.expiring)) { return invalid(); }
  const txids = new Set<string>();
  for (const pair of rbf.txs) {
    if (!Array.isArray(pair) || pair.length !== 2 || !hash(pair[0]) || txids.has(pair[0]) || !record(pair[1])) { return invalid(); }
    const tx = pair[1];
    if (tx.txid !== pair[0] || !Array.isArray(tx.vin) || !Array.isArray(tx.vout) || !integer(tx.weight)
      || tx.vin.some(v => !record(v) || !integer(v.sequence))
      || tx.vout.some(v => !record(v) || !integer(v.value))) { return invalid(); }
    txids.add(pair[0]);
  }
  const allNodes = new Set<string>();
  for (const tree of rbf.trees) {
    if (!record(tree) || !hash(tree.root)) { return invalid(); }
    const visited = new Set<string>();
    const stack: Array<[string, number]> = [[tree.root, 0]];
    while (stack.length) {
      const [id, depth] = stack.pop()!;
      const node = tree[id];
      if (depth > 128 || visited.has(id) || allNodes.has(id) || !txids.has(id) || !record(node) || node.tx !== id
        || !Array.isArray(node.replaces) || typeof node.time !== 'number' || !Number.isFinite(node.time) || node.time < 0 || typeof node.fullRbf !== 'boolean'
        || node.replaces.some(child => !hash(child))) { return invalid(); }
      visited.add(id); allNodes.add(id);
      for (const child of node.replaces) { stack.push([child, depth + 1]); }
    }
    if (Object.keys(tree).some(key => key !== 'root' && !visited.has(key))) { return invalid(); }
  }
  const expirations = new Set<string>();
  for (const pair of rbf.expiring) {
    if (!Array.isArray(pair) || pair.length !== 2 || !hash(pair[0]) || !txids.has(pair[0]) || expirations.has(pair[0]) || !integer(pair[1])) { return invalid(); }
    expirations.add(pair[0]);
  }
  return rbf as RbfSnapshot;
}

/** Open one fixed inode; reject size before allocating or decoding. Never modifies the source. */
export function readRbfSnapshot(path: string, network: string, maximumBytes = RBF_SNAPSHOT_MAX_BYTES): RbfSnapshot | null {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > RBF_SNAPSHOT_MAX_BYTES) { throw new RbfSnapshotError('snapshot-invalid'); }
  let fd: number | undefined;
  try {
    const pathStat = fs.lstatSync(path);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) { throw new RbfSnapshotError('snapshot-invalid'); }
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.dev !== pathStat.dev || before.ino !== pathStat.ino) { throw new RbfSnapshotError('snapshot-changed'); }
    if (!Number.isSafeInteger(before.size) || before.size > maximumBytes) { throw new RbfSnapshotError('snapshot-oversize'); }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!count) { throw new RbfSnapshotError('snapshot-changed'); }
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) { throw new RbfSnapshotError('snapshot-changed'); }
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new RbfSnapshotError('snapshot-invalid'); }
    const retained = validateRbfSnapshot(value, network);
    const finalPath = fs.lstatSync(path);
    if (!finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.dev !== before.dev || finalPath.ino !== before.ino
      || finalPath.size !== after.size || finalPath.mtimeMs !== after.mtimeMs || finalPath.ctimeMs !== after.ctimeMs) { throw new RbfSnapshotError('snapshot-changed'); }
    return retained;
  } catch (error: any) {
    if (fd === undefined && error?.code === 'ENOENT') { return null; }
    if (error instanceof RbfSnapshotError) { throw error; }
    throw new RbfSnapshotError('snapshot-read-failed');
  } finally { if (fd !== undefined) { fs.closeSync(fd); } }
}

/** A failed historical restore is never repaired by fresh observations or overwritten. */
class RbfRestoreState {
  private reason: RbfRestoreFailure | null = null;
  fail(reason: RbfRestoreFailure): void { this.reason ??= reason; }
  get unavailable(): boolean { return this.reason !== null; }
  diagnostic(): { schemaVersion: 'universe-rbf-history-availability-v1'; status: 'available' | 'unavailable'; reason: RbfRestoreFailure | null } {
    return { schemaVersion: 'universe-rbf-history-availability-v1', status: this.reason ? 'unavailable' : 'available', reason: this.reason };
  }
}
export const rbfRestoreState = new RbfRestoreState();
