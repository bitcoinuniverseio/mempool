/**
 * Identifier recognition for Universe search.
 *
 * Pure functions, no I/O. The search box has to decide what a user typed
 * before it can route anywhere, and that decision must be deterministic:
 * the same string always produces the same candidate list in the same order.
 * Nothing here calls a network, so a query never leaves the browser to be
 * classified.
 *
 * Base Bitcoin identifiers (address, txid, block hash, block height) stay with
 * the upstream search matcher. This module only adds the identifier classes
 * upstream has no concept of.
 */

export type UniverseIdentifierKind =
  | 'outpoint'
  | 'inscription-id'
  | 'inscription-number'
  | 'rune-name'
  | 'rune-id'
  | 'sat'
  | 'protocol';

export interface UniverseIdentifier {
  readonly kind: UniverseIdentifierKind;
  /** Normalized value used for routing and display. */
  readonly value: string;
  /** Router path segments for this identifier. */
  readonly route: readonly string[];
  /**
   * Rank among candidates for one query. Lower sorts first. Exactness beats
   * plausibility, so a full inscription id outranks a protocol name prefix.
   */
  readonly rank: number;
}

const TXID = /^[0-9a-f]{64}$/;
const UNSIGNED = /^(0|[1-9][0-9]{0,9})$/;
/** Rune names are A to Z with optional spacers, at most 28 letters. */
const RUNE_LETTERS = /^[A-Z]{1,28}$/;
const RUNE_SPACERS = /[•.]/g;

/** Highest sat number that can ever exist, so a plain integer above a block height is still bounded. */
const MAXIMUM_SAT = 2_099_999_997_690_000n;

/** A protocol entry as far as identifier matching is concerned. */
export interface ProtocolNameSource {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly displayName?: string;
  readonly shortName?: string;
}

function outpointOf(text: string): UniverseIdentifier | null {
  const parts = text.split(':');
  if (parts.length !== 2) {return null;}
  const [txid, vout] = parts;
  if (!TXID.test(txid) || !UNSIGNED.test(vout)) {return null;}
  const value = `${txid}:${vout}`;
  return { kind: 'outpoint', value, route: ['/outpoint', txid, vout], rank: 0 };
}

function inscriptionIdOf(text: string): UniverseIdentifier | null {
  const separator = text.indexOf('i');
  if (separator !== 64) {return null;}
  const txid = text.slice(0, 64);
  const index = text.slice(65);
  if (!TXID.test(txid) || !UNSIGNED.test(index)) {return null;}
  const value = `${txid}i${index}`;
  return {
    kind: 'inscription-id',
    value,
    route: ['/inscription', value],
    rank: 0,
  };
}

/**
 * Inscription numbers need an explicit marker. A bare integer is a block
 * height to every Bitcoin user, and silently stealing that meaning would make
 * the most common search in the product unreliable. Cursed inscriptions carry
 * their own marker already, because they are negative.
 */
