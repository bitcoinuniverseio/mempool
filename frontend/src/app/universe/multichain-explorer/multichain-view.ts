/**
 * Presentation model for the Dogecoin and Zcash explorer pages.
 *
 * Pure functions, no Angular and no I/O, so every rule below is testable on
 * its own and the component stays a template.
 *
 * The problem this solves: the chain overlay answers with several different
 * envelopes, and the page used to print whichever one arrived as a grid of
 * raw API key names, a table whose columns were the first eight keys of the
 * first row, and the whole response as JSON. That renders, but it does not
 * explain. A reader could not tell a koinu from a Dogecoin, an exact integer
 * from a rounded one, or a fact the authority proved from a field it left
 * null.
 *
 * Three rules hold the model together:
 *
 *  1. Numbers cross the API boundary as exact decimal strings and are never
 *     parsed into a JavaScript number here. Grouping and the decimal shift are
 *     string operations, and every formatted value keeps the exact source
 *     string beside it so a reader can copy the value the authority sent.
 *
 *  2. Absent and zero are different answers, and the model says which. A null
 *     amount reads as not reported; a zero amount reads as zero.
 *
 *  3. Shapes the model recognises get a purpose-built reading. Shapes it does
 *     not are still rendered, as a humanised record that says plainly it is
 *     the response as received. The page never silently drops a field it did
 *     not expect.
 */

import {
  ChainCapabilityEnvelope,
  ChainExplorerPayload,
  ExplorerChain,
} from '@app/universe/universe.types';
import { explorerChainName } from '@app/universe/universe-chain-routing';
import {
  ChainReasonReading,
  describeChainReasons,
} from '@app/universe/multichain-explorer/chain-reasons';
import {
  EvidenceTone,
  formatAtomicAmount as formatAtomicDigits,
  shortenIdentifier as shortenSymmetric,
} from '@app/universe/universe-evidence';

export interface ChainProtocolTab {
  /** The path segment the chain API uses, and the route this explorer serves. */
  readonly id: string;
  readonly label: string;
  /**
   * Every id the capability envelope might use for this same protocol.
   *
   * The route segment and the registry id are different namespaces and they do
   * not always agree: the API serves TAP on Doge at `/protocols/doge-tap`
   * while the registry calls it `tap_doge`. Matching on the route id alone
   * listed the protocol twice on the overview, once from the tab reporting
   * "not stated" and once appended from the envelope, and neither row was the
   * whole truth.
   */
  readonly registryIds: readonly string[];
}

export interface ChainProfile {
  readonly chain: Exclude<ExplorerChain, 'bitcoin'>;
  readonly name: string;
  readonly ticker: string;
  /** Name of one indivisible unit, as the chain's own documentation uses it. */
  readonly atomicUnit: string;
  /** Decimal places between the atomic unit and the ticker unit. */
  readonly precision: number;
  readonly protocols: readonly ChainProtocolTab[];
}

const DOGECOIN: ChainProfile = {
  chain: 'dogecoin',
  name: explorerChainName('dogecoin'),
  ticker: 'DOGE',
  atomicUnit: 'koinu',
  precision: 8,
  protocols: [
    { id: 'doginals', label: 'Doginals', registryIds: ['doginals'] },
    { id: 'drc20', label: 'DRC-20', registryIds: ['drc20'] },
    { id: 'doge-tap', label: 'TAP on Doge', registryIds: ['tap_doge', 'doge-tap', 'tap-on-doge', 'tap-doge'] },
  ],
};

const ZCASH: ChainProfile = {
  chain: 'zcash',
  name: explorerChainName('zcash'),
  ticker: 'ZEC',
  atomicUnit: 'zatoshi',
  precision: 8,
  protocols: [
    { id: 'zerdinals', label: 'Zerdinals', registryIds: ['zerdinals', 'universe-zerdinals'] },
    { id: 'zrunes', label: 'ZRunes', registryIds: ['zrunes'] },
    { id: 'zrc20', label: 'ZRC-20', registryIds: ['zrc20'] },
  ],
};

export function chainProfile(
  chain: Exclude<ExplorerChain, 'bitcoin'>
): ChainProfile {
  return chain === 'dogecoin' ? DOGECOIN : ZCASH;
}

// ---------------------------------------------------------------------------
// Exact numeric presentation
// ---------------------------------------------------------------------------

const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;

/** Digit grouping on the integer part only, applied to a string. */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A number the page shows. `display` is grouped and shifted for reading;
 * `exact` is the string the authority sent, so a reader who needs the precise
 * value can copy it and a test can assert on it.
 */
export interface ExactNumber {
  readonly display: string;
  readonly exact: string;
}

/**
 * An exact integer, grouped for reading. Heights, counts, sizes and sequence
 * numbers take this: they are whole things, not amounts, and shifting them by
 * a precision would be wrong.
 */
export function formatExactInteger(
  value: string | null | undefined
): ExactNumber | null {
  if (typeof value !== 'string' || !INTEGER.test(value)) {
    return null;
  }
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  return {
    display: (negative ? '-' : '') + groupDigits(digits),
    exact: value,
  };
}

/**
 * An amount in the chain's atomic unit, shifted to the ticker unit by string
 * arithmetic. 100000000 koinu becomes 1 DOGE with no floating point anywhere
 * in the path, which matters because a Dogecoin balance can exceed the range
 * where a double still counts single units.
 *
 * Trailing zeros in the fraction are dropped, because a balance of exactly one
 * coin should read as 1 and not as 1.00000000, and a whole number keeps no
 * decimal point at all.
 */
export function formatAtomicAmount(
  value: string | null | undefined,
  precision: number
): ExactNumber | null {
  if (typeof value !== 'string') {
    return null;
  }
  // The shift itself is the shared evidence vocabulary's, so a Dogecoin balance
  // and a Bitcoin one are grouped and trimmed by one rule rather than two.
  // What is added here is the exact source string beside the rendering.
  const display = formatAtomicDigits(value, precision);
  return display === '' ? null : { display, exact: value };
}

/** Shorten a hash for a dense column, keeping both ends so it stays checkable. */
export function shortenIdentifier(value: string, keep = 8): string {
  return shortenSymmetric(value, keep);
}

/**
 * How long ago an observation was made, in the coarsest unit that is still
 * honest. An unparseable or future timestamp returns null rather than a
 * reassuring "0s ago"; the caller then says the freshness is unknown.
 */
