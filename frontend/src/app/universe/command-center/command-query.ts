/**
 * The grammar of the command center.
 *
 * A query is filter terms and free text in any order:
 *
 *   chain:bitcoin kind:rune "the free part" height:880000-890000
 *
 * The grammar is deliberately small. Every term has a bounded vocabulary, a
 * value that is checked rather than trusted, and a name that appears in the
 * parsed result even when this deployment cannot yet act on it, because a
 * filter that vanished silently would be a filter the visitor believed was
 * applied. Unknown keys come back listed as unknown; they are never dropped,
 * and they are never sent anywhere.
 *
 * This module is pure and property tested. The palette renders what it
 * returns; it never re-parses anything itself.
 */

/** Every chain the explorer reads. */
export const CHAINS = ['bitcoin', 'fractal', 'dogecoin', 'zcash', 'liquid'] as const;
export type QueryChain = (typeof CHAINS)[number];

const CHAIN_ALIASES: Record<string, QueryChain> = {
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  fb: 'fractal',
  fractal: 'fractal',
  doge: 'dogecoin',
  dogecoin: 'dogecoin',
  zec: 'zcash',
  zcash: 'zcash',
  lq: 'liquid',
  liquid: 'liquid',
};

export const NETWORKS = [
  'mainnet', 'testnet', 'testnet4', 'signet', 'regtest',
] as const;
export type QueryNetwork = (typeof NETWORKS)[number];

/** Object kinds the palette can filter and label. */
export const OBJECT_KINDS = [
  'block', 'transaction', 'address', 'outpoint', 'inscription', 'sat',
  'rune', 'name', 'token', 'asset', 'contract', 'order', 'stamp',
  'atomical', 'domain',
] as const;
export type QueryKind = (typeof OBJECT_KINDS)[number];

const KIND_ALIASES: Record<string, QueryKind> = {
  block: 'block',
  blocks: 'block',
  tx: 'transaction',
  transaction: 'transaction',
  transactions: 'transaction',
  address: 'address',
  outpoint: 'outpoint',
  inscription: 'inscription',
  inscriptions: 'inscription',
  sat: 'sat',
  sats: 'sat',
  rune: 'rune',
  runes: 'rune',
  name: 'name',
  names: 'name',
  token: 'token',
  tokens: 'token',
  asset: 'asset',
  assets: 'asset',
  contract: 'contract',
  contracts: 'contract',
  order: 'order',
  orders: 'order',
  stamp: 'stamp',
  stamps: 'stamp',
  atomical: 'atomical',
  atomicals: 'atomical',
  realm: 'domain',
  realms: 'domain',
  domain: 'domain',
};

export const OPERATIONS = [
  'deploy', 'mint', 'transfer', 'burn', 'etch', 'register', 'cancel', 'fill',
] as const;
export type QueryOperation = (typeof OPERATIONS)[number];

export const STATUSES = [
  'pending', 'confirmed', 'invalid', 'replaced', 'orphaned', 'active', 'expired',
] as const;
export type QueryStatus = (typeof STATUSES)[number];

export const FRESHNESS = ['live', 'stale', 'degraded'] as const;
export type QueryFreshness = (typeof FRESHNESS)[number];

/** An inclusive integer range. */
export interface QueryRange {
  readonly from: number;
  readonly to: number;
}

/** A filter the visitor asked for, with the text it came from. */
export interface AppliedFilter {
  readonly key: CommandFilterKey;
  readonly raw: string;
}

export type CommandFilterKey =
  | 'chain'
  | 'network'
  | 'protocol'
  | 'kind'
  | 'operation'
  | 'status'
  | 'height'
  | 'time'
  | 'value'
  | 'feerate'
  | 'source'
  | 'freshness'
  | 'rank';

