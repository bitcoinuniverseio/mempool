import { describe, expect, it } from 'vitest';
import {
  looksLikeDescriptor,
  looksLikePublicExtendedKey,
  looksSecretLike,
  secretRejectionCopy,
} from './secret-detection';

describe('secret input defenses', () => {
  it('rejects extended private keys before any network request', () => {
    expect(looksSecretLike('xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeC6PSjFbUC7CJqptnqLDj7DhYb9CmU79eaYPCD8PXopE Provincial')).toEqual({
      secret: true,
      kind: 'extended-private-key',
    });
    expect(looksSecretLike('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvW6pggHH5jCJXKdfo4zYW9GNmPw8viVmy tY9uJbWLK7').kind).toBe(
      'extended-private-key',
    );
  });

  it('rejects WIF keys', () => {
    expect(looksSecretLike('KwdMAjGmerYanuiRcShBQjCZtsVnsG3Wd31qv69qZXXepty5pvCr').kind).toBe('wif-private-key');
    expect(looksSecretLike('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ').kind).toBe('wif-private-key');
  });

  it('rejects likely mnemonic phrases', () => {
    const mnemonic = Array(12).fill('abandon').join(' ');
    expect(looksSecretLike(mnemonic).kind).toBe('mnemonic-phrase');
  });

  it('rejects raw private-key hex', () => {
    expect(looksSecretLike('a'.repeat(64)).kind).toBe('raw-private-key-hex');
  });

  it('accepts public watch-only material', () => {
    expect(looksSecretLike('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toEqual({
      secret: false,
      kind: null,
    });
    expect(looksSecretLike('xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDHsk3PeQXtoy3xsxC7UIFjUbycq6YMg7WkApfJCJgcVdJZELzPScGZCHQb8QlaXYUYEwogYw8').secret).toBe(false);
    expect(looksLikePublicExtendedKey('zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs')).toBe(true);
    expect(looksLikePublicExtendedKey('xprv9s21ZrQH143K')).toBe(false);
  });

  it('rejects seed-export and wallet backup file names', () => {
    expect(looksSecretLike('my-wallet.seed').kind).toBe('seed-export-file');
    expect(looksSecretLike('wallet-backup.bak').kind).toBe('seed-export-file');
  });

  it('never echoes input in the rejection copy', () => {
    const copy = secretRejectionCopy('mnemonic-phrase');
    expect(copy).not.toContain('abandon');
    expect(copy).toContain('discarded');
  });

  it('recognizes descriptor shapes', () => {
    expect(looksLikeDescriptor('wpkh(xpub6ASuArnXKPbfEwhqN6e3mwRcDT2ofsyBNUOrangeM7REcG9gtPUZfsPxd3tJNJLxwglm2ELWfWc5DhYTBVZPBLbLUcX6vyf2iYm9Et32yZDp/0/*)')).toBe(true);
    expect(looksLikeDescriptor('bc1qexample')).toBe(false);
  });
});
