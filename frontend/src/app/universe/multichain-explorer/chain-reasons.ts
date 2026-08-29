/**
 * The words behind a chain's own verdict on itself.
 *
 * `/api/v1/<chain>/status` states `ready` and, when that is false, a list of
 * codes saying why. The codes are a machine contract, so they arrive as
 * `protocol-history-unavailable` and the like. Printing them is a field dump,
 * and dropping them leaves a verdict with no evidence behind it, which is the
 * one thing this product must never do.
 *
 * Two further distinctions the raw list does not make on its own:
 *
 * - A code on a source that is *ready* is not a fault. `tap_doge` reports
 *   `pending-protocol-coverage-unavailable` and `reorg-evidence-tail-only`
 *   while ready and complete: they are the stated edges of what that authority
 *   covers, not something broken. Shown under a failure heading they read as
 *   an outage that is not happening.
 * - A code this build has no sentence for is not the same as no code. It is
 *   shown, humanised, and marked as stated but not explained here, rather than
 *   silently dropped or given a meaning it may not have.
 */

export type ChainReasonKind =
  /** Something the explorer depends on is not answering, or is not current. */
  | 'fault'
  /** A stated edge of what a working source covers. */
  | 'limit'
  /** A code this build carries no sentence for. */
  | 'unstated';

export interface ChainReasonReading {
  readonly code: string;
  readonly text: string;
  readonly kind: ChainReasonKind;
}

interface ReasonCopy {
  readonly text: string;
  readonly kind: Exclude<ChainReasonKind, 'unstated'>;
}

/**
 * An allowlist, deliberately. A pattern over these codes would match a new one
 * it has never seen and assert a meaning for it, and the whole point of this
 * table is that an unrecognised code stays unrecognised.
 *
 * Each sentence says what did not happen, not what it implies. The overlay
 * derives these in `chain-capabilities.service.ts`; the wording here follows
 * that derivation rather than paraphrasing the code name.
 */
const REASON_COPY: Record<string, ReasonCopy> = {
  'base-chain-authority-unavailable': {
    text: $localize`:@@universe.reason.base-chain-authority-unavailable:The node that serves this chain's own blocks and transactions did not answer.`,
    kind: 'fault',
  },
  'confirmed-history-authority-unavailable': {
    text: $localize`:@@universe.reason.confirmed-history-authority-unavailable:The source of confirmed history did not answer, so history older than the pending set cannot be read.`,
    kind: 'fault',
  },
  'mempool-collector-unavailable': {
    text: $localize`:@@universe.reason.mempool-collector-unavailable:The collector that watches pending transactions did not answer.`,
    kind: 'fault',
  },
  'mempool-collector-degraded': {
    text: $localize`:@@universe.reason.mempool-collector-degraded:The pending-transaction collector answered, but reports itself as not healthy.`,
    kind: 'fault',
  },
  'mempool-collector-recent-failure': {
    text: $localize`:@@universe.reason.mempool-collector-recent-failure:The pending-transaction collector's most recent attempt failed, so the set below may have missed arrivals.`,
    kind: 'fault',
  },
  'mempool-coverage-partial': {
    text: $localize`:@@universe.reason.mempool-coverage-partial:The pending set is a partial view of the node's mempool rather than all of it.`,
    kind: 'fault',
  },
  'node-initial-block-download': {
    text: $localize`:@@universe.reason.node-initial-block-download:The node is still downloading the chain for the first time, so it does not yet hold every block.`,
    kind: 'fault',
  },
  'protocol-history-unavailable': {
    text: $localize`:@@universe.reason.protocol-history-unavailable:At least one protocol indexer this chain needs is not answering, so protocol history cannot be read. Blocks, transactions and addresses are unaffected.`,
    kind: 'fault',
  },
  'protocol-history-partial': {
    text: $localize`:@@universe.reason.protocol-history-partial:Protocol history is readable but does not yet cover the whole chain.`,
    kind: 'fault',
  },
  'protocol-authority-unavailable': {
    text: $localize`:@@universe.reason.protocol-authority-unavailable:This protocol's indexer did not answer.`,
    kind: 'fault',
  },
  'protocol-authority-stale': {
    text: $localize`:@@universe.reason.protocol-authority-stale:This protocol's indexer answered, but its last checkpoint is behind the chain tip.`,
    kind: 'fault',
  },
  'authority-capability-disabled': {
    text: $localize`:@@universe.reason.authority-capability-disabled:The running index was built without this protocol switched on, so it cannot serve it at all until it is rebuilt.`,
    kind: 'fault',
  },
  'pending-protocol-coverage-unavailable': {
    text: $localize`:@@universe.reason.pending-protocol-coverage-unavailable:This authority reads confirmed blocks only. It says nothing about pending transactions.`,
    kind: 'limit',
  },
  'reorg-evidence-tail-only': {
    text: $localize`:@@universe.reason.reorg-evidence-tail-only:This authority keeps reorganisation evidence for recent blocks only, not for the whole chain.`,
    kind: 'limit',
  },
};

/**
 * A code with no sentence here, made readable without being interpreted. The
 * words are the code's own: `protocol-authority-stale` becomes "Protocol
 * authority stale" and nothing is added to it.
 */
function readableCode(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim();
  if (!words) {
    return code;
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One code, read. An unknown code keeps its own words rather than borrowing any. */
export function describeChainReason(code: string): ChainReasonReading {
  const copy = REASON_COPY[code];
  if (copy) {
    return { code, text: copy.text, kind: copy.kind };
  }
  return { code, text: readableCode(code), kind: 'unstated' };
}

export function describeChainReasons(codes: readonly string[]): readonly ChainReasonReading[] {
  return codes.map(describeChainReason);
}