export interface CommandQuery {
  /** The text with every filter term removed, trimmed, quotes stripped. */
  readonly text: string;
  readonly chain: QueryChain | null;
  readonly network: QueryNetwork | null;
  readonly protocol: string | null;
  readonly kind: QueryKind | null;
  readonly operation: QueryOperation | null;
  readonly status: QueryStatus | null;
  readonly freshness: QueryFreshness | null;
  readonly height: QueryRange | null;
  readonly time: QueryRange | null;
  /** Satoshi value range, from value:1000-5000. */
  readonly value: QueryRange | null;
  /** Fee rate range in sat/vB, from feerate:5-20. */
  readonly feerate: QueryRange | null;
  readonly source: string | null;
  /** Holder rank, from rank:100. */
  readonly rank: number | null;
  /** Terms this grammar knows but this build cannot act on. Stated, never hidden. */
  readonly deferred: readonly AppliedFilter[];
  /** Terms this grammar does not know at all. Shown back to the visitor. */
  readonly unknown: readonly AppliedFilter[];
  /** Everything that was applied, in the order written. */
  readonly applied: readonly AppliedFilter[];
}

const EMPTY_RANGE: QueryRange = { from: 0, to: 0 };

/**
 * Splits a raw query into terms and text.
 *
 * A quoted segment is one term or one text run no matter what it contains. A
 * `key:value` outside quotes is a term when the key is known and a text word
 * when it is not, so an unfamiliar `foo:bar` stays visible in the text
 * instead of disappearing into a filter nobody sees.
 */
export function parseCommandQuery(raw: string): CommandQuery {
  const state = parseState();

  for (const token of tokenize(raw)) {
    if (token.quoted || !token.text.includes(':')) {
      state.words.push(token.text);
      continue;
    }
    const colon = token.text.indexOf(':');
    const key = token.text.slice(0, colon).toLowerCase();
    const value = token.text.slice(colon + 1).trim();
    if (!key || !value) {
      state.words.push(token.text);
      continue;
    }
    applyTerm(state, key, value);
  }

  return {
    text: normalizeText(state.words),
    chain: state.chain,
    network: state.network,
    protocol: state.protocol,
    kind: state.kind,
    operation: state.operation,
    status: state.status,
    freshness: state.freshness,
    height: state.height,
    time: state.time,
    value: state.value,
    feerate: state.feerate,
    source: state.source,
    rank: state.rank,
    deferred: state.deferred,
    unknown: state.unknown,
    applied: state.applied,
  };
}

