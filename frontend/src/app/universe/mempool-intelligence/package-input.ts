import { PackageSimulation } from './mempool-intelligence.types';
import { formatFeerate } from './cluster-format';

/**
 * Reading a package out of a text box, and saying in one sentence what came
 * back.
 *
 * Both halves are here because both are places a simulator quietly lies. A
 * splitter that accepts a truncated transaction sends it to the node and
 * reports the node's confusion as the user's answer. A headline that says
 * "rejected" without saying by how much is a headline nobody can act on.
 */

/** Most transactions a node will relay as one package. */
export const MAX_PACKAGE_SIZE = 25;

export interface SplitResult {
  readonly rawTxs: string[];
  /** Set when nothing usable came out, saying what was wrong. */
  readonly error: string | null;
}

/**
 * Splits pasted text into raw transactions.
 *
 * Transactions are separated by any whitespace or by commas, which covers a
 * paste from a terminal, from a JSON array, and from a list somebody typed.
 * Quotes and brackets are stripped so a JSON array pasted whole works without
 * anyone having to tidy it first.
 */
export function splitRawTransactions(text: string): SplitResult {
  const cleaned = (text ?? '').replace(/[[\]"'`]/g, ' ');
  const parts = cleaned.split(/[\s,]+/).filter((part) => part.length > 0);
  if (!parts.length) {
    return { rawTxs: [], error: $localize`:@@mempool.simulate.empty:Paste at least one raw transaction in hexadecimal.` };
  }
  if (parts.length > MAX_PACKAGE_SIZE) {
    return {
      rawTxs: [],
      error: $localize`:@@mempool.simulate.too-many:That is ${parts.length} transactions. A node relays at most ${MAX_PACKAGE_SIZE} as one package.`,
    };
  }
  for (const part of parts) {
    if (!/^[0-9a-fA-F]+$/.test(part)) {
      return {
        rawTxs: [],
        error: $localize`:@@mempool.simulate.not-hex:One of these is not hexadecimal. A raw transaction is hexadecimal only, with no prefix.`,
      };
    }
    if (part.length % 2 !== 0) {
      return {
        rawTxs: [],
        error: $localize`:@@mempool.simulate.odd:One of these has an odd number of characters, so it is missing at least half a byte.`,
      };
    }
    // Sixty bytes is below the smallest transaction that can exist and above
    // a transaction id, which is what someone pastes here by mistake. A txid
    // is hexadecimal and even length, so only the length tells them apart.
    if (part.length < 120) {
      return {
        rawTxs: [],
        error: $localize`:@@mempool.simulate.too-short:One of these is too short to be a transaction. A transaction id is not a raw transaction.`,
      };
    }
  }
  const lowered = parts.map((part) => part.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return { rawTxs: [], error: $localize`:@@mempool.simulate.duplicate:The same transaction appears twice. A package holds each one once.` };
  }
  return { rawTxs: lowered, error: null };
}

export type HeadlineKind = 'accepted' | 'rejected' | 'replacement-short' | 'unreadable';

export interface Headline {
  readonly kind: HeadlineKind;
  readonly text: string;
  /** True when the node would take this package as it stands. */
  readonly positive: boolean;
}

/**
 * States the outcome in one sentence.
 *
 * The order matters. A package that is short of the fee its replacement needs
 * gets that sentence rather than the general rejection, because the shortfall
 * is the only part of the answer anyone can act on.
 */
export function headlineFor(simulation: PackageSimulation): Headline {
  if (simulation.cyclic) {
    return {
      kind: 'unreadable',
      positive: false,
      text: $localize`:@@mempool.simulate.cyclic:These transactions spend each other in a loop. No node will relay that, and it cannot be ordered into a package.`,
    };
  }
  const replacement = simulation.replacement;
  if (replacement && replacement.shortfallSats > 0) {
    return {
      kind: 'replacement-short',
      positive: false,
      text: $localize`:@@mempool.simulate.short:This replaces ${replacement.evictedTxids.length} transaction${replacement.evictedTxids.length === 1 ? '' : 's'} and pays ${replacement.shortfallSats} satoshis less than the rules require. It needs ${replacement.requiredFeeSats} in total.`,
    };
  }
  if (replacement && replacement.incompleteReason) {
    return {
      kind: 'rejected',
      positive: false,
      text: replacement.incompleteReason,
    };
  }
  if (simulation.accepted) {
    return {
      kind: 'accepted',
      positive: true,
      text: replacement
        ? $localize`:@@mempool.simulate.accept-replace:This node would accept this package, replacing ${replacement.evictedTxids.length} transaction${replacement.evictedTxids.length === 1 ? '' : 's'} already in its mempool.`
        : $localize`:@@mempool.simulate.accept:This node would accept this package as it stands.`,
    };
  }
  const refused = simulation.transactions.filter((tx) => !tx.allowed);
  const first = refused[0];
  return {
    kind: 'rejected',
    positive: false,
    text: refused.length === 1 && first?.rejectReason
      ? $localize`:@@mempool.simulate.refuse-one:This node would refuse this package. It said: ${first.rejectReason}`
      : $localize`:@@mempool.simulate.refuse-many:This node would refuse ${refused.length} of these ${simulation.transactions.length} transactions.`,
  };
}

/**
 * How many blocks of work sit ahead of a package at the current mempool.
 *
 * Rounded down and reported alongside the virtual bytes it came from, because
 * the byte count is the measurement and the block count is a convenience
 * derived from it at one assumed block size.
 */
export const BLOCK_VSIZE = 1_000_000;

export function blocksAhead(vsizeAhead: number): number {
  return Math.floor(vsizeAhead / BLOCK_VSIZE);
}

/**
 * A fee rate that may not be known.
 *
 * Delegates the formatting so a rate reads the same here as on every cluster
 * page, and adds the one thing those pages never need: a rate that is absent
 * says so in a word rather than showing a number for it.
 */
export function formatOptionalFeerate(rate: number | null): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) {
    return $localize`:@@mempool.simulate.rate-unknown:unknown`;
  }
  return formatFeerate(rate);
}
