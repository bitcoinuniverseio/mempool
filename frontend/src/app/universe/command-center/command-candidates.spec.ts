import { describe, expect, it } from 'vitest';

import {
  CommandCandidate,
  dedupeCandidates,
  looksSecretLike,
  localCandidates,
} from './command-candidates';

describe('localCandidates', () => {
  it('names a bech32 address on bitcoin, once', () => {
    const candidates = localCandidates('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 'mainnet');
    expect(candidates).toEqual([expect.objectContaining({
      kind: 'address',
      chain: 'bitcoin',
      path: '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
      exact: true,
    })]);
  });

  it('names a legacy address on bitcoin', () => {
    const candidates = localCandidates('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet');
    expect(candidates[0]).toMatchObject({ kind: 'address', chain: 'bitcoin' });
  });

  it('sends a dogecoin address to the dogecoin tree', () => {
    const candidates = localCandidates('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', 'mainnet');
    expect(candidates[0]).toMatchObject({
      kind: 'address',
      chain: 'dogecoin',
      path: '/dogecoin/address/DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    });
  });

  it('names a zcash unified address on the zcash tree', () => {
    const candidates = localCandidates('u1abcdef1234567890', 'mainnet');
    expect(candidates[0]).toMatchObject({ kind: 'address', chain: 'zcash' });
  });

  it('offers both readings of a 64 character hash, and picks neither', () => {
    const hash = 'a'.repeat(64);
    const candidates = localCandidates(hash, 'mainnet');
    expect(candidates.map((candidate) => candidate.kind).sort()).toEqual(['block', 'transaction']);
  });

  it('offers an outpoint with its route', () => {
    const txid = 'b'.repeat(64);
    const candidates = localCandidates(`${txid}:1`, 'mainnet');
    expect(candidates[0]).toMatchObject({
      kind: 'outpoint',
      exact: true,
      path: `/outpoint/${txid}/1`,
    });
  });

  it('recognizes a PSBT by its magic', () => {
    const psbt = 'cHNidP8BAH0CAAAAAZvjrQoyKz0P0X6Z0QvZQ';
    const candidates = localCandidates(psbt, 'mainnet');
    expect(candidates[0]).toMatchObject({ kind: 'psbt', path: '/tools/psbt' });
  });

  it('offers a plausible height as a block', () => {
    const candidates = localCandidates('800000', 'mainnet');
    expect(candidates[0]).toMatchObject({ kind: 'block height', path: '/block/800000' });
  });

  it('returns nothing for text it does not know', () => {
    expect(localCandidates('hello there', 'mainnet')).toEqual([]);
  });

  it('returns nothing for empty or oversized input', () => {
    expect(localCandidates('', 'mainnet')).toEqual([]);
    expect(localCandidates('x'.repeat(5000), 'mainnet')).toEqual([]);
  });

  it('never offers a fractal destination that does not exist yet', () => {
    const candidates = localCandidates('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet');
    expect(candidates.some((candidate) => candidate.chain === 'fractal')).toBe(false);
  });
});

describe('looksSecretLike', () => {
  it('names an extended private key', () => {
    expect(looksSecretLike('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi')).toBe(true);
    expect(looksSecretLike('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5')).toBe(true);
  });

  it('names a WIF key without confusing it with an address', () => {
    expect(looksSecretLike('5Kb8kLf9zgWQnogidDA76MzPL6TsZZY36hWXMssSzNydYXYB9KF')).toBe(true);
    expect(looksSecretLike('L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ')).toBe(true);
  });

  it('names a BIP38 passphrase', () => {
    expect(looksSecretLike('6PYMNcohGBJEAXRsc2kMXaTAEVy51dCMzCWWKBK3NxxF2ZmWGeu3Bv7VsW')).toBe(true);
  });

  it('names a twelve word seed phrase', () => {
    const words = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident'];
    expect(looksSecretLike(words.join(' '))).toBe(true);
    expect(looksSecretLike(words.join(','))).toBe(true);
  });

  it('leaves ordinary queries alone', () => {
    expect(looksSecretLike('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080')).toBe(false);
    expect(looksSecretLike('mempool clusters')).toBe(false);
    expect(looksSecretLike('800000')).toBe(false);
    expect(looksSecretLike('')).toBe(false);
  });

  it('does not mistake a transaction id or a short word run for a seed', () => {
    expect(looksSecretLike('a'.repeat(64))).toBe(false);
    expect(looksSecretLike('kind:rune status:active frost')).toBe(false);
  });
});

describe('dedupeCandidates', () => {
  it('keeps the first candidate for each kind, chain, and path', () => {
    const candidate = (label: string): CommandCandidate => ({
      kind: 'transaction', chain: 'bitcoin', label, path: `/tx/${label}`, source: 'pattern', exact: true,
    });
    expect(dedupeCandidates([candidate('a'), candidate('a'), candidate('b')]))
      .toHaveLength(2);
  });
});