function applyTerm(state: ReturnType<typeof parseState>, key: string, value: string): void {
  const remember = (appliedKey: CommandFilterKey): void => {
    state.applied.push({ key: appliedKey, raw: `${key}:${value}` });
    // Recorded but not enforced by this deployment: stated, not hidden.
    if (FILTERS_RECORDED.includes(appliedKey)) {
      state.deferred.push({ key: appliedKey, raw: `${key}:${value}` });
    }
  };

  switch (key) {
    case 'chain': {
      const chain = CHAIN_ALIASES[value.toLowerCase()];
      if (chain && state.chain === null) {
        state.chain = chain;
        remember('chain');
      } else {
        state.unknown.push({ key: 'chain', raw: `${key}:${value}` });
      }
      return;
    }
    case 'network': {
      const network = value.toLowerCase() as QueryNetwork;
      if ((NETWORKS as readonly string[]).includes(network) && state.network === null) {
        state.network = network;
        remember('network');
      } else {
        state.unknown.push({ key: 'network', raw: `${key}:${value}` });
      }
      return;
    }
    case 'protocol': {
      if (state.protocol === null && /^[a-z0-9-]{1,48}$/i.test(value)) {
        state.protocol = value.toLowerCase();
        remember('protocol');
      } else {
        state.unknown.push({ key: 'protocol', raw: `${key}:${value}` });
      }
      return;
    }
    case 'kind': {
      const kind = KIND_ALIASES[value.toLowerCase()];
      if (kind && state.kind === null) {
        state.kind = kind;
        remember('kind');
      } else {
        state.unknown.push({ key: 'kind', raw: `${key}:${value}` });
      }
      return;
    }
    case 'operation': {
      const operation = value.toLowerCase() as QueryOperation;
      if ((OPERATIONS as readonly string[]).includes(operation) && state.operation === null) {
        state.operation = operation;
        remember('operation');
      } else {
        state.unknown.push({ key: 'operation', raw: `${key}:${value}` });
      }
      return;
    }
    case 'status': {
      const status = value.toLowerCase() as QueryStatus;
      if ((STATUSES as readonly string[]).includes(status) && state.status === null) {
        state.status = status;
        remember('status');
      } else {
        state.unknown.push({ key: 'status', raw: `${key}:${value}` });
      }
      return;
    }
    case 'freshness': {
      const freshness = value.toLowerCase() as QueryFreshness;
      if ((FRESHNESS as readonly string[]).includes(freshness) && state.freshness === null) {
        state.freshness = freshness;
        remember('freshness');
      } else {
        state.unknown.push({ key: 'freshness', raw: `${key}:${value}` });
      }
      return;
    }
    case 'height': {
      const range = integerRange(value, 0, 100_000_000);
      if (range && state.height === null) {
        state.height = range;
        remember('height');
      } else {
        state.unknown.push({ key: 'height', raw: `${key}:${value}` });
      }
      return;
    }
    case 'time': {
      const range = timeRange(value);
      if (range && state.time === null) {
        state.time = range;
        remember('time');
      } else {
        state.unknown.push({ key: 'time', raw: `${key}:${value}` });
      }
      return;
    }
    case 'value': {
      const range = integerRange(value, 0, Number.MAX_SAFE_INTEGER);
      if (range && state.value === null) {
        state.value = range;
        remember('value');
      } else {
        state.unknown.push({ key: 'value', raw: `${key}:${value}` });
      }
      return;
    }
    case 'feerate': {
      const range = decimalRange(value, 0, 100_000);
      if (range && state.feerate === null) {
        state.feerate = range;
        remember('feerate');
      } else {
        state.unknown.push({ key: 'feerate', raw: `${key}:${value}` });
      }
      return;
    }
    case 'source': {
      if (state.source === null && /^[a-z0-9-]{1,48}$/i.test(value)) {
        state.source = value.toLowerCase();
        remember('source');
      } else {
        state.unknown.push({ key: 'source', raw: `${key}:${value}` });
      }
      return;
    }
    case 'rank': {
      const rank = /^\d{1,7}$/.test(value) ? Number(value) : null;
      if (rank !== null) {
        state.rank = rank;
        remember('rank');
      } else {
        state.unknown.push({ key: 'rank', raw: `${key}:${value}` });
      }
      return;
    }
    default:
      // A key the grammar does not know stays in the text, where the visitor
      // can see it, and is reported as unknown. It is never silently dropped
      // and never sent anywhere as if it were a filter.
      state.unknown.push({ key: key as CommandFilterKey, raw: `${key}:${value}` });
      state.words.push(`${key}:${value}`);
      return;
  }
}

function parseState() {
  return {
    words: [] as string[],
    chain: null as QueryChain | null,
    network: null as QueryNetwork | null,
    protocol: null as string | null,
    kind: null as QueryKind | null,
    operation: null as QueryOperation | null,
    status: null as QueryStatus | null,
    freshness: null as QueryFreshness | null,
    height: null as QueryRange | null,
    time: null as QueryRange | null,
    value: null as QueryRange | null,
    feerate: null as QueryRange | null,
    source: null as string | null,
    rank: null as number | null,
    deferred: [] as AppliedFilter[],
    unknown: [] as AppliedFilter[],
    applied: [] as AppliedFilter[],
  };
}

interface Token {
  readonly text: string;
  readonly quoted: boolean;
}

/** Splits on whitespace outside quotes, keeping quoted runs whole. */
function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let quoted = false;
  let inQuotes = false;

  const push = (): void => {
    if (current.length || quoted) {
      tokens.push({ text: current, quoted });
      current = '';
      quoted = false;
    }
  };

  for (const character of raw ?? '') {
    if (character === '"') {
      if (inQuotes) {
        push();
      } else {
        push();
        inQuotes = true;
        quoted = true;
      }
      continue;
    }
    if (character === ' ' || character === '\t' || character === '\n') {
      if (inQuotes) {
        current += character;
      } else {
        push();
      }
      continue;
    }
    if (quoted && current === '' && character !== ' ') {
      // First character inside quotes: mark the run.
      quoted = true;
    }
    current += character;
  }
  push();
  return tokens;
}

