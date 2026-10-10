import { createHash, Hash } from 'crypto';
import { scanRbfJson, JsonPath } from './rbf-stream-json';

export interface RbfBodyRange { txid: string; offset: number; bytes: number; sha256: string }
export interface RbfRangeCandidate {
  schemaVersion: 'universe-rbf-body-ranges-candidate-v1';
  qualified: false;
  network: string;
  sourceBytes: number;
  sourceSha256: string;
  bodies: RbfBodyRange[];
  maximumCapturedTokenBytes: number;
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const tuple = (p: JsonPath): boolean => p[0] === 'rbf' && p[1] === 'txs' && typeof p[2] === 'number';
const fail = (): never => { throw new Error('RBF body range candidate invalid or exceeds bounded descriptor storage'); };

/** Full body bytes are hashed, never replaced by a projection or decoded wholesale.
 * @asyncUnsafe Rejects malformed input, resource excess, caller cancellation and source iterator errors.
 * Candidate ONLY: graph/expiry, immutable file ownership and body semantics are not qualified here.
 */
export async function scanRbfBodyRanges(chunks: AsyncIterable<Buffer>, network: string, signal?: AbortSignal): Promise<RbfRangeCandidate> {
  const all = createHash('sha256'), bodies: RbfBodyRange[] = [], ids = new Set<string>();
  let declaredNetwork: unknown, declaredVersion: unknown, tuples = 0, txsSeen = false;
  let id: string | null = null, bodyTxid: string | null = null;
  let active: { hash: Hash; start: number; next: number; tuple: number } | null = null;
  const scanned = await scanRbfJson(chunks, {
    signal,
    captureString: p => p.length === 1 && p[0] === 'network' || tuple(p) && (p.length === 4 && p[3] === 0 || p.length === 5 && p[3] === 1 && p[4] === 'txid'),
    onEvent: (e, chunk, base) => {
      if (e.kind === 'scalar' && e.path.length === 1) {
        if (e.path[0] === 'network') { declaredNetwork = e.value; }
        if (e.path[0] === 'rbfCacheSchemaVersion') { declaredVersion = e.value; }
      }
      if (e.path.length === 2 && e.path[0] === 'rbf' && e.path[1] === 'txs') {
        if (e.kind === 'array-start') { txsSeen = true; } else if (e.kind !== 'array-end') { return fail(); }
      }
      if (!tuple(e.path)) { return; }
      if (e.path.length === 3) {
        if (e.kind === 'array-start') { if (e.path[2] !== tuples || active || id !== null) { return fail(); } }
        else if (e.kind === 'array-end') { if (active || id === null || bodyTxid !== id) { return fail(); } id = null; bodyTxid = null; tuples++; }
        else { return fail(); }
      }
      if (e.path.length === 4) {
        if (e.path[3] === 0 && e.kind === 'scalar') {
          if (!hash(e.value) || ids.has(e.value)) { return fail(); }
          id = e.value; ids.add(id);
        } else if (e.path[3] === 1 && e.kind === 'object-start') {
          if (!id || active) { return fail(); }
          active = { hash:createHash('sha256'), start:e.start, next:e.start, tuple:e.path[2] as number };
        } else if (e.path[3] === 1 && e.kind === 'object-end') {
          if (!active || bodyTxid !== id) { return fail(); }
          active.hash.update(chunk.subarray(active.next - base, e.end - base));
          // Descriptor budget is distinct from actual V8/native capacity qualification.
          if (bodies.length >= 100_000) { return fail(); }
          bodies.push({ txid:id!, offset:active.start, bytes:e.end-active.start, sha256:active.hash.digest('hex') }); active = null;
        } else { return fail(); }
      }
      if (e.kind === 'scalar' && e.path.length === 5 && e.path[3] === 1 && e.path[4] === 'txid') { bodyTxid = hash(e.value) ? e.value : null; }
    },
    onChunk: (chunk, base) => {
      all.update(chunk);
      if (active) { active.hash.update(chunk.subarray(active.next-base)); active.next = base+chunk.length; }
    },
  });
  if (signal?.aborted || active || id !== null || !txsSeen || declaredNetwork !== network || declaredVersion !== 1 || bodies.length !== tuples) { return fail(); }
  return { schemaVersion:'universe-rbf-body-ranges-candidate-v1', qualified:false, network, sourceBytes:scanned.bytes, sourceSha256:all.digest('hex'), bodies,
    maximumCapturedTokenBytes:scanned.maximumCapturedTokenBytes };
}
