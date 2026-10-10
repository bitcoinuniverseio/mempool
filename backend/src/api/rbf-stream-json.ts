import { TextDecoder } from 'util';

export type JsonPath = Array<string | number>;
export interface JsonEvent { kind: 'object-start' | 'array-start' | 'object-end' | 'array-end' | 'scalar'; path: JsonPath; start: number; end: number; value?: unknown }
export interface JsonScanOptions {
  signal?: AbortSignal;
  captureString: (path: JsonPath) => boolean;
  onEvent: (event: JsonEvent, chunk: Buffer, base: number) => void;
  onChunk?: (chunk: Buffer, base: number) => void;
  maximumKeyBytes?: number;
}
type Frame = { type: 'object' | 'array'; path: JsonPath; start: number; state: string; keys: Set<string>; key?: string; index: number };
const fail = (): never => { throw new Error('RBF stream JSON invalid or over bounded grammar resources'); };
const whitespace = (b: number): boolean => b === 32 || b === 9 || b === 10 || b === 13;
const numberByte = (b: number): boolean => b >= 48 && b <= 57 || [45,43,46,69,101].includes(b);

/** Unactivated large-cache foundation. Validates skipped strings without allocating them.
 * @asyncUnsafe Rejects malformed input, resource excess, caller cancellation and source iterator errors.
 */