function normalizeText(words: readonly string[]): string {
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** `n`, `n-m`, open ended `n-` or `-m`. Inclusive, ordered, bounded. */
export function integerRange(value: string, minimum: number, maximum: number): QueryRange | null {
  const match = /^(\d{1,15})(?:-(\d{0,15}))?$/.exec(value);
  if (!match) { return null; }
  const from = Number(match[1]);
  const to = match[2] === undefined || match[2] === '' ? null : Number(match[2]);
  const low = from;
  const high = to ?? maximum;
  if (low < minimum || low > maximum || high < low || high > maximum) { return null; }
  return { from: low, to: high };
}

/** Fee rates accept one decimal place. */
export function decimalRange(value: string, minimum: number, maximum: number): QueryRange | null {
  const match = /^(\d{1,7}(?:\.\d)?)(?:-(\d{0,7}(?:\.\d)?))?$/.exec(value);
  if (!match) { return null; }
  const from = Number(match[1]);
  const to = match[2] === undefined || match[2] === '' ? null : Number(match[2]);
  const high = to ?? maximum;
  if (from < minimum || from > maximum || high < from || high > maximum) { return null; }
  return { from, to: high };
}

/**
 * `2026-01-31`, two dates joined by `...`, or a trailing day count `-30d`.
 * A lone date is that one day, from midnight to midnight.
 */
export function timeRange(value: string, now: number = Date.now()): QueryRange | null {
  const trimmed = value.trim().toLowerCase();
  const DAY = 86_400_000;

  const relative = /^-(\d{1,5})d$/.exec(trimmed);
  if (relative) {
    const days = Number(relative[1]);
    if (days < 1) { return null; }
    const to = now;
    return { from: to - days * DAY, to };
  }

  // Dates carry hyphens, so a range is two whole dates joined by `...`, or
  // matched as exactly two whole dates around one separator.
  const stamps: number[] = [];
  const parts = trimmed.includes('...')
    ? trimmed.split('...')
    : (trimmed.match(/^(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})$/)?.slice(1) ?? [trimmed]);
  if (parts.length === 0 || parts.length > 2) { return null; }
  for (const date of parts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { return null; }
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed)) { return null; }
    stamps.push(parsed);
  }
  if (stamps.length === 1) {
    return { from: stamps[0], to: stamps[0] + DAY - 1 };
  }
  if (stamps[1] < stamps[0]) { return null; }
  return { from: stamps[0], to: stamps[1] + DAY - 1 };
}

/** The word a filter chip shows. */
export function filterLabel(key: CommandFilterKey): string {  const labels: Record<CommandFilterKey, string> = {
    chain: 'chain',
    network: 'network',
    protocol: 'protocol',
    kind: 'kind',
    operation: 'operation',
    status: 'status',
    height: 'height',
    time: 'time',
    value: 'value',
    feerate: 'fee rate',
    source: 'source',
    freshness: 'freshness',
    rank: 'holder rank',
  };
  return labels[key];
}

/**
 * Which filters this deployment acts on, and which it records honestly
 * without being able to enforce. The palette renders the second group with a
 * stated caveat instead of pretending an unenforceable filter narrowed
 * anything.
 */
export const FILTERS_ENFORCED: readonly CommandFilterKey[] = ['chain', 'kind'];
export const FILTERS_RECORDED: readonly CommandFilterKey[] = [
  'operation', 'status', 'freshness', 'height', 'time', 'value', 'feerate', 'source', 'rank',
];

export const EMPTY_QUERY: CommandQuery = {
  text: '',
  chain: null,
  network: null,
  protocol: null,
  kind: null,
  operation: null,
  status: null,
  freshness: null,
  height: null,
  time: null,
  value: null,
  feerate: null,
  source: null,
  rank: null,
  deferred: [],
  unknown: [],
  applied: [],
};
