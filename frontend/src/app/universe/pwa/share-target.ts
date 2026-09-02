import { classifyUniverseQuery } from '@app/universe/universe-identifier';
import { getRegex, Network } from '@app/shared/regex.utils';

/**
 * Where a shared item opens.
 *
 * The operating system hands the explorer a URL, a text, or a file. This
 * module turns that into one destination, and it never guesses: a value it
 * cannot identify comes back as unrecognized, which the receiver states
 * plainly, rather than sending a visitor to a page about something else.
 *
 * One case is deliberately not decided here. A 64 hexadecimal character
 * string is either a transaction id or a block hash, and no local rule can
 * tell them apart; the receiver resolves that one against the chain, because
 * guessing would sometimes open the wrong page and pretend it was right.
 */

export type SharedTarget =
  | { readonly kind: 'route'; readonly path: string; readonly label: string }
  | { readonly kind: 'ambiguous-hash'; readonly value: string }
  | { readonly kind: 'unrecognized'; readonly value: string };

export interface ShareContext {
  /** The origin this explorer is served from, for same origin link detection. */
  readonly origin: string;
  /** Network name as the regex utilities know it, such as mainnet or testnet. */
  readonly network: Network;
  /** A height no real block can exceed, so an integer is only ever a height. */
  readonly maximumHeight?: number;
}

const URL_LIKE = /^https?:\/\//i;
const HASH_64 = /^[0-9a-f]{64}$/i;
const DEFAULT_MAXIMUM_HEIGHT = 10_000_000;

/** Longest identifier this receiver will even look at, bounded like search. */
const MAXIMUM_VALUE_LENGTH = 200;

export function routeForSharedValue(
  text: string | null | undefined,
  url: string | null | undefined,
  context: ShareContext,
): SharedTarget {
  const fromLink = routeFromLink(url, context);
  if (fromLink) { return fromLink; }
  const value = (text ?? '').trim();
  if (!value || value.length > MAXIMUM_VALUE_LENGTH) {
    return { kind: 'unrecognized', value };
  }

  if (URL_LIKE.test(value)) {
    return routeFromLink(value, context) ?? { kind: 'unrecognized', value };
  }

  // Universe identifiers that base patterns cannot reach: outpoints,
  // inscriptions, runes, sats.
  const universe = classifyUniverseQuery(value)
    .find((candidate) => candidate.kind !== 'protocol');
  if (universe) {
    return {
      kind: 'route',
      path: '/' + universe.route
        .map((segment) => segment.replace(/^\/+/, ''))
        .filter((segment) => segment !== '')
        .join('/'),
      label: universe.kind.replace(/-/g, ' '),
    };
  }

  if (getRegex('address', context.network).test(value)) {
    return { kind: 'route', path: `/address/${value}`, label: 'address' };
  }

  if (HASH_64.test(value)) {
    return { kind: 'ambiguous-hash', value: value.toLowerCase() };
  }

  if (/^\d{1,9}$/.test(value) && Number(value) <= (context.maximumHeight ?? DEFAULT_MAXIMUM_HEIGHT)) {
    return { kind: 'route', path: `/block/${value}`, label: 'block height' };
  }

  return { kind: 'unrecognized', value };
}

function routeFromLink(link: string | null | undefined, context: ShareContext): SharedTarget | null {
  if (!link) { return null; }
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.origin !== context.origin) { return null; }
  const path = parsed.pathname + parsed.search;
  return {
    kind: 'route',
    path: path === '/' || path === '' ? '/' : path,
    label: path === '/' || path === '' ? 'home' : 'page',
  };
}
