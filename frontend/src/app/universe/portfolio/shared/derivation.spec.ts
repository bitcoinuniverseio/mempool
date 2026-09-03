import { describe, expect, it } from 'vitest';
import {
  classifyDescriptor,
  classifyExtendedKey,
  deriveAccountXpubFromSeed,
  deriveAddressBatch,
} from './derivation';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// BIP84 vector 1: the protocol twelve-word test mnemonic and its famous
// first external native-SegWit address. If derivation or encoding drifts,
// this constant is what fails.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const BIP84_VECTOR1_FIRST_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

describe('watch-only derivation', () => {
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
