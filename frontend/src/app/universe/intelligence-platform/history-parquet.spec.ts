import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readHistoryParquet } from './history-parquet';

// Real controlled writer bytes independently read by PyArrow 23.0.1.
// These fixtures establish serialization interoperability, not native chain facts.
const fixture = (name: string) => {
  const buffer = readFileSync(new URL('./fixtures/history-parquet/' + name + '.parquet', import.meta.url));
  const file = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const capture = JSON.parse(readFileSync(new URL('./fixtures/history-parquet/' + name + '.capture.json', import.meta.url), 'utf8'));
  return {file, capture};
};
describe('bounded retained Parquet binary evidence reader', () => {
  for (const name of ['empty', 'populated']) {
    it('reads the exact ' + name + ' snapshot and sorted membership from real Parquet bytes', async () => {
      const {file, capture} = fixture(name);
      expect(await readHistoryParquet(file, capture.network)).toEqual({format: 'parquet', state: capture.state, txids: [...capture.txids].sort()});
    });
  }
  it('rejects a genuine file bound to a foreign selected network', async () => {
    const {file} = fixture('populated'); await expect(readHistoryParquet(file, 'testnet4')).rejects.toThrow();
  });
  it('rejects missing magic, excessive footer size and truncated bytes before decoding', async () => {
    const {file} = fixture('populated');
    const badMagic = file.slice(0); new Uint8Array(badMagic)[0] = 0;
    const badFooter = file.slice(0); new DataView(badFooter).setUint32(badFooter.byteLength - 8, 0x7fffffff, true);
    for (const malformed of [badMagic, badFooter, file.slice(0, file.byteLength - 1), new ArrayBuffer(0)]) { await expect(readHistoryParquet(malformed, 'signet')).rejects.toThrow(); }
  });
  it('rejects a structurally decodable file with a false snapshot row kind', async () => {
    const {file} = fixture('populated'), bytes = new Uint8Array(file), needle = new TextEncoder().encode('snapshot');
    let changed = false;
    for (let i = 0; i <= bytes.length - needle.length; i++) {
      if (needle.every((value, index) => bytes[i + index] === value)) { bytes[i + 7] = 'x'.charCodeAt(0); changed = true; }
    }
    expect(changed).toBe(true); await expect(readHistoryParquet(file, 'signet')).rejects.toThrow();
  });
});
