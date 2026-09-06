import { describe, expect, it } from 'vitest';
import {
  classifyDescriptor,
  classifyExtendedKey,
  deriveAccountXpubFromSeed,
  deriveAddressBatch,
} from './derivation';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { createHash } from 'node:crypto';
import { createBase58check } from '@scure/base';
import type { ScriptKind } from '../stores/portfolio-model';
import { checksumCreate } from 'utxo-descriptors';

// BIP84 vector 1: the protocol twelve-word test mnemonic and its famous
// first external native-SegWit address. If derivation or encoding drifts,
// this constant is what fails.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BIP84_VECTOR1_FIRST_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const publicFixture = 'xpub6CFtfy4QXsEUW5CtgE7mZe1Lvs15Yw7ctjdyaDRy89JdhtyM1wFf8uY2BdyJ3JmAFfrHdw77hEit1ebVXxB2dytGAvq9mmQJ2c83G1q8P7A';
const checkedBase58 = createBase58check(bytes => createHash('sha256').update(bytes).digest());
const versionedFixture = (version: number): string => {
  const payload = checkedBase58.decode(publicFixture);
  new DataView(payload.buffer, payload.byteOffset, payload.byteLength).setUint32(0, version);
  return checkedBase58.encode(payload);
};
// Same public account key and m/0/0 child. Expected script addresses were
// independently encoded with backend bitcoinjs-lib, not this helper.
const publicVersions: readonly [string, number, ScriptKind, boolean, string][] = [
  ['xpub', 0x0488b21e, 'p2pkh', false, '1KahbQ6ik1D6WXqhBcA8KPmTWLqkiZwvx1'],
  ['ypub', 0x049d7cb2, 'p2sh-p2wpkh', false, '3Qu6tgTDyVQobEkou2z4wC91xByR239usm'],
  ['zpub', 0x04b24746, 'p2wpkh', false, 'bc1qe0g7q5f92pqjy3jfaana4qyzs5y9d2vrdx64ff'],
  ['tpub', 0x043587cf, 'p2pkh', true, 'mz6etTBhZ2eMHeKJuB8W9JynNLSTbg6rtK'],
  ['upub', 0x044a5262, 'p2sh-p2wpkh', true, '2NGTJxRPFawv9o2PMaAbwZ98HAYBampsrRR'],
  ['vpub', 0x045f1cf6, 'p2wpkh', true, 'tb1qe0g7q5f92pqjy3jfaana4qyzs5y9d2vr8qpxj6'],
];

describe('watch-only derivation', () => {
  it.each(publicVersions)('preserves the %s descriptor network and rejects a conflicting requested network', (_prefix, version, script, testnet) => {
    const key = versionedFixture(version);
    const expression = script === 'p2pkh' ? `pkh(${key}/0/*)`
      : script === 'p2sh-p2wpkh' ? `sh(wpkh(${key}/0/*))` : `wpkh(${key}/0/*)`;
    const descriptor = expression + '#' + checksumCreate(expression);
    expect(classifyDescriptor(descriptor)).toMatchObject({ testnet, script, extendedKeys: [key], checksumValid: true });
    expect(classifyDescriptor(descriptor, testnet)).toMatchObject({ testnet });
    expect(classifyDescriptor(descriptor, !testnet)).toBeNull();
  });

  it('rejects mixed descriptor networks and invalid public key checksums', () => {
    const testnetKey = versionedFixture(0x043587cf);
    expect(classifyDescriptor(`wsh(sortedmulti(2,${publicFixture}/0/*,${testnetKey}/0/*))`)).toBeNull();
    const brokenKey = publicFixture.slice(0, -1) + '1';
    expect(classifyDescriptor(`wpkh(${brokenKey}/0/*)`)).toBeNull();
  });

  it.each(publicVersions)('accepts %s with its declared public version and derives the known script address', (prefix, version, script, testnet, expected) => {
    const key = versionedFixture(version);
    expect(key.startsWith(prefix)).toBe(true);
    expect(classifyExtendedKey(key)).toEqual({ kind: 'xpub', key, script, testnet });
    expect(deriveAddressBatch({ key, script, testnet, branch: 'external', start: 0, count: 1 }).addresses)
      .toEqual([{ index: 0, address: expected }]);
  });

  it('rejects corrupted public checksums and a different version that retains the public prefix', () => {
    const wrongVersion = versionedFixture(0x04b24747);
    expect(wrongVersion.startsWith('zpub')).toBe(true);
    for (const key of [publicFixture.slice(0, -1) + '1', wrongVersion]) {
      expect(classifyExtendedKey(key)).toBeNull();
      expect(() => deriveAddressBatch({ key, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 1 })).toThrow();
    }
  });

  it('rejects private payloads even when encoded with a public-looking version', () => {
    const payload = checkedBase58.decode(publicFixture);
    payload[45] = 0;
    payload.fill(1, 46);
    const publicLooking = checkedBase58.encode(payload);
    expect(publicLooking.startsWith('xpub')).toBe(true);
    new DataView(payload.buffer, payload.byteOffset, payload.byteLength).setUint32(0, 0x0488ade4);
    const privateKey = checkedBase58.encode(payload);
    for (const key of [publicLooking, privateKey]) {
      expect(classifyExtendedKey(key)).toBeNull();
      expect(() => deriveAddressBatch({ key, script: 'p2pkh', testnet: false, branch: 'external', start: 0, count: 1 })).toThrow();
    }
  });

  it('reproduces the BIP84 vector 1 first receive address from the mnemonic seed', () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const xpub = deriveAccountXpubFromSeed(seed, 'p2wpkh', 0);
    const batch = deriveAddressBatch({
      key: xpub,
      script: 'p2wpkh',
      testnet: false,
      branch: 'external',
      start: 0,
      count: 1,
    });
    expect(batch.addresses[0].address).toBe(BIP84_VECTOR1_FIRST_ADDRESS);
  });

  it('classifies extended public keys by script kind', () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const xpub = deriveAccountXpubFromSeed(seed, 'p2wpkh', 0);
    const info = classifyExtendedKey(xpub);
    expect(info).not.toBeNull();
    expect(info!.script).toBe('p2pkh'); // xpub version bytes mean legacy scripts
    expect(classifyExtendedKey('not-a-key')).toBeNull();
  });

  it('rejects anything private before deriving', () => {
    expect(classifyExtendedKey('xprv9s21ZrQH143K')).toBeNull();
  });

  it('derives distinct change-branch addresses', () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const xpub = deriveAccountXpubFromSeed(seed, 'p2wpkh', 0);
    const external = deriveAddressBatch({ key: xpub, script: 'p2wpkh', testnet: false, branch: 'external', start: 0, count: 2 });
    const internal = deriveAddressBatch({ key: xpub, script: 'p2wpkh', testnet: false, branch: 'internal', start: 0, count: 2 });
    expect(external.addresses[0].address).not.toBe(internal.addresses[0].address);
    expect(external.addresses[0].address).not.toBe(external.addresses[1].address);
  });

  it('validates descriptor checksums and rejects a bad one', () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const xpub = deriveAccountXpubFromSeed(seed, 'p2wpkh', 0);
    const broken = classifyDescriptor(`wpkh(${xpub}/0/*)#wrongchecksum`);
    expect(broken).not.toBeNull();
    expect(broken!.checksumValid).toBe(false);
  });

  it('validates mnemonic phrases through the audited wordlist', () => {
    expect(validateMnemonic(MNEMONIC, wordlist)).toBe(true);
  });
});
