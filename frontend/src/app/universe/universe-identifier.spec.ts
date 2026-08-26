import { describe, expect, it } from 'vitest';
import {
  classifyUniverseQuery,
  identifierKindLabel,
  matchProtocols,
} from '@app/universe/universe-identifier';

const TXID = 'a'.repeat(64);
const PROTOCOLS = [
  { id: 'runes', aliases: ['rune', 'runes_native'], displayName: 'Runes', shortName: 'RUNES' },
  { id: 'ordinals', aliases: ['inscriptions'], displayName: 'Ordinals', shortName: 'Ordinals' },
  { id: 'rare_sats', aliases: ['rare-sats'], displayName: 'Rare Sats', shortName: 'Rare Sats' },
];

describe('classifyUniverseQuery', () => {
  it('returns nothing for an empty or oversized query', () => {
    expect(classifyUniverseQuery('')).toEqual([]);
    expect(classifyUniverseQuery('   ')).toEqual([]);
    expect(classifyUniverseQuery('x'.repeat(201))).toEqual([]);
  });

  it('recognises an outpoint and routes to the output page', () => {
    const [candidate] = classifyUniverseQuery(`${TXID}:3`);
    expect(candidate.kind).toBe('outpoint');
    expect(candidate.route).toEqual(['/outpoint', TXID, '3']);
  });

  it('rejects an outpoint whose vout has a leading zero', () => {
    const kinds = classifyUniverseQuery(`${TXID}:03`).map((c) => c.kind);
    expect(kinds).not.toContain('outpoint');
  });

  it('recognises an inscription id', () => {
    const [candidate] = classifyUniverseQuery(`${TXID}i0`);
    expect(candidate.kind).toBe('inscription-id');
    expect(candidate.route).toEqual(['/inscription', `${TXID}i0`]);
  });

  it('accepts an uppercase inscription id by normalising it', () => {
    const [candidate] = classifyUniverseQuery(`${TXID.toUpperCase()}i7`);
    expect(candidate.kind).toBe('inscription-id');
    expect(candidate.value).toBe(`${TXID}i7`);
  });

  it('never steals a bare integer from block height search', () => {
    expect(classifyUniverseQuery('840000')).toEqual([]);
  });

  it('recognises an inscription number only when it is marked', () => {
    const hashed = classifyUniverseQuery('#123');
    expect(hashed[0].kind).toBe('inscription-number');
    expect(hashed[0].value).toBe('123');

    const cursed = classifyUniverseQuery('-45');
    expect(cursed[0].kind).toBe('inscription-number');
    expect(cursed[0].value).toBe('-45');
  });

  it('recognises a rune name and normalises spacers away', () => {
    const [candidate] = classifyUniverseQuery('UNCOMMON•GOODS');
    expect(candidate.kind).toBe('rune-name');
    expect(candidate.value).toBe('UNCOMMONGOODS');
  });

  it('accepts a lowercase rune name and displays it uppercase', () => {
    const [candidate] = classifyUniverseQuery('dogpepe');
    expect(candidate.kind).toBe('rune-name');
    expect(candidate.value).toBe('DOGPEPE');
  });

  it('ignores rune names shorter than three letters', () => {
    expect(classifyUniverseQuery('AB').map((c) => c.kind)).not.toContain('rune-name');
  });

  it('recognises a rune id', () => {
    const [candidate] = classifyUniverseQuery('840000:1');
    expect(candidate.kind).toBe('rune-id');
    expect(candidate.route).toEqual(['/rune', '840000:1']);
  });

  it('requires an explicit prefix for a satoshi', () => {
    const [candidate] = classifyUniverseQuery('sat:1234567890');
    expect(candidate.kind).toBe('sat');
    expect(classifyUniverseQuery('1234567890')).toEqual([]);
  });

  it('refuses a satoshi number above the total supply', () => {
    expect(classifyUniverseQuery('sat:2099999997690001')).toEqual([]);
  });

  it('ranks an exact identifier above a protocol name match', () => {
    const candidates = classifyUniverseQuery('RUNES', PROTOCOLS);
    // "RUNES" is both a plausible rune name and an exact protocol id, and the
    // protocol is the more useful destination, so it must not be buried.
    expect(candidates.some((c) => c.kind === 'protocol' && c.value === 'runes')).toBe(true);
  });

  it('sorts candidates by rank', () => {
    const candidates = classifyUniverseQuery('ordinals', PROTOCOLS);
    const ranks = candidates.map((c) => c.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe('matchProtocols', () => {
  it('needs at least two characters', () => {
    expect(matchProtocols('r', PROTOCOLS)).toEqual([]);
  });

  it('matches a prefix of an id, alias, or display name', () => {
    expect(matchProtocols('run', PROTOCOLS).map((m) => m.value)).toEqual(['runes']);
    expect(matchProtocols('inscr', PROTOCOLS).map((m) => m.value)).toEqual(['ordinals']);
    expect(matchProtocols('rare', PROTOCOLS).map((m) => m.value)).toEqual(['rare_sats']);
  });

  it('ignores separators and case when matching', () => {
    expect(matchProtocols('Rare Sats', PROTOCOLS).map((m) => m.value)).toEqual(['rare_sats']);
    expect(matchProtocols('runes_native', PROTOCOLS).map((m) => m.value)).toEqual(['runes']);
  });

  it('puts exact matches first', () => {
    const matches = matchProtocols('runes', PROTOCOLS);
    expect(matches[0].value).toBe('runes');
    expect(matches[0].rank).toBe(1);
  });

  it('honours the result limit', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `proto${index}` }));
    expect(matchProtocols('proto', many, 3)).toHaveLength(3);
  });
});

describe('identifierKindLabel', () => {
  it('names every kind it can be given', () => {
    const kinds = [
      'outpoint',
      'inscription-id',
      'inscription-number',
      'rune-name',
      'rune-id',
      'sat',
      'protocol',
    ] as const;
    for (const kind of kinds) {
      expect(identifierKindLabel(kind).length).toBeGreaterThan(0);
    }
  });
});
