import { JsonPath } from './rbf-stream-json';
import { RbfRangeCandidate, scanRbfBodyRanges } from './rbf-body-ranges';
import { RbfSnapshot, validateRbfSnapshot } from './rbf-snapshot';

/** Internal projection ONLY. Its vin/vout entries intentionally omit raw script/witness fields.
 * A complete transaction response must use the preserved raw range, never this projection.
 */
export interface RbfCompactClosureCandidate {
  qualified: false;
  metadataValidated: true;
  raw: RbfRangeCandidate;
  internalProjection: RbfSnapshot;
}
const bodyFields = new Set(['txid', 'weight', 'fee', 'firstSeen', 'acceleration', 'effectiveFeePerVsize', 'vin', 'vout']);
const nodeFields = new Set(['tx', 'time', 'interval', 'mined', 'txMined', 'fullRbf', 'replaces']);
const retain = (p: JsonPath): boolean => {
  if (!p.length) { return true; }
  if (p[0] !== 'rbf') { return p.length === 1 && ['network', 'rbfCacheSchemaVersion'].includes(p[0] as string); }
  if (p.length <= 2) { return p.length === 1 || ['txs', 'trees', 'expiring'].includes(p[1] as string); }
  if (p[1] === 'expiring') { return p.length <= 4; }
  if (p[1] === 'trees') { return p.length <= 4 || nodeFields.has(p[4] as string) && (p.length === 5 || p[4] === 'replaces' && p.length === 6); }
  if (p[1] !== 'txs') { return false; }
  if (p.length <= 4) { return true; }
  if (!bodyFields.has(p[4] as string)) { return false; }
  if (p.length === 5) { return true; }
  if (p[4] !== 'vin' && p[4] !== 'vout') { return false; }
  return p.length === 6 || p.length === 7 && (p[4] === 'vin' ? ['sequence', 'txid', 'vout'].includes(p[6] as string) : p[6] === 'value');
};

/** Unactivated full graph/expiry validator integration; backing ownership is still unqualified.
 * @asyncUnsafe Rejects input/source/cancellation/resource/closure failures; callers must handle rejection.
 */
export async function scanRbfCompactClosure(chunks: AsyncIterable<Buffer>, network: string, signal?: AbortSignal, maximumMetadataBudget = 16 * 1024 * 1024): Promise<RbfCompactClosureCandidate> {
  if (!Number.isSafeInteger(maximumMetadataBudget) || maximumMetadataBudget < 1 || maximumMetadataBudget > 16 * 1024 * 1024) {
    throw new Error('RBF compact closure descriptor budget invalid');
  }
  const containers = new Map<string, any>();
  let value: unknown, metadataBudget = 0;
  const raw = await scanRbfBodyRanges(chunks, network, signal, {
    captureString: p => retain(p),
    onEvent: e => {
      if (!retain(e.path)) { return; }
      const key = JSON.stringify(e.path);
      if (e.kind === 'object-end' || e.kind === 'array-end') { containers.delete(key); return; }
      // Conservative descriptor admission accounting, not a measurement of V8/native allocation.
      // Includes retained value/key string units; no one-million 4KiB-string allocation allowance.
      const property = e.path[e.path.length - 1];
      metadataBudget += 128 + (typeof property === 'string' ? property.length * 2 : 0)
        + (typeof e.value === 'string' ? e.value.length * 2 : 0);
      if (metadataBudget > maximumMetadataBudget) { throw new Error('RBF compact closure descriptor budget exceeded'); }
      const item = e.kind === 'object-start' ? Object.create(null) : e.kind === 'array-start' ? [] : e.value;
      if (!e.path.length) { value = item; }
      else {
        const parent = containers.get(JSON.stringify(e.path.slice(0, -1)));
        if (!parent) { throw new Error('RBF compact closure invalid parent'); }
        parent[e.path[e.path.length - 1]] = item;
      }
      if (e.kind === 'object-start' || e.kind === 'array-start') { containers.set(key, item); }
    },
  });
  const internalProjection = validateRbfSnapshot(value, network);
  return { qualified: false, metadataValidated: true, raw, internalProjection };
}