function inscriptionNumberOf(text: string): UniverseIdentifier | null {
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text.replace(/^#/, '');
  if (body === text && !negative) {return null;}
  if (!UNSIGNED.test(body)) {return null;}
  const value = negative ? `-${body}` : body;
  return {
    kind: 'inscription-number',
    value,
    route: ['/inscription', value],
    rank: 1,
  };
}

function runeIdOf(text: string): UniverseIdentifier | null {
  const parts = text.split(':');
  if (parts.length !== 2) {return null;}
  const [block, index] = parts;
  if (!UNSIGNED.test(block) || !UNSIGNED.test(index)) {return null;}
  const value = `${block}:${index}`;
  return { kind: 'rune-id', value, route: ['/rune', value], rank: 0 };
}

function runeNameOf(text: string): UniverseIdentifier | null {
  const letters = text.replace(RUNE_SPACERS, '');
  if (!RUNE_LETTERS.test(letters)) {return null;}
  // A single letter is far more likely to be a typo than a rune lookup, and
  // very short names would drown out every other candidate.
  if (letters.length < 3) {return null;}
  return {
    kind: 'rune-name',
    value: letters,
    route: ['/rune', letters],
    rank: 2,
  };
}

function satOf(text: string): UniverseIdentifier | null {
  const match = /^sat:(0|[1-9][0-9]{0,15})$/.exec(text);
  if (!match) {return null;}
  if (BigInt(match[1]) > MAXIMUM_SAT) {return null;}
  return { kind: 'sat', value: match[1], route: ['/sat', match[1]], rank: 0 };
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Protocol matches are prefix matches on the id, aliases, and display names,
 * so typing "run" offers Runes before the user finishes the word.
 */
export function matchProtocols(
  query: string,
  protocols: readonly ProtocolNameSource[],
  limit = 5,
): UniverseIdentifier[] {
  const needle = normalizeName(query);
  if (needle.length < 2) {return [];}
  const matches: { identifier: UniverseIdentifier; exact: boolean }[] = [];
  for (const protocol of protocols) {
    const names = [
      protocol.id,
      protocol.shortName ?? '',
      protocol.displayName ?? '',
      ...(protocol.aliases ?? []),
    ].filter(Boolean);
    let exact = false;
    let hit = false;
    for (const name of names) {
      const normalized = normalizeName(name);
      if (normalized === needle) {
        exact = true;
        hit = true;
        break;
      }
      if (normalized.startsWith(needle)) {hit = true;}
    }
    if (!hit) {continue;}
    matches.push({
      exact,
      identifier: {
        kind: 'protocol',
        value: protocol.id,
        route: ['/protocols', protocol.id],
        rank: exact ? 1 : 3,
      },
    });
  }
  return matches
    .sort((a, b) => {
      if (a.exact !== b.exact) {return a.exact ? -1 : 1;}
      return a.identifier.value.localeCompare(b.identifier.value);
    })
    .slice(0, limit)
    .map((match) => match.identifier);
}

/**
 * All Universe identifiers a query could name, best candidate first.
 * An empty array means the query is not a Universe identifier; the caller then
 * falls back to the base Bitcoin matcher.
 */
export function classifyUniverseQuery(
  rawQuery: string,
  protocols: readonly ProtocolNameSource[] = [],
): UniverseIdentifier[] {
  const query = (rawQuery ?? '').trim();
  if (!query || query.length > 200) {return [];}
  const lower = query.toLowerCase();
  const upper = query.toUpperCase();

  const candidates: UniverseIdentifier[] = [];
  const push = (identifier: UniverseIdentifier | null): void => {
    if (identifier) {candidates.push(identifier);}
  };

  push(outpointOf(lower));
  push(inscriptionIdOf(lower));
  push(inscriptionNumberOf(query));
  push(runeIdOf(query));
  push(satOf(lower));
  // Rune names are case insensitive to type but always display uppercase.
  push(runeNameOf(upper));
  candidates.push(...matchProtocols(query, protocols));

  return candidates.sort((a, b) => a.rank - b.rank);
}

/** Short human label for a candidate, used in the result list. */
export function identifierKindLabel(kind: UniverseIdentifierKind): string {
  switch (kind) {
    case 'outpoint':
      return $localize`:@@universe.search.kind-outpoint:Outpoint`;
    case 'inscription-id':
      return $localize`:@@universe.search.kind-inscription:Inscription`;
    case 'inscription-number':
      return $localize`:@@universe.search.kind-inscription-number:Inscription number`;
    case 'rune-name':
      return $localize`:@@universe.search.kind-rune:Rune`;
    case 'rune-id':
      return $localize`:@@universe.search.kind-rune-id:Rune ID`;
    case 'sat':
      return $localize`:@@universe.search.kind-sat:Sat`;
    case 'protocol':
      return $localize`:@@universe.search.kind-protocol:Protocol`;
    default:
      return '';
  }
}
