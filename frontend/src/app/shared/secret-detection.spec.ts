import { describe, expect, it } from 'vitest';

import { looksSecretLike } from './secret-detection';

describe('looksSecretLike', () => {
  it('names extended private keys by their version prefixes', () => {
    expect(looksSecretLike('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi')).toBe(true);
    expect(looksSecretLike('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5')).toBe(true);
    expect(looksSecretLike('tprv8ZgxMBicQKsPe5kWciaVYyDug6C9nW8ZK4bs7BwdDyVfTumesBtNef')).toBe(true);
  });

  it('names WIF keys without confusing them with addresses', () => {
    expect(looksSecretLike('5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF')).toBe(true);
    expect(looksSecretLike('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ')).toBe(true);
    expect(looksSecretLike('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
  });

  it('names a BIP38 passphrase', () => {
    expect(looksSecretLike('6PYMNcohGBJEAXRsc2kMXaTAEVy51dCMzCWWKBK3NxxF2ZmWGeu3Bv7VsW')).toBe(true);
  });

  it('names a twelve word phrase, and leaves ordinary text alone', () => {
    const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
    expect(looksSecretLike(words.join(' '))).toBe(true);
    expect(looksSecretLike('kind:rune status:active frost')).toBe(false);
    expect(looksSecretLike('mempool clusters')).toBe(false);
    expect(looksSecretLike('')).toBe(false);
  });

  it('does not mistake a transaction id for a key', () => {
    expect(looksSecretLike('a'.repeat(64))).toBe(false);
  });
});