export function formatElapsed(
  isoTimestamp: string | null | undefined,
  now: number
): string | null {
  if (typeof isoTimestamp !== 'string') {
    return null;
  }
  const observed = Date.parse(isoTimestamp);
  if (!Number.isFinite(observed)) {
    return null;
  }
  const seconds = Math.floor((now - observed) / 1000);
  if (seconds < 0) {
    return null;
  }
  if (seconds < 60) {
    return seconds === 1
      ? $localize`:@@universe.chain.elapsed-second:1 second ago`
      : $localize`:@@universe.chain.elapsed-seconds:${seconds}:SECONDS: seconds ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1
      ? $localize`:@@universe.chain.elapsed-minute:1 minute ago`
      : $localize`:@@universe.chain.elapsed-minutes:${minutes}:MINUTES: minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return hours === 1
      ? $localize`:@@universe.chain.elapsed-hour:1 hour ago`
      : $localize`:@@universe.chain.elapsed-hours:${hours}:HOURS: hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1
    ? $localize`:@@universe.chain.elapsed-day:1 day ago`
    : $localize`:@@universe.chain.elapsed-days:${days}:DAYS: days ago`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A timestamp a reader can take in at a glance, with the exact string beside
 * it. The authority sends ISO-8601, which is precise and unreadable at speed:
 * "2026-08-29T04:02:00.000Z" makes a reader parse punctuation to find the hour.
 *
 * The format is built by hand rather than through Intl, and it is always UTC.
 * A block timestamp is a fact about the chain, not about where the reader is
 * sitting, and a locale-dependent rendering would make two people describing
 * the same block disagree about when it happened.
 */
export function formatTimestamp(
  isoTimestamp: string | null | undefined
): ExactNumber | null {
  if (typeof isoTimestamp !== 'string') {
    return null;
  }
  const parsed = new Date(isoTimestamp);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  const display =
    `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ` +
    `${parsed.getUTCFullYear()}, ${pad(parsed.getUTCHours())}:` +
    `${pad(parsed.getUTCMinutes())} UTC`;
  return { display, exact: isoTimestamp };
}

/**
 * A time stated as whole seconds since the epoch, which is how the Zcash
 * source states a block time. Rendered in the same words and the same zone as
 * every other time here, with the number it came from kept exactly.
 *
 * Seconds, never milliseconds: a value read in the wrong unit lands in 1970 or
 * in the year 58000 and still renders, so the range is checked rather than
 * assumed.
 */
export function formatUnixTimestamp(
  seconds: string | null | undefined
): ExactNumber | null {
  const digits = integerText(seconds);
  if (digits === null) {
    return null;
  }
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 4_102_444_800) {
    return null;
  }
  const iso = new Date(value * 1000).toISOString();
  const formatted = formatTimestamp(iso);
  return formatted ? { display: formatted.display, exact: digits } : null;
}

// ---------------------------------------------------------------------------
// Field naming
// ---------------------------------------------------------------------------

/**
 * Words the generic sentence-case rule would get wrong. Everything else is
 * derived, so a field the overlay adds later still reads as English without
 * anyone having to add it here first.
 */
const KNOWN_WORDS: Record<string, string> = {
  txid: 'transaction id',
  txids: 'transaction ids',
  utxos: 'unspent outputs',
  vout: 'output index',
  vin: 'input index',
  drc20: 'DRC-20',
  zrc20: 'ZRC-20',
  id: 'ID',
  ids: 'IDs',
  hash: 'hash',
  ipfs: 'IPFS',
  json: 'JSON',
  url: 'URL',
  uri: 'URI',
  zip317: 'ZIP-317',
};

/**
 * An API field name as a reader should see it. The `Atomic` suffix the
 * contract uses to mark exact-string transport is a wire detail, not a label,
 * so it is dropped here and the exactness is carried by the value instead.
 */
export function humanizeFieldName(key: string): string {
  const withoutSuffix = key.replace(/Atomic$/, '').replace(/Decimal$/, '');
  const words = withoutSuffix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => KNOWN_WORDS[word] ?? word);
  if (!words.length) {
    return key;
  }
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Fields that carry an amount of the chain's own coin, and may therefore be
 * shifted by the chain's precision.
 *
 * This is an allowlist, not a pattern, and it is deliberately narrow. A
 * pattern that matched "supply" printed a DRC-20 token supply of 100000000000
 * as 1,000 DOGE, because a token's units are its own and have nothing to do
 * with koinu. Shifting an unknown quantity by eight places does not make it
 * more readable, it makes it wrong, so anything not named here is shown as the
 * exact integer the authority sent.
 */
const COIN_AMOUNT_FIELDS = new Set([
  'valueAtomic',
  'valueBalanceAtomic',
  'saplingValueBalanceAtomic',
  'orchardValueBalanceAtomic',
  'ironwoodValueBalanceAtomic',
  'balanceAtomic',
  'unconfirmedBalanceAtomic',
  'totalReceivedAtomic',
  'totalSentAtomic',
  'amountAtomic',
  'feeAtomic',
  'rewardAtomic',
]);

function isCoinAmount(key: string): boolean {
  return COIN_AMOUNT_FIELDS.has(key.split(' ').pop() ?? key);
}
const IDENTIFIER_FIELD = /(hash|txid|^id$|root|address|outpoint|satpoint)/i;
const TIMESTAMP_FIELD = /(at|time|timestamp)$/i;

export type FactKind =
  | 'text'
  | 'identifier'
  | 'amount'
  | 'count'
  | 'timestamp'
  | 'flag'
  | 'absent';

/** One labelled value, classified so the template knows how to set it. */
export interface Fact {
  readonly key: string;
  readonly label: string;
  readonly kind: FactKind;
  readonly display: string;
  /** The exact source string, when the display form is a rendering of one. */
  readonly exact: string | null;
  /** Unit shown beside the value, for amounts only. */
  readonly unit: string | null;
  /**
   * Router path to the page for this value, when the explorer has one. A list
   * of transaction ids that cannot be clicked is a dead end, and that is what
   * every generic table here used to be.
   */
  readonly link: readonly string[] | null;
}

const ABSENT = $localize`:@@universe.chain.not-reported:Not reported`;

const TXID_FIELD = /(^|\s)(txid|txids|transactionid)$/i;
const ADDRESS_FIELD = /(^|\s)(address|owneraddress|holder)$/i;

/** The page this value belongs to, when the explorer has one for it. */
function routeFor(
  key: string,
  value: string,
  profile: ChainProfile
): readonly string[] | null {
  if (TXID_FIELD.test(key) && /^[0-9a-f]{64}$/.test(value)) {
    return ['/', profile.chain, 'tx', value];
  }
  if (ADDRESS_FIELD.test(key)) {
    return ['/', profile.chain, 'address', value];
  }
  return null;
}

function factFrom(
  key: string,
  value: unknown,
  profile: ChainProfile
): Fact | null {
  const label = humanizeFieldName(key);
  const base = { key, label, exact: null, unit: null, link: null } as const;

  if (value === null || value === undefined || value === '') {
    return { ...base, kind: 'absent', display: ABSENT };
  }
  if (typeof value === 'boolean') {
    return {
      ...base,
      kind: 'flag',
      display: value
        ? $localize`:@@universe.chain.flag-yes:Yes`
        : $localize`:@@universe.chain.flag-no:No`,
    };
  }
  if (typeof value === 'number') {
    // The contract transports numbers as strings. A raw number means a field
    // outside the contract, so it is shown as text rather than dressed up as
    // an exact value it may not be.
    return { ...base, kind: 'text', display: String(value) };
  }
  if (typeof value !== 'string') {
    return null;
  }

  if (isCoinAmount(key) && INTEGER.test(value)) {
    const amount = formatAtomicAmount(value, profile.precision);
    return amount
      ? {
          key,
          label,
          kind: 'amount',
          display: amount.display,
          exact: amount.exact,
          unit: profile.ticker,
          link: null,
        }
      : { ...base, kind: 'text', display: value };
  }
  if (INTEGER.test(value)) {
    const count = formatExactInteger(value);
    return count
      ? { key, label, kind: 'count', display: count.display, exact: count.exact, unit: null, link: null }
      : { ...base, kind: 'text', display: value };
  }
  if (TIMESTAMP_FIELD.test(key)) {
    const moment = formatTimestamp(value);
    if (moment) {
      return {
        key,
        label,
        kind: 'timestamp',
        display: moment.display,
        exact: moment.exact,
        unit: null,
        link: null,
      };
    }
  }
  if (IDENTIFIER_FIELD.test(key) || /^[0-9a-f]{64}$/.test(value)) {
    return {
      key,
      label,
      kind: 'identifier',
      display: value,
      exact: value,
      unit: null,
      link: routeFor(key, value, profile),
    };
  }
  return { ...base, kind: 'text', display: value };
}

/**
 * Every scalar field of a response, humanised and classified, in the order the
 * authority sent them. Nested objects and arrays are handled by the shape
 * readers below or, when the shape is unrecognised, listed separately so the
 * page can say how many rows it is not detailing rather than hiding them.
 */
export function readRecordFacts(
  payload: ChainExplorerPayload | null,
  profile: ChainProfile,
  skip: readonly string[] = []
): readonly Fact[] {
  if (!payload) {
    return [];
  }
  const skipped = new Set(skip);
  const facts: Fact[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (skipped.has(key) || Array.isArray(value)) {
      continue;
    }
    if (value !== null && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (childValue !== null && typeof childValue === 'object') {
          continue;
        }
        // A nested chain or network repeats the page heading, the same way the
        // top-level ones do, and the skip list only reaches the top level.
        if (childKey === 'chain' || childKey === 'network') {
          continue;
        }
        // "snapshot" plus "snapshotId" reads as "Snapshot snapshot ID". Where
        // the child already names its parent, the parent is not repeated.
        const prefixed = childKey.toLowerCase().startsWith(key.toLowerCase());
        const fact = factFrom(
          prefixed ? childKey : `${key} ${childKey}`,
          childValue,
          profile
        );
        if (fact) {
          facts.push(fact);
        }
      }
      continue;
    }
    const fact = factFrom(key, value, profile);
    if (fact) {
      facts.push(fact);
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Chain status
// ---------------------------------------------------------------------------

export interface StatusReading {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: EvidenceTone;
  /** Present when the value is an exact figure worth copying. */
  readonly exact: string | null;
}

function availabilityTone(state: string | null | undefined): EvidenceTone {
  switch (state) {
    case 'ready':
      return 'proven';
    case 'degraded':
      return 'partial';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'neutral';
  }
}

function completenessTone(state: string | null | undefined): EvidenceTone {
  switch (state) {
    case 'complete':
      return 'proven';
    case 'partial':
      return 'partial';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'neutral';
  }
}

export function completenessLabel(state: string | null | undefined): string {
  switch (state) {
    case 'complete':
      return $localize`:@@universe.chain.coverage-complete:Complete`;
    case 'partial':
      return $localize`:@@universe.chain.coverage-partial:Partial`;
    case 'unavailable':
      return $localize`:@@universe.chain.coverage-unavailable:Unavailable`;
    default:
      return $localize`:@@universe.chain.coverage-unknown:Not stated`;
  }
}

/**
 * Coverage as a phrase rather than a bare adjective. "History Complete" is not
 * a sentence; the chip vocabulary and the prose vocabulary are different jobs.
 */
export function historyLabel(state: string | null | undefined): string {
  switch (state) {
    case 'complete':
      return $localize`:@@universe.chain.history-complete:Complete history`;
    case 'partial':
      return $localize`:@@universe.chain.history-partial:Partial history`;
    case 'unavailable':
      return $localize`:@@universe.chain.history-unavailable:History unavailable`;
    default:
      return $localize`:@@universe.chain.history-unknown:History not stated`;
  }
}

export function availabilityLabel(state: string | null | undefined): string {
  switch (state) {
    case 'ready':
      return $localize`:@@universe.chain.state-ready:Ready`;
    case 'degraded':
      return $localize`:@@universe.chain.state-degraded:Degraded`;
    case 'unavailable':
      return $localize`:@@universe.chain.state-unavailable:Unavailable`;
    default:
      return $localize`:@@universe.chain.state-unknown:Not stated`;
  }
}

/**
 * The status rail. Five readings, always the same five in the same order, so a
 * reader learns where to look once. A reading whose fact is missing says so in
 * its own value rather than disappearing, because a rail with a hole in it
 * reads as a page still loading.
 */
export function readStatusRail(
  capability: ChainCapabilityEnvelope | null,
  profile: ChainProfile,
  now: number
): readonly StatusReading[] {
  if (!capability) {
    const unknown = $localize`:@@universe.chain.rail-unknown:Not available`;
    return [
      { id: 'state', label: $localize`:@@universe.chain.rail-state:Chain`, value: $localize`:@@universe.chain.rail-no-status:Status unavailable`, tone: 'unavailable', exact: null },
      { id: 'tip', label: $localize`:@@universe.chain.rail-tip:Chain tip`, value: unknown, tone: 'neutral', exact: null },
      { id: 'lag', label: $localize`:@@universe.chain.rail-lag:Behind tip`, value: unknown, tone: 'neutral', exact: null },
      { id: 'freshness', label: $localize`:@@universe.chain.rail-observed:Last observed`, value: unknown, tone: 'neutral', exact: null },
      { id: 'mempool', label: $localize`:@@universe.chain.rail-pending:Pending coverage`, value: unknown, tone: 'neutral', exact: null },
    ];
  }

  const tip = formatExactInteger(capability.tip?.heightAtomic ?? null);
  const lag = formatExactInteger(capability.lagBlocksAtomic);
  const elapsed = formatElapsed(capability.updatedAt, now);

  return [
    {
      id: 'state',
      label: $localize`:@@universe.chain.rail-state:Chain`,
      // `sync` is the node's own view of its blocks. `ready` is the chain's
      // verdict on everything the explorer needs, and it is the stricter of
      // the two: a chain whose node is caught up while a protocol indexer is
      // not answering publishes sync.state ready and ready false. Reading the
      // sync state alone therefore printed Ready, in the proven tone, on the
      // one reading a visitor trusts most, for a chain that had just said it
      // was not. When the two disagree the verdict wins, and the reasons
      // beneath the rail say which part is missing.
      value: capability.ready
        ? availabilityLabel('ready')
        : capability.sync.state === 'ready'
          ? availabilityLabel('degraded')
          : availabilityLabel(capability.sync.state),
      tone: capability.ready
        ? 'proven'
        : capability.sync.state === 'ready'
          ? availabilityTone('degraded')
          : availabilityTone(capability.sync.state),
      exact: null,
    },
    {
      id: 'tip',
      label: $localize`:@@universe.chain.rail-tip:Chain tip`,
      value: tip
        ? $localize`:@@universe.chain.rail-tip-block:Block ${tip.display}:HEIGHT:`
        : $localize`:@@universe.chain.rail-tip-none:No tip reported`,
      tone: tip ? 'proven' : 'unavailable',
      exact: tip?.exact ?? null,
    },
    {
      id: 'lag',
      label: $localize`:@@universe.chain.rail-lag:Behind tip`,
      value: lag
        ? $localize`:@@universe.chain.rail-lag-blocks:${lag.display}:BLOCKS: blocks`
        : $localize`:@@universe.chain.rail-lag-none:Not stated`,
      // Any lag at all means the page is describing a past state of the chain,
      // so it never reads as proven. Zero is the only reading that does.
      tone: !lag ? 'neutral' : lag.exact === '0' ? 'proven' : 'partial',
      exact: lag?.exact ?? null,
    },
    {
      id: 'freshness',
      label: $localize`:@@universe.chain.rail-observed:Last observed`,
      value: elapsed ?? $localize`:@@universe.chain.rail-observed-unknown:Time not stated`,
      tone: elapsed ? 'neutral' : 'partial',
      exact: null,
    },
    {
      id: 'mempool',
      label: $localize`:@@universe.chain.rail-pending:Pending coverage`,
      value: capability.mempool.supported
        ? completenessLabel(capability.mempool.completeness)
        : $localize`:@@universe.chain.rail-pending-unsupported:Not offered for ${profile.name}:CHAIN:`,
      tone: capability.mempool.supported
        ? completenessTone(capability.mempool.completeness)
        : 'neutral',
      exact: null,
    },
  ];
}

/**
 * Why a chain says it is not ready, in words, or null when it says it is.
 *
 * The capability document is the record of this and the reasons were never
 * rendered anywhere, so the rail published a verdict and dropped every word of
 * the evidence behind it. A chain that withholds readiness without stating a
 * reason is itself worth saying out loud rather than showing an empty space
 * where the explanation should be.
 */
export function readNotReadyReasons(
  capability: ChainCapabilityEnvelope | null
): readonly ChainReasonReading[] | null {
  if (!capability || capability.ready) {
    return null;
  }
  const reasons = describeChainReasons(capability.degradedReasons ?? []);
  if (reasons.length) {
    return reasons;
  }
  return [
    {
      code: '',
      text: $localize`:@@universe.chain.not-ready-no-reason:This chain reports that it is not ready and states no reason for it.`,
      kind: 'unstated',
    },
  ];
}

export interface ReadCapability {
  readonly id: string;
  readonly label: string;
  /**
   * Three answers, not two. A chain that never answered has not declined a
   * read, and printing "Not offered" for all six when the authority is simply
   * unreachable states a fact nobody established.
   */
  readonly state: 'offered' | 'not-offered' | 'unknown';
  readonly stateLabel: string;
  readonly tone: EvidenceTone;
}

const READ_LABELS: readonly { id: keyof ChainCapabilityEnvelope['reads']; label: string }[] = [
  { id: 'transaction', label: $localize`:@@universe.chain.read-transaction:Transaction lookup` },
  { id: 'block', label: $localize`:@@universe.chain.read-block:Block lookup` },
  { id: 'address', label: $localize`:@@universe.chain.read-address:Address history` },
  { id: 'outpoint', label: $localize`:@@universe.chain.read-outpoint:Outpoint lookup` },
  { id: 'feeEstimates', label: $localize`:@@universe.chain.read-fees:Fee estimates` },
  { id: 'projectedBlocks', label: $localize`:@@universe.chain.read-projected:Projected blocks` },
];

/**
 * What the chain can answer. This is the honest core of a chain overview:
 * rather than showing empty sections for reads the overlay never claimed, the
 * page states which questions it can answer at all, and says so separately
 * from the case where it could not ask.
 */
export function readCapabilities(
  capability: ChainCapabilityEnvelope | null
): readonly ReadCapability[] {
  return READ_LABELS.map(({ id, label }) => {
    if (!capability) {
      return {
        id,
        label,
        state: 'unknown' as const,
        stateLabel: $localize`:@@universe.chain.read-unknown:Not stated`,
        tone: 'neutral' as EvidenceTone,
      };
    }
    const offered = capability.reads?.[id] === true;
    return {
      id,
      label,
      state: offered ? ('offered' as const) : ('not-offered' as const),
      stateLabel: offered
        ? $localize`:@@universe.chain.read-offered:Offered`
        : $localize`:@@universe.chain.read-not-offered:Not offered`,
      tone: offered ? ('proven' as EvidenceTone) : ('unavailable' as EvidenceTone),
    };
  });
}

export interface ProtocolReading {
  readonly protocolId: string;
  readonly label: string;
  /**
   * The route this protocol has, or null when the explorer serves none for it.
   * A protocol the chain reports but this explorer cannot open is still listed,
   * because hiding it would be a claim the chain did not make, but it is not
   * linked: `/dogecoin/protocols/dunes` answers 404 and the frontend throws
   * before it even asks.
   */
  readonly routeId: string | null;
  readonly stateLabel: string;
  readonly tone: EvidenceTone;
  readonly coverageLabel: string;
  readonly historyLabel: string;
  readonly lag: ExactNumber | null;
  /**
   * Why this reading is what it is, in words. On a ready authority these are
   * the stated edges of its coverage rather than faults, which is why each one
   * carries its own kind.
   */
  readonly reasons: readonly ChainReasonReading[];
}

export function readProtocolCoverage(
  capability: ChainCapabilityEnvelope | null,
  profile: ChainProfile
): readonly ProtocolReading[] {
  const declared = capability?.protocols ?? [];
  const byId = new Map(declared.map((entry) => [entry.protocolId, entry]));
  const claimed = new Set<string>();

  // The tabs first, in the order the navigation offers them, each matched to
  // whichever id the envelope used for it. A tab the overlay stopped reporting
  // still appears, marked as not stated, rather than vanishing from a page
  // that links to it.
  const readings: ProtocolReading[] = profile.protocols.map((tab) => {
    const matchedId = tab.registryIds.find((id) => byId.has(id));
    if (matchedId) {
      claimed.add(matchedId);
    }
    const entry = matchedId ? byId.get(matchedId) : undefined;
    return {
      protocolId: matchedId ?? tab.id,
      label: tab.label,
      routeId: tab.id,
      stateLabel: availabilityLabel(entry?.state),
      tone: availabilityTone(entry?.state),
      coverageLabel: completenessLabel(entry?.coverage),
      historyLabel: historyLabel(entry?.coverage),
      lag: formatExactInteger(entry?.lagBlocksAtomic ?? null),
      reasons: describeChainReasons(entry?.degradedReasons ?? []),
    };
  });

  // Then anything the chain reports that this explorer has no page for. It is
  // listed, because the chain said it is there, and it is not linked, because
  // the route would throw before it asked.
  for (const entry of declared) {
    if (claimed.has(entry.protocolId)) {
      continue;
    }
    readings.push({
      protocolId: entry.protocolId,
      label: humanizeFieldName(entry.protocolId),
      routeId: null,
      stateLabel: availabilityLabel(entry.state),
      tone: availabilityTone(entry.state),
      coverageLabel: completenessLabel(entry.coverage),
      historyLabel: historyLabel(entry.coverage),
      lag: formatExactInteger(entry.lagBlocksAtomic ?? null),
      reasons: describeChainReasons(entry.degradedReasons ?? []),
    });
  }
  return readings;
}

// ---------------------------------------------------------------------------
// Shape readers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A whole number that may arrive as an exact string or, outside the contract,
 * as a JSON number. Pagination is the one place the overlay passes a source
 * field straight through, so both forms have to be readable.
 */
function integerText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  return text(value);
}

export type ChainShape =
  | 'transaction'
  | 'block'
  | 'address'
  | 'outpoint'
  | 'collection'
  | 'record'
  | 'empty';

/**
 * Which reading applies to a payload. Recognition is by the fields the
 * contract guarantees, not by which page requested it, so a response that
 * arrives in an unexpected shape falls through to the record reading rather
 * than being rendered against the wrong template.
 */
export function classifyPayload(payload: ChainExplorerPayload | null): ChainShape {
  if (!payload || !isRecord(payload)) {
    return 'empty';
  }
  if (payload.schemaVersion === 'universe-transaction-v1' && text(payload.txid)) {
    return 'transaction';
  }
  if (isRecord(payload.block) && text(payload.block.hash)) {
    return 'block';
  }
  // Zcash answers a block with its fields at the top level rather than under a
  // `block` key, and with `prev_hash` and `tx_count` rather than the Dogecoin
  // spellings. Nothing recognised it, so a real Zcash block page fell through
  // to the generic field table and printed `schemaVersion`, a snake_case field
  // list and a unix timestamp to a visitor, with none of its four
  // transactions. `txid` is checked first so a transaction, which also carries
  // a hash of its own, is never read as the block it is in.
  if (!text(payload.txid) && text(payload.hash) && text(payload.height)) {
    return 'block';
  }
  if (isRecord(payload.outpoint) && text(payload.outpoint.txid)) {
    return 'outpoint';
  }
  if (text(payload.address)) {
    return 'address';
  }
  if (Object.values(payload).some((value) => Array.isArray(value) && value.length)) {
    return 'collection';
  }
  return 'record';
}

export interface TransactionPartyRow {
  readonly index: string;
  readonly address: string | null;
  readonly amount: ExactNumber | null;
  readonly reference: string | null;
  readonly coinbase: boolean;
  readonly spent: boolean | null;
}

export interface ShieldedReading {
  readonly components: readonly { label: string; count: ExactNumber | null }[];
  readonly valueBalance: ExactNumber | null;
  readonly notice: string;
}

export interface ProtocolActionRow {
  readonly eventId: string;
  readonly protocolId: string;
  readonly protocolLabel: string;
  readonly actionType: string;
  readonly stateLabel: string;
  readonly tone: EvidenceTone;
}

export interface TransactionReading {
  readonly txid: string;
  readonly statusLabel: string;
  readonly statusTone: EvidenceTone;
  readonly confirmations: ExactNumber | null;
  readonly block: { hash: string; height: ExactNumber | null; time: ExactNumber | null } | null;
  readonly firstSeenAt: ExactNumber | null;
  readonly size: ExactNumber | null;
  readonly virtualSize: ExactNumber | null;
  readonly feeAmount: ExactNumber | null;
  readonly feeRate: string | null;
  readonly feeRateUnit: string | null;
  readonly logicalActions: ExactNumber | null;
  readonly inputs: readonly TransactionPartyRow[];
  readonly outputs: readonly TransactionPartyRow[];
  readonly inputTotal: ExactNumber | null;
  readonly outputTotal: ExactNumber | null;
  readonly shielded: ShieldedReading | null;
  readonly candidateActions: readonly ProtocolActionRow[];
  readonly confirmedActions: readonly ProtocolActionRow[];
  readonly replacedByTxid: string | null;
  readonly conflicts: readonly { txid: string; reason: string }[];
  readonly expiry: { height: ExactNumber | null; state: string } | null;
  readonly completenessLabel: string;
  readonly completenessTone: EvidenceTone;
}

const LIFECYCLE_TONE: Record<string, EvidenceTone> = {
  confirmed: 'proven',
  observed: 'pending',
  pending: 'pending',
  replaced: 'partial',
  conflicted: 'partial',
  evicted: 'unavailable',
  expired: 'unavailable',
  reorged: 'unavailable',
  'unknown-removal': 'unavailable',
};

const LIFECYCLE_LABEL: Record<string, string> = {
  confirmed: $localize`:@@universe.chain.tx-confirmed:Confirmed in a block`,
  observed: $localize`:@@universe.chain.tx-observed:Seen in the pending set`,
  pending: $localize`:@@universe.chain.tx-pending:Waiting for a block`,
  replaced: $localize`:@@universe.chain.tx-replaced:Replaced by another transaction`,
  conflicted: $localize`:@@universe.chain.tx-conflicted:Conflicts with a confirmed transaction`,
  evicted: $localize`:@@universe.chain.tx-evicted:Dropped from the pending set`,
  expired: $localize`:@@universe.chain.tx-expired:Expired before confirming`,
  reorged: $localize`:@@universe.chain.tx-reorged:Removed by a chain reorganisation`,
  'unknown-removal': $localize`:@@universe.chain.tx-removed:Removed for a reason the node did not state`,
};

const PROTOCOL_STATE_TONE: Record<string, EvidenceTone> = {
  'confirmed-accepted': 'proven',
  'confirmed-rejected': 'unavailable',
  candidate: 'pending',
  unevaluated: 'neutral',
  'outside-coverage': 'neutral',
  evicted: 'unavailable',
  expired: 'unavailable',
  reorged: 'unavailable',
};

const PROTOCOL_STATE_LABEL: Record<string, string> = {
  'confirmed-accepted': $localize`:@@universe.chain.action-accepted:Accepted`,
  'confirmed-rejected': $localize`:@@universe.chain.action-rejected:Rejected by the protocol rules`,
  candidate: $localize`:@@universe.chain.action-candidate:Candidate, not yet evaluated`,
  unevaluated: $localize`:@@universe.chain.action-unevaluated:Not yet evaluated`,
  'outside-coverage': $localize`:@@universe.chain.action-outside:Outside the indexer's coverage`,
  evicted: $localize`:@@universe.chain.action-evicted:Dropped before evaluation`,
  expired: $localize`:@@universe.chain.action-expired:Expired before evaluation`,
  reorged: $localize`:@@universe.chain.action-reorged:Removed by a chain reorganisation`,
};

function sumAtomic(
  rows: readonly TransactionPartyRow[],
  precision: number
): ExactNumber | null {
  let total = 0n;
  let counted = false;
  for (const row of rows) {
    if (row.amount) {
      total += BigInt(row.amount.exact);
      counted = true;
    }
  }
  // A total that omitted an unreported input would be a smaller number
  // presented as a fact. Only sum when every row carried an amount.
  if (!counted || rows.some((row) => !row.amount)) {
    return null;
  }
  return formatAtomicAmount(total.toString(), precision);
}

function partyRows(
  values: unknown,
  profile: ChainProfile,
  kind: 'input' | 'output'
): readonly TransactionPartyRow[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(isRecord).map((entry) => ({
    index: text(entry.indexAtomic) ?? '',
    address: text(entry.address),
    amount: formatAtomicAmount(text(entry.valueAtomic), profile.precision),
    reference: kind === 'input' ? text(entry.previousOutpoint) : null,
    coinbase: entry.coinbase === true,
    spent: typeof entry.spent === 'boolean' ? entry.spent : null,
  }));
}

function actionRows(
  values: unknown,
  profile: ChainProfile
): readonly ProtocolActionRow[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(isRecord).map((entry) => {
    const state = text(entry.state) ?? '';
    const protocolId = text(entry.protocolId) ?? '';
    return {
      eventId: text(entry.eventId) ?? '',
      protocolId,
      protocolLabel:
        profile.protocols.find((tab) => tab.id === protocolId)?.label ??
        humanizeFieldName(protocolId),
      actionType: humanizeFieldName(text(entry.actionType) ?? ''),
      stateLabel: PROTOCOL_STATE_LABEL[state] ?? availabilityLabel(state),
      tone: PROTOCOL_STATE_TONE[state] ?? 'neutral',
    };
  });
}

function shieldedReading(value: unknown, profile: ChainProfile): ShieldedReading | null {
  if (!isRecord(value)) {
    return null;
  }
  const components = [
    { label: $localize`:@@universe.chain.shielded-sprout:Sprout joinsplits`, count: formatExactInteger(text(value.sproutJoinSplitsAtomic)) },
    { label: $localize`:@@universe.chain.shielded-sapling-spends:Sapling spends`, count: formatExactInteger(text(value.saplingSpendsAtomic)) },
    { label: $localize`:@@universe.chain.shielded-sapling-outputs:Sapling outputs`, count: formatExactInteger(text(value.saplingOutputsAtomic)) },
    { label: $localize`:@@universe.chain.shielded-orchard:Orchard actions`, count: formatExactInteger(text(value.orchardActionsAtomic)) },
    { label: $localize`:@@universe.chain.shielded-ironwood:Ironwood actions`, count: formatExactInteger(text(value.ironwoodActionsAtomic)) },
  ];
  return {
    components,
    valueBalance: formatAtomicAmount(text(value.valueBalanceAtomic), profile.precision),
    notice:
      text(value.privacyNotice) ??
      $localize`:@@universe.chain.shielded-default-notice:Shielded senders, recipients, and amounts are not recorded in a form this explorer can read.`,
  };
}

export function readTransaction(
  payload: ChainExplorerPayload,
  profile: ChainProfile
): TransactionReading | null {
  if (classifyPayload(payload) !== 'transaction') {
    return null;
  }
  const status = text(payload.status) ?? '';
  const transparent = isRecord(payload.transparent) ? payload.transparent : {};
  const inputs = partyRows(transparent.inputs, profile, 'input');
  const outputs = partyRows(transparent.outputs, profile, 'output');
  const fee = isRecord(payload.fee) ? payload.fee : {};
  const block = isRecord(payload.block) ? payload.block : null;
  const replacement = isRecord(payload.replacement) ? payload.replacement : null;
  const expiry = isRecord(payload.expiry) ? payload.expiry : null;
  const actions = isRecord(payload.protocolActions) ? payload.protocolActions : {};
  const completeness = text(payload.completeness);

  return {
    txid: text(payload.txid) ?? '',
    statusLabel: LIFECYCLE_LABEL[status] ?? availabilityLabel(status),
    statusTone: LIFECYCLE_TONE[status] ?? 'neutral',
    confirmations: formatExactInteger(text(payload.confirmationsAtomic)),
    block: block
      ? {
          hash: text(block.hash) ?? '',
          height: formatExactInteger(text(block.heightAtomic)),
          time: formatTimestamp(text(block.time)),
        }
      : null,
    firstSeenAt: formatTimestamp(text(payload.firstSeenAt)),
    size: formatExactInteger(text(payload.sizeBytesAtomic)),
    virtualSize: formatExactInteger(text(payload.virtualSizeBytesAtomic)),
    feeAmount: formatAtomicAmount(text(fee.amountAtomic), profile.precision),
    feeRate: text(fee.rateDecimal),
    feeRateUnit: text(fee.rateUnit),
    logicalActions: formatExactInteger(text(fee.logicalActionsAtomic)),
    inputs,
    outputs,
    inputTotal: sumAtomic(inputs, profile.precision),
    outputTotal: sumAtomic(outputs, profile.precision),
    shielded: shieldedReading(payload.shielded, profile),
    candidateActions: actionRows(actions.candidates, profile),
    confirmedActions: actionRows(actions.confirmed, profile),
    replacedByTxid: replacement ? text(replacement.replacedByTxid) : null,
    conflicts: Array.isArray(payload.conflicts)
      ? payload.conflicts.filter(isRecord).map((entry) => ({
          txid: text(entry.txid) ?? '',
          reason: humanizeFieldName(text(entry.reason) ?? ''),
        }))
      : [],
    expiry: expiry
      ? {
          height: formatExactInteger(text(expiry.heightAtomic)),
          state: text(expiry.state) ?? '',
        }
      : null,
    completenessLabel: completenessLabel(completeness),
    completenessTone: completenessTone(completeness),
  };
}

export interface BlockReading {
  readonly hash: string;
  readonly height: ExactNumber | null;
  readonly time: ExactNumber | null;
  readonly transactionCount: ExactNumber | null;
  readonly sizeBytes: ExactNumber | null;
  readonly confirmations: ExactNumber | null;
  readonly previousBlockHash: string | null;
  readonly nextBlockHash: string | null;
  readonly merkleRoot: string | null;
  readonly difficulty: string | null;
  readonly txids: readonly string[];
  readonly paging: Paging | null;
  /**
   * Lists this payload carries that this page has no reading for yet, with
   * how many entries each holds. The generic fact reader drops every array
   * without a word, so a Zcash block carrying Zerdinals inscriptions or ZRune
   * events showed nothing about them, which is the false zero this product
   * exists to avoid.
   */
  readonly unlisted: readonly { label: string; count: number }[];
}

/**
 * Where a list sits in a longer one, and where the next and previous parts of
 * it are. A page that states "page 1 of 3" and offers no way to reach the other
 * two is a dead end, and both the block and the address page were one.
 */
export interface Paging {
  readonly page: number;
  readonly totalPages: number;
  readonly previousPage: number | null;
  readonly nextPage: number | null;
}

const MAX_PAGE = 100_000;

export function readPaging(value: unknown): Paging | null {
  if (!isRecord(value)) {
    return null;
  }
  const page = Number(integerText(value.pageAtomic) ?? integerText(value.page));
  const totalPages = Number(
    integerText(value.totalPagesAtomic) ?? integerText(value.totalPages)
  );
  if (
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(totalPages) ||
    page < 1 ||
    totalPages < 1 ||
    page > MAX_PAGE ||
    totalPages > MAX_PAGE
  ) {
    return null;
  }
  return {
    page,
    totalPages,
    previousPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
  };
}

export function readBlock(payload: ChainExplorerPayload): BlockReading | null {
  if (classifyPayload(payload) !== 'block') {
    return null;
  }
  if (!isRecord(payload.block)) {
    return readFlatBlock(payload);
  }
  const block = payload.block;
  const pagination = isRecord(payload.pagination) ? payload.pagination : {};
  return {
    hash: text(block.hash) ?? '',
    height: formatExactInteger(text(block.heightAtomic)),
    time: formatTimestamp(text(block.time)),
    transactionCount: formatExactInteger(text(block.transactionCountAtomic)),
    sizeBytes: formatExactInteger(text(block.sizeBytesAtomic)),
    confirmations: formatExactInteger(text(block.confirmationsAtomic)),
    previousBlockHash: text(block.previousBlockHash),
    nextBlockHash: text(block.nextBlockHash),
    merkleRoot: text(block.merkleRoot),
    difficulty: text(block.difficulty),
    txids: Array.isArray(payload.txids) ? payload.txids.filter((id): id is string => typeof id === 'string') : [],
    paging: readPaging(pagination),
    unlisted: unlistedArrays(payload, ['txids']),
  };
}

/**
 * Arrays the payload carries that nothing on this page reads. Named and
 * counted rather than dropped, because an array silently skipped and an array
 * that was empty look identical to a reader, and on a protocol payload those
 * are opposite answers.
 */
function unlistedArrays(
  payload: ChainExplorerPayload,
  read: readonly string[]
): readonly { label: string; count: number }[] {
  const known = new Set(read);
  const found: { label: string; count: number }[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (known.has(key) || !Array.isArray(value) || value.length === 0) {
      continue;
    }
    found.push({ label: humanizeFieldName(key), count: value.length });
  }
  return found;
}

/**
 * The Zcash shape: block fields at the top level, snake_case, with the
 * transaction ids inside a `transactions` envelope that counts from an offset
 * rather than a page number.
 *
 * Only the facts this payload actually carries are read. Size, difficulty,
 * merkle root, confirmations and the next block are not in it, and they stay
 * null rather than being invented or borrowed from elsewhere.
 */
function readFlatBlock(payload: ChainExplorerPayload): BlockReading | null {
  const hash = text(payload.hash);
  if (!hash) {
    return null;
  }
  const list = isRecord(payload.transactions) ? payload.transactions : {};
  return {
    hash,
    height: formatExactInteger(text(payload.height)),
    time: formatUnixTimestamp(text(payload.time)),
    transactionCount: formatExactInteger(text(payload.tx_count)),
    sizeBytes: null,
    confirmations: null,
    previousBlockHash: text(payload.prev_hash),
    nextBlockHash: null,
    merkleRoot: null,
    difficulty: null,
    txids: Array.isArray(list.items)
      ? list.items.filter((id): id is string => typeof id === 'string')
      : [],
    paging: readOffsetPaging(list),
    unlisted: unlistedArrays(payload, []),
  };
}

/**
 * Paging stated as an offset and a limit rather than as a page number. The
 * arithmetic is done on safe integers only, and anything that does not divide
 * into whole pages is reported as no paging rather than as a page number that
 * would be wrong.
 */
export function readOffsetPaging(value: unknown): Paging | null {
  if (!isRecord(value)) {
    return null;
  }
  const total = Number(integerText(value.total));
  const offset = Number(integerText(value.offset));
  const limit = Number(integerText(value.limit));
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(limit) ||
    total < 0 ||
    offset < 0 ||
    limit < 1 ||
    offset % limit !== 0
  ) {
    return null;
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = offset / limit + 1;
  if (page > totalPages || totalPages > MAX_PAGE) {
    return null;
  }
  return {
    page,
    totalPages,
    previousPage: page > 1 ? page - 1 : null,
    nextPage: page < totalPages ? page + 1 : null,
  };
}

export interface UtxoRow {
  readonly txid: string;
  readonly vout: string;
  readonly amount: ExactNumber | null;
  readonly height: ExactNumber | null;
  readonly confirmations: ExactNumber | null;
}

export interface AddressReading {
  readonly address: string;
  readonly balance: ExactNumber | null;
  readonly totalReceived: ExactNumber | null;
  readonly totalSent: ExactNumber | null;
  readonly unconfirmedBalance: ExactNumber | null;
  readonly transactionCount: ExactNumber | null;
  readonly unconfirmedCount: ExactNumber | null;
  readonly txids: readonly string[];
  readonly utxos: readonly UtxoRow[];
  readonly paging: Paging | null;
}

export function readAddress(
  payload: ChainExplorerPayload,
  profile: ChainProfile
): AddressReading | null {
  if (classifyPayload(payload) !== 'address') {
    return null;
  }
  const utxos = Array.isArray(payload.utxos) ? payload.utxos.filter(isRecord) : [];
  return {
    address: text(payload.address) ?? '',
    balance: formatAtomicAmount(text(payload.balanceAtomic), profile.precision),
    totalReceived: formatAtomicAmount(text(payload.totalReceivedAtomic), profile.precision),
    totalSent: formatAtomicAmount(text(payload.totalSentAtomic), profile.precision),
    unconfirmedBalance: formatAtomicAmount(text(payload.unconfirmedBalanceAtomic), profile.precision),
    transactionCount: formatExactInteger(text(payload.transactionCountAtomic)),
    unconfirmedCount: formatExactInteger(text(payload.unconfirmedTransactionsAtomic)),
    txids: Array.isArray(payload.txids) ? payload.txids.filter((id): id is string => typeof id === 'string') : [],
    paging: readPaging(payload.pagination),
    utxos: utxos.map((entry) => ({
      txid: text(entry.txid) ?? '',
      vout: text(entry.voutAtomic) ?? '',
      amount: formatAtomicAmount(text(entry.valueAtomic), profile.precision),
      height: formatExactInteger(text(entry.heightAtomic)),
      confirmations: formatExactInteger(text(entry.confirmationsAtomic)),
    })),
  };
}

export interface OutpointReading {
  readonly txid: string;
  readonly vout: string;
  readonly amount: ExactNumber | null;
  readonly address: string | null;
  readonly spent: boolean | null;
}

export function readOutpoint(
  payload: ChainExplorerPayload,
  profile: ChainProfile
): OutpointReading | null {
  if (classifyPayload(payload) !== 'outpoint' || !isRecord(payload.outpoint)) {
    return null;
  }
  const output = isRecord(payload.output) ? payload.output : {};
  return {
    txid: text(payload.outpoint.txid) ?? '',
    vout: text(payload.outpoint.voutAtomic) ?? '',
    amount: formatAtomicAmount(text(output.valueAtomic), profile.precision),
    address: text(output.address),
    spent: typeof output.spent === 'boolean' ? output.spent : null,
  };
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface CollectionColumn {
  readonly key: string;
  readonly label: string;
  readonly numeric: boolean;
  /** Named once in the header rather than repeated in every cell. */
  readonly unit: string | null;
}

export interface CollectionCell {
  readonly key: string;
  readonly fact: Fact | null;
}

export interface CollectionReading {
  /** The field the rows came from, so the page can name what it is listing. */
  readonly sourceKey: string;
  readonly title: string;
  readonly columns: readonly CollectionColumn[];
  readonly rows: readonly (readonly CollectionCell[])[];
  readonly shownCount: number;
  readonly totalCount: number;
  /**
   * Fields present in the rows that the table did not have room for. A table
   * that quietly drops a column reads as a complete answer, so the page says
   * how many it is holding back and the full response stays one click away.
   */
  readonly hiddenColumnCount: number;
  /** Fields that were identical on every row, and so became no column at all. */
  readonly constantColumnCount: number;
}

/** How many rows a page renders before it says how many it is holding back. */
export const COLLECTION_ROW_LIMIT = 100;
/** How many columns stay legible on a phone before the table stops helping. */
const COLLECTION_COLUMN_LIMIT = 7;

/**
 * The longest array in the payload, read as a table.
 *
 * Columns are the union of the keys across the rows shown, in first-seen
 * order, so a row that omits a field leaves a blank cell rather than shifting
 * every column after it. That was the failure of taking the first row's first
 * eight keys: two responses with slightly different rows produced two tables
 * whose columns did not line up with their headers.
 */
export function readCollection(
  payload: ChainExplorerPayload,
  profile: ChainProfile
): CollectionReading | null {
  if (!isRecord(payload)) {
    return null;
  }
  let sourceKey = '';
  let source: unknown[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value) && value.length > source.length) {
      sourceKey = key;
      source = value;
    }
  }
  if (!source.length) {
    return null;
  }

  const shown = source.slice(0, COLLECTION_ROW_LIMIT);
  const scalarRows = shown.map((entry) =>
    isRecord(entry) ? entry : { value: entry }
  );

  const order: string[] = [];
  for (const row of scalarRows) {
    for (const [key, value] of Object.entries(row)) {
      if (value !== null && typeof value === 'object') {
        continue;
      }
      if (!order.includes(key)) {
        order.push(key);
      }
    }
  }

  // A column whose value is the same on every row tells a reader nothing, and
  // it costs one of the few slots a table has on a phone. The live mempool
  // response is the case that showed it: its rows are whole transaction
  // envelopes, so schemaVersion, chain and network were three of the seven
  // columns and every cell in them was identical. They are still reported,
  // once each, by the record reading beside the table.
  const varying =
    scalarRows.length > 1
      ? order.filter((key) => {
          const first = scalarRows[0][key];
          return scalarRows.some((row) => row[key] !== first);
        })
      : order;
  const constantColumnCount = order.length - varying.length;
  const hiddenColumnCount = Math.max(0, varying.length - COLLECTION_COLUMN_LIMIT);
  const columns = varying.slice(0, COLLECTION_COLUMN_LIMIT).map((key) => ({
    key,
    label: humanizeFieldName(key),
    numeric: isCoinAmount(key) || /Atomic$/.test(key),
    unit: isCoinAmount(key) ? profile.ticker : null,
  }));

  return {
    sourceKey,
    title: humanizeFieldName(sourceKey),
    columns,
    rows: scalarRows.map((row) =>
      columns.map((column) => ({
        key: column.key,
        fact: factFrom(column.key, row[column.key], profile),
      }))
    ),
    shownCount: shown.length,
    totalCount: source.length,
    hiddenColumnCount,
    constantColumnCount,
  };
}

