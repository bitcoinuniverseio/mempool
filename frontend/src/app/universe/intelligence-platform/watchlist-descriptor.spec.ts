import { describe, expect, it } from 'vitest';
import { checksumCreate } from 'utxo-descriptors';
import { descriptorScripts } from './watchlist-descriptor';

const key = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const expression = `wpkh(${key}/0/*)`;
const descriptor = expression + '#' + checksumCreate(expression);
describe('descriptor watch registration', () => {
  it('derives distinct script byte hashes for the exact selected range', () => {
    const scripts = descriptorScripts(descriptor, 'mainnet', 4, 2);
    expect(scripts.children.map(row => row.derivation_index)).toEqual([4, 5]);
    expect(scripts.children.every(row => /^[a-f0-9]{64}$/.test(row.script_hash))).toBe(true);
    expect(scripts.children[0].script_hash).not.toBe(scripts.children[1].script_hash);
  });
  it('rejects unchecked, wrong network, private and unbounded inputs before registration', () => {
    expect(() => descriptorScripts(expression, 'mainnet', 0, 1)).toThrow();
    expect(() => descriptorScripts(descriptor, 'signet', 0, 1)).toThrow();
    expect(() => descriptorScripts('wpkh(xprvPRIVATE)', 'mainnet', 0, 1)).toThrow();
    expect(() => descriptorScripts(descriptor, 'mainnet', 0, 1001)).toThrow();
  });
});
