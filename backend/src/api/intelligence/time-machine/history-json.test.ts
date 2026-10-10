import { createHash } from 'crypto';
import { captureHistoryJson, historyEnvelopeChunks, HistoryJsonArray } from './history-json';

describe('bounded history JSON capture and streamed envelope', () => {
  it.each([
    { null: null, missing: undefined, number: Infinity, fraction: -0.1, array: Object.assign(new Array(4), { 0: undefined, 2: NaN, 3: true }) },
    { unicode: '\ud800🌍\ude00"\\\n\t', date: new Date('2026-10-10T00:00:00Z') },
    { boxed: new Number(5), toJSON: () => ({ key: 'transformed' }) },
    { nested: [{ vsize: 100, weight: 400, fee: 200 }], '2': 2, '1': 1 },
  ])('preserves JSON.stringify bytes and checksum for supported history values', value => {
    const expected = JSON.stringify(value);
    const captured = captureHistoryJson(value, 1024 * 1024);
    expect(captured.chunks.join('')).toBe(expected);
    expect(captured.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
    const envelope = [...historyEnvelopeChunks(captured, 'signet', 2 * 1024 * 1024)].join('');
    expect(envelope).toBe(JSON.stringify({ schema: 'mempool-history-v1', network: 'signet',
      sha256: createHash('sha256').update(expected).digest('hex'), body: expected }));
  });
  it('rejects boxed BigInt roots, nested values and masked brands instead of persisting empty objects', () => {
    const masked = Object(BigInt(1)); Object.defineProperty(masked, Symbol.toStringTag, { value: 'Object' });
    for (const value of [Object(BigInt(1)), { value: Object(BigInt(1)) }, masked]) {
      expect(() => JSON.stringify(value)).toThrow(TypeError);
      expect(() => captureHistoryJson(value, 4096)).toThrow(/BigInt/);
    }
    const explicit = Object(BigInt(1)); explicit.toJSON = () => '1';
    expect(captureHistoryJson(explicit, 4096).chunks.join('')).toBe(JSON.stringify(explicit));
  });
  it('captures immutable bytes before an async writer can observe later mutations', () => {
    const entries = new Map([['a', { fee: 1 }]]);
    const captured = captureHistoryJson({ transactions: new HistoryJsonArray(entries) }, 1024);
    entries.set('b', { fee: 2 }); entries.get('a')!.fee = 3;
    expect(JSON.parse(JSON.parse([...historyEnvelopeChunks(captured, 'signet', 4096)].join('')).body))
      .toEqual({ transactions: [['a', { fee: 1 }]] });
  });
  it('keeps Unicode code points valid across body and envelope chunk boundaries', () => {
    const value = { text: 'x'.repeat(16380) + '🌍'.repeat(10000) + '\ud800' };
    const captured = captureHistoryJson(value, 1024 * 1024);
    expect(captured.chunks.length).toBeGreaterThan(2);
    expect(captured.chunks.every(chunk => chunk.length <= 16384)).toBe(true);
    const expected = JSON.stringify(value);
    expect(captured.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
    const decoded = JSON.parse([...historyEnvelopeChunks(captured, 'signet', 2 * 1024 * 1024)].join(''));
    expect(decoded.body).toBe(expected);
    expect(captured.chunks.every(chunk => chunk === '')).toBe(true);
  });
  it('stops a huge lazy entry source at the byte fence before consuming its tail', () => {
    let visited = 0;
    function* entries(): Generator<unknown> { for (let index = 0; index < 1_000_000; index++) { visited++; yield ['a'.repeat(64), { fee: index }]; } }
    expect(() => captureHistoryJson(new HistoryJsonArray(entries()), 4096)).toThrow(/storage limit/);
    expect(visited).toBeLessThan(60);
  });
  it('enforces UTF8 body and escaped envelope byte budgets independently', () => {
    expect(() => captureHistoryJson('🌍'.repeat(20000), 1024)).toThrow(/storage limit/);
    const captured = captureHistoryJson('\\'.repeat(200), 1024);
    expect(() => [...historyEnvelopeChunks(captured, 'signet', 500)]).toThrow(/envelope/);
  });
  it('rejects cycles and invalid roots without confusing repeated ordinary references', () => {
    const object: any = {}; object.self = object;
    expect(() => captureHistoryJson(object, 1024)).toThrow(/cycle/);
    expect(() => captureHistoryJson(undefined, 1024)).toThrow(/serializable/);
    expect(() => captureHistoryJson(BigInt(1), 1024)).toThrow(/BigInt/);
    const entry = { fee: 1 };
    expect(captureHistoryJson([entry, entry], 1024).chunks.join('')).toBe(JSON.stringify([entry, entry]));
  });
});