export interface TransactionListRow {
  readonly txid: string;
  readonly statusLabel: string;
  readonly statusTone: EvidenceTone;
  readonly firstSeenAt: ExactNumber | null;
  readonly size: ExactNumber | null;
  readonly fee: ExactNumber | null;
  readonly logicalActions: ExactNumber | null;
}

/**
 * What the cost column can honestly be, decided by what the rows carry.
 *
 * Dogecoin reports a fee amount and no rate. Zcash reports no amount at all on
 * a pending transaction, because a shielded transaction's fee is not derivable
 * from its transparent side, and reports ZIP-317 logical actions instead. A
 * fixed "Fee" column would have been empty on every row of the Zcash pending
 * list, which is the page's most valuable column spent on nothing.
 */
export type TransactionCostColumn = 'amount' | 'logical-actions' | 'none';

export interface TransactionListReading {
  readonly rows: readonly TransactionListRow[];
  readonly shownCount: number;
  readonly totalCount: number;
  readonly costColumn: TransactionCostColumn;
}

/**
 * A pending set, read as transactions rather than as a table of field names.
 *
 * The live mempool response carries whole transaction envelopes, one per row,
 * not the summary rows the fixtures assumed. Rendered generically that produced
 * seven columns of which three were the same on every row, and the two figures
 * a reader actually wants from a pending list, what it pays and how big it is,
 * were not among them.
 */
