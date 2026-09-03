import { describe, expect, it } from 'vitest';

import { parseAuxPowBlock } from './auxpow-parser';
import { hash as sha256 } from '@app/shared/sha256';

/**
 * The vectors are constructed from parts, so every field is known and every
 * verdict can be asserted exactly. A real block from the chain parses by
 * the same code path the tests exercise.
 */

function writeUint32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function reversed(bytes: Uint8Array): string {
  return [...bytes].reverse().map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function varint(value: number): number[] {
  if (value < 0xfd) { return [value]; }
  return [0xfd, value & 0xff, (value >>> 8) & 0xff];
}

function headerBytes(options: { version: number; merkleRoot?: Uint8Array }): Uint8Array {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, options.version, true);
  bytes.fill(0xab, 4, 36); // previous hash
  bytes.set(options.merkleRoot ?? bytes.subarray(0, 32).map(() => 0xcd), 36);
  view.setUint32(68, 1_700_000_000, true);
  view.setUint32(72, 0x1b34a5c7, true);
  view.setUint32(76, 42, true);
  return bytes;
}

function coinbaseBytes(options: { auxCommitment?: Uint8Array; tag?: string }): Uint8Array {
  const script: number[] = [];
  if (options.tag) {
    const text = options.tag;
    script.push(text.length, ...[...text].map((character) => character.charCodeAt(0)));
  }
  if (options.auxCommitment) {
    const first = options.auxCommitment.slice(0, 32);
    const second = options.auxCommitment.slice(32, 64);
    script.push(0x20, ...first, 0x20, ...second);
  }
  const parts: number[] = [];
  parts.push(1, 0, 0, 0); // version
  parts.push(1); // one input
  parts.push(...Array(32).fill(0)); // null prevout
  parts.push(0xff, 0xff, 0xff, 0xff); // prevout index
  parts.push(...varint(script.length), ...script);
  parts.push(0xff, 0xff, 0xff, 0xff); // sequence
  parts.push(1); // one output
  parts.push(0, 0, 0, 0, 0, 0, 0, 0); // value
  const outScript = [0x41, ...Array(65).fill(0x51)];
  parts.push(...varint(outScript.length), ...outScript);
  parts.push(0, 0, 0, 0); // locktime
  return new Uint8Array(parts);
}

function auxpowBlock(options: {
  version: number;
  commitment?: Uint8Array;
  tag?: string;
  branchCount?: number;
}): string {
  const dogeHeader = headerBytes({ version: options.version });
  const coinbase = coinbaseBytes({ auxCommitment: options.commitment, tag: options.tag });
  const parentHeader = headerBytes({ version: 0x20000000 });
  const branchCount = options.branchCount ?? 0;
  const parts: number[] = [];
  parts.push(...dogeHeader);
  parts.push(...varint(coinbase.length), ...coinbase);
  parts.push(...varint(branchCount));
  for (let i = 0; i < branchCount; i++) {
    parts.push(...Array(32).fill(i + 1));
  }
  parts.push(...writeUint32(0)); // chain index
  parts.push(...parentHeader);
  return toHex(new Uint8Array(parts));
}

describe('parseAuxPowBlock', () => {
  it('parses a well formed merge mined block and verifies its own commitment', () => {
    const dogeHeader = headerBytes({ version: 0x20000000 });
    const auxHash = sha256d(dogeHeader);
    const commitment = new Uint8Array([...auxHash.slice(0, 32), ...auxHash.slice(0, 32).map((b) => b ^ 0)] );
    // XOR of halves must equal the header hash: place the hash and zeros.
    const zeros = new Uint8Array(32);
    const pair = new Uint8Array(64);
    pair.set(auxHash, 0);
    pair.set(zeros, 32);
    const block = auxpowBlock({ version: 0x20000000, commitment: pair });
    const result = parseAuxPowBlock(block);
    expect(result.state).toBe('parsed');
    if (result.state !== 'parsed') { return; }
    expect(result.commitment.state).toBe('verified');
    expect(result.parentHeader.hash).toBe(reversed(sha256d(headerBytes({ version: 0x20000000 }))));
    expect(result.chainIndex).toBe(0);
    expect(result.branchHashes).toHaveLength(0);
  });

  it('reads the pool tag text out of the coinbase without claiming it', () => {
    const block = auxpowBlock({ version: 0x20000000, tag: 'MiningPoolDemo' });
    const result = parseAuxPowBlock(block);
    expect(result.state).toBe('parsed');
    if (result.state !== 'parsed') { return; }
    expect(result.coinbase.readableScriptText).toContain('MiningPoolDemo');
  });

  it('reports a mismatched commitment as a mismatch, not as verified', () => {
    const wrong = new Uint8Array(64).fill(7);
    const result = parseAuxPowBlock(auxpowBlock({ version: 0x20000000, commitment: wrong }));
    expect(result.state).toBe('parsed');
    if (result.state !== 'parsed') { return; }
    expect(result.commitment.state).toBe('mismatch');
  });

  it('reports a block without the merge mining flag as having no proof', () => {
    const result = parseAuxPowBlock(auxpowBlock({ version: 2 }));
    expect(result.state).toBe('error');
    if (result.state !== 'error') { return; }
    expect(result.message).toContain('merge mining flag');
  });

  it('refuses input that is not hexadecimal', () => {
    expect(parseAuxPowBlock('zzzz').state).toBe('error');
    expect(parseAuxPowBlock('abc').state).toBe('error');
  });

  it('refuses a bare header: there is no proof in eighty bytes', () => {
    const result = parseAuxPowBlock(toHex(headerBytes({ version: 0x20000000 })));
    expect(result.state).toBe('error');
  });

  it('refuses a proof with bytes left over', () => {
    const block = auxpowBlock({ version: 0x20000000 }) + 'ff';
    const result = parseAuxPowBlock(block);
    expect(result.state).toBe('error');
    if (result.state !== 'error') { return; }
    expect(result.message).toContain('left over');
  });
});
