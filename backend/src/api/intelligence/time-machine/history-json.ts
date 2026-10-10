import { createHash } from 'crypto';

/** Serialize a Map iterator without first allocating every entry pair. */
export class HistoryJsonArray {
  constructor(readonly values: Iterable<unknown>) {}
}

const CHUNK_CHARS = 16 * 1024;
const unsupported = (value: unknown) => value === undefined || typeof value === 'function' || typeof value === 'symbol';

function prepare(value: any, key: string): any {
  if (value && typeof value === 'object' && typeof value.toJSON === 'function') value = value.toJSON(key);
  if (value instanceof Number || value instanceof Boolean || value instanceof String) value = value.valueOf();
  return value;
}

function* quoted(value: string): Generator<string> {
  yield '"';
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + CHUNK_CHARS);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1]) && /[\uDC00-\uDFFF]/.test(value[end])) end--;
    yield JSON.stringify(value.slice(offset, end)).slice(1, -1);
    offset = end;
  }
  yield '"';
}

function* encode(value: any, ancestors: Set<object>, depth: number): Generator<string> {
  if (typeof value === 'string') { yield* quoted(value); return; }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') { yield JSON.stringify(value); return; }
  if (typeof value === 'bigint') throw new TypeError('History JSON cannot encode BigInt.');
  if (unsupported(value)) throw new TypeError('History JSON requires a serializable root.');
  if (depth > 64 || ancestors.has(value)) throw new TypeError('History JSON depth or cycle limit.');
  ancestors.add(value);
  try {
    if (Array.isArray(value) || value instanceof HistoryJsonArray) {
      yield '[';
      let index = 0;
      const array = Array.isArray(value) ? value : [];
      const arrayItems = function* (): Generator<unknown> { for (let index = 0; index < array.length; index++) yield array[index]; };
      for (const entry of value instanceof HistoryJsonArray ? value.values : arrayItems()) {
        if (index) yield ',';
        const item = prepare(entry, String(index++));
        yield* encode(unsupported(item) ? null : item, ancestors, depth + 1);
      }
      yield ']';
    } else {
      yield '{';
      let emitted = false;
      for (const key of Object.keys(value)) {
        const item = prepare(value[key], key);
        if (unsupported(item)) continue;
        if (emitted) yield ',';
        emitted = true;
        yield* quoted(key); yield ':';
        yield* encode(item, ancestors, depth + 1);
      }
      yield '}';
    }
  } finally { ancestors.delete(value); }
}

/** Stream the shared JSON encoder without collecting a complete body or duplicating its semantics. */
export function* historyJsonChunks(value: unknown): Generator<string> {
  yield* encode(prepare(value, ''), new Set(), 0);
}

/** Capture synchronously, as JSON.stringify did, before any observation can mutate. */
export function captureHistoryJson(value: unknown, maximumBytes: number): { chunks: string[]; sha256: string; bytes: number } {
  const chunks: string[] = [];
  const digest = createHash('sha256');
  let pending = '';
  let bytes = 0;
  for (const piece of encode(prepare(value, ''), new Set(), 0)) {
    bytes += Buffer.byteLength(piece);
    if (bytes > maximumBytes) throw new Error('History snapshot exceeds the storage limit.');
    pending += piece;
    while (pending.length >= CHUNK_CHARS) {
      let end = CHUNK_CHARS;
      if (/[\uD800-\uDBFF]/.test(pending[end - 1]) && /[\uDC00-\uDFFF]/.test(pending[end])) end--;
      const chunk = pending.slice(0, end);
      chunks.push(chunk); digest.update(chunk); pending = pending.slice(end);
    }
  }
  if (pending) { chunks.push(pending); digest.update(pending); }
  return { chunks, sha256: digest.digest('hex'), bytes };
}

/** Consume captured chunks without constructing a full escaped envelope string. */
export function* historyEnvelopeChunks(snapshot: ReturnType<typeof captureHistoryJson>, network: string, maximumBytes: number): Generator<string> {
  let bytes = 0;
  function checked(value: string): string {
    bytes += Buffer.byteLength(value);
    if (bytes > maximumBytes) throw new Error('History envelope exceeds the storage limit.');
    return value;
  }
  yield checked(JSON.stringify({ schema: 'mempool-history-v1', network, sha256: snapshot.sha256 }).slice(0, -1) + ',"body":"');
  for (let index = 0; index < snapshot.chunks.length; index++) {
    const escaped = JSON.stringify(snapshot.chunks[index]).slice(1, -1);
    snapshot.chunks[index] = '';
    yield checked(escaped);
  }
  yield checked('"}');
}