export function readTransactionList(
  payload: ChainExplorerPayload | null,
  profile: ChainProfile
): TransactionListReading | null {
  if (!payload || !isRecord(payload)) {
    return null;
  }
  const source = Object.values(payload).find(
    (value): value is unknown[] =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((entry) => classifyPayload(entry as ChainExplorerPayload) === 'transaction')
  );
  if (!source) {
    return null;
  }
  const shown = source.slice(0, COLLECTION_ROW_LIMIT).filter(isRecord);
  const rows = shown.map((entry) => {
    const status = text(entry.status) ?? '';
    const fee = isRecord(entry.fee) ? entry.fee : {};
    return {
      txid: text(entry.txid) ?? '',
      statusLabel: LIFECYCLE_LABEL[status] ?? availabilityLabel(status),
      statusTone: LIFECYCLE_TONE[status] ?? 'neutral',
      firstSeenAt: formatTimestamp(text(entry.firstSeenAt)),
      size: formatExactInteger(text(entry.sizeBytesAtomic)),
      fee: formatAtomicAmount(text(fee.amountAtomic), profile.precision),
      logicalActions: formatExactInteger(text(fee.logicalActionsAtomic)),
    };
  });

  // The amount wins where any row has one, because it is the figure a reader
  // is looking for. Logical actions are the fallback only when no row reports
  // an amount at all, which is the shielded case rather than a gap.
  const costColumn: TransactionCostColumn = rows.some((row) => row.fee)
    ? 'amount'
    : rows.some((row) => row.logicalActions)
      ? 'logical-actions'
      : 'none';

  return { rows, shownCount: shown.length, totalCount: source.length, costColumn };
}