export async function scanRbfJson(chunks: AsyncIterable<Buffer>, options: JsonScanOptions): Promise<{ bytes: number; maximumCapturedTokenBytes: number }> {
  const frames: Frame[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const maximumKeyBytes = options.maximumKeyBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maximumKeyBytes) || maximumKeyBytes < 1 || maximumKeyBytes > 16 * 1024 * 1024) { return fail(); }
  let retainedKeys = 0, total = 0, maximumCapturedTokenBytes = 0;
  const root: { phase: 'value' | 'done' } = { phase: 'value' };
  let token: null | { type: 'string' | 'number' | 'literal'; key: boolean; path: JsonPath; start: number; capture: boolean; raw: number[]; literal?: string; progress: number; escape: boolean; unicode: number } = null;
  const pathForValue = (): JsonPath => {
    const parent = frames.at(-1);
    return parent ? [...parent.path, parent.type === 'array' ? parent.index : parent.key!] : [];
  };
  const expectingValue = (): boolean => {
    const f = frames.at(-1); return f ? ['value', 'value-or-end'].includes(f.state) : root.phase === 'value';
  };
  const finishValue = (): void => {
    const f = frames.at(-1);
    if (!f) { root.phase = 'done'; return; }
    if (!['value', 'value-or-end'].includes(f.state)) { return fail(); }
    f.state = 'comma-or-end'; if (f.type === 'array') { f.index++; }
  };
  const emit = (kind: JsonEvent['kind'], path: JsonPath, start: number, end: number, chunk: Buffer, base: number, value?: unknown): void => {
    options.onEvent({ kind, path, start, end, value }, chunk, base);
  };
  const append = (b: number): void => {
    if (!token) { return fail(); }
    if (token.capture) {
      if (token.raw.length >= (token.key ? 4096 : token.type === 'string' ? 4096 : 128)) { return fail(); }
      token.raw.push(b); maximumCapturedTokenBytes = Math.max(maximumCapturedTokenBytes, token.raw.length);
    }
  };
  for await (const chunk of chunks) {
    if (!Buffer.isBuffer(chunk) || chunk.length > 64 * 1024) { return fail(); }
    if (options.signal?.aborted) { throw new Error('RBF stream cancelled'); }
    decoder.decode(chunk, { stream: true });
    const base = total;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i], at = base + i;
      if (token) {
        if (token.type === 'string') {
          append(b);
          if (token.unicode) {
            if (!(b >= 48 && b <= 57 || b >= 65 && b <= 70 || b >= 97 && b <= 102)) { return fail(); }
            token.unicode--; continue;
          }
          if (token.escape) {
            token.escape = false;
            if (b === 117) { token.unicode = 4; }
            else if (![34,92,47,98,102,110,114,116].includes(b)) { return fail(); }
            continue;
          }
          if (b === 92) { token.escape = true; continue; }
          if (b === 34) {
            const value = token.capture ? JSON.parse(Buffer.from(token.raw).toString('utf8')) : undefined;
            if (token.key) {
              const f = frames.at(-1)!;
              if (f.keys.has(value)) { return fail(); }
              retainedKeys += Buffer.byteLength(value); if (retainedKeys > maximumKeyBytes) { return fail(); }
              f.keys.add(value); f.key = value; f.state = 'colon';
            } else { emit('scalar', token.path, token.start, at + 1, chunk, base, value); finishValue(); }
            token = null; continue;
          }
          if (b < 32) { return fail(); }
          continue;
        }
        if (token.type === 'literal') {
          if (b !== token.literal!.charCodeAt(token.progress++)) { return fail(); }
          if (token.progress === token.literal!.length) {
            emit('scalar', token.path, token.start, at + 1, chunk, base, JSON.parse(token.literal!)); token = null; finishValue();
          }
          continue;
        }
        if (numberByte(b)) { append(b); continue; }
        const raw = Buffer.from(token.raw).toString('ascii');
        if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) { return fail(); }
        emit('scalar', token.path, token.start, at, chunk, base, Number(raw)); token = null; finishValue(); i--; continue;
      }
      if (whitespace(b)) { continue; }
      const f = frames.at(-1);
      if (f && (b === 125 || b === 93)) {
        const correct = f.type === 'object' ? b === 125 && ['key-or-end','comma-or-end'].includes(f.state)
          : b === 93 && ['value-or-end','comma-or-end'].includes(f.state);
        if (!correct) { return fail(); }
        frames.pop(); for (const key of f.keys) { retainedKeys -= Buffer.byteLength(key); }
        emit(f.type === 'object' ? 'object-end' : 'array-end', f.path, f.start, at + 1, chunk, base); finishValue(); continue;
      }
      if (f?.state === 'colon') { if (b !== 58) { return fail(); } f.state = 'value'; continue; }
      if (f?.state === 'comma-or-end') {
        if (b !== 44) { return fail(); } f.state = f.type === 'object' ? 'key' : 'value'; continue;
      }
      if (f?.type === 'object' && ['key','key-or-end'].includes(f.state)) {
        if (b !== 34) { return fail(); }
        token = { type:'string', key:true, path:f.path, start:at, capture:true, raw:[34], progress:0, escape:false, unicode:0 }; continue;
      }
      if (!expectingValue()) { return fail(); }
      const path = pathForValue();
      if (b === 123 || b === 91) {
        if (frames.length >= 64) { return fail(); }
        const type = b === 123 ? 'object' : 'array';
        emit(type === 'object' ? 'object-start' : 'array-start', path, at, at + 1, chunk, base);
        frames.push({ type, path, start:at, state:type === 'object' ? 'key-or-end' : 'value-or-end', keys:new Set(), index:0 }); continue;
      }
      if (b === 34) {
        token = { type:'string', key:false, path, start:at, capture:options.captureString(path), raw:[], progress:0, escape:false, unicode:0 }; append(34); continue;
      }
      if (b === 45 || b >= 48 && b <= 57) {
        token = { type:'number', key:false, path, start:at, capture:true, raw:[], progress:0, escape:false, unicode:0 }; append(b); continue;
      }
      const literal = b === 116 ? 'true' : b === 102 ? 'false' : b === 110 ? 'null' : null;
      if (!literal) { return fail(); }
      token = { type:'literal', key:false, path, start:at, capture:false, raw:[], literal, progress:1, escape:false, unicode:0 };
    }
    total += chunk.length; options.onChunk?.(chunk, base);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  if (options.signal?.aborted) { throw new Error('RBF stream cancelled'); }
  decoder.decode();
  if (token?.type === 'number') {
    const raw = Buffer.from(token.raw).toString('ascii');
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) { return fail(); }
    emit('scalar', token.path, token.start, total, Buffer.alloc(0), total, Number(raw)); token = null; finishValue();
  }
  if (token || frames.length || root.phase !== 'done') { return fail(); }
  return { bytes:total, maximumCapturedTokenBytes };
}