export interface EmptyListReading {
  /** The field the list would have come from. */
  readonly field: string;
  readonly label: string;
  /**
   * True when the authority also said its view is complete, which turns an
   * empty list into a proven none rather than an absence of knowledge.
   *
   * The distinction is the product's whole claim, and this page was missing it:
   * with no pending Zcash transactions, which is a real and common state, the
   * page showed a status rail, a record of the snapshot, and nothing at all
   * where the list would be. A reader could not tell "there are none" from
   * "the list did not load".
   */
  readonly proven: boolean;
}

/**
 * An empty list the authority actually returned.
 *
 * Only when there is no non-empty array to read instead, so a payload carrying
 * both a full list and an empty one is described by the full one.
 */
export function readEmptyList(
  payload: ChainExplorerPayload | null
): EmptyListReading | null {
  if (!payload || !isRecord(payload)) {
    return null;
  }
  const entries = Object.entries(payload).filter(([, value]) =>
    Array.isArray(value)
  );
  if (!entries.length || entries.some(([, value]) => (value as unknown[]).length)) {
    return null;
  }
  const [field] = entries[0];
  const snapshot = isRecord(payload.snapshot) ? payload.snapshot : {};
  const completeness =
    text(payload.completeness) ?? text(snapshot.completeness);
  return {
    field,
    label: humanizeFieldName(field),
    proven: completeness === 'complete',
  };
}

/**
 * A list of plain identifier strings, which is how block transaction lists and
 * address history arrive. Kept apart from {@link readCollection} because a
 * column of hashes is a navigation list, not a table.
 */
export function readIdentifierList(values: unknown): readonly string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}
