import { UniverseLiveEnvelope } from '@app/universe/universe-websocket.service';

/**
 * The live view's memory.
 *
 * A bounded buffer of everything this view actually received, oldest first,
 * with three guarantees the visualizer's honesty rests on:
 *
 * 1. **No duplicates.** An envelope is identified by its chain, channel, and
 *    exact sequence number. A reconnect that redelivers is absorbed, never
 *    shown twice.
 * 2. **Gaps are found, not papered over.** Sequence numbers are decimal
 *    strings that can exceed any safe integer, so they are compared as
 *    BigInt. A gap between neighbours is a stated fact about the stream, and
 *    the service's own resync instruction clears it.
 * 3. **The window is what it is.** The buffer holds what arrived while this
 *    view was open. Replay scrubs this buffer; it never claims to reach
 *    further back than it does.
 */

export const MAXIMUM_BUFFER = 500;

export interface LiveEntry {
  readonly envelope: UniverseLiveEnvelope;
  /** Milliseconds since the epoch when this view received it. */
  readonly receivedAt: number;
}

export interface BufferReport {
  readonly entries: readonly LiveEntry[];
  /** Entries dropped from the front because the buffer is full. */
  readonly evicted: number;
  /** Duplicate envelopes absorbed since the buffer opened. */
  readonly duplicates: number;
  /** Channels where the sequence skipped, with the gap size. */
  readonly gaps: readonly { readonly key: string; readonly missing: number }[];
}

export function channelKey(envelope: UniverseLiveEnvelope): string {
  return `${envelope.chain}/${envelope.channel}`;
}

function sequenceOf(envelope: UniverseLiveEnvelope): bigint {
  return BigInt(envelope.sequenceAtomic);
}

/**
 * Appends envelopes to a buffer state, dropping duplicates and recording
 * gaps. Pure: takes the previous state, returns the next one.
 */
export function appendEnvelopes(
  previous: BufferReport,
  envelopes: readonly UniverseLiveEnvelope[],
  receivedAt: number = Date.now(),
): BufferReport {
  const entries = [...previous.entries];
  const gapMap = new Map(previous.gaps.map((gap) => [gap.key, { ...gap }]));
  let evicted = previous.evicted;
  let duplicates = previous.duplicates;
  const seen = previousSeen(previous);

  for (const envelope of envelopes) {
    const key = `${channelKey(envelope)}/${envelope.sequenceAtomic}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const last = lastSequence(entries, channelKey(envelope));
    if (last !== null) {
      const missing = sequenceOf(envelope) - last - 1n;
      if (missing > 0n) {
        gapMap.set(channelKey(envelope), {
          key: channelKey(envelope),
          missing: Number(missing),
        });
      }
    }

    entries.push({ envelope, receivedAt });
  }

  while (entries.length > MAXIMUM_BUFFER) {
    entries.shift();
    evicted += 1;
  }

  return {
    entries,
    evicted,
    duplicates,
    gaps: [...gapMap.values()],
  };
}

/** Marks a channel's gap as resolved, after the service asks for a resync. */
export function clearGap(previous: BufferReport, key: string): BufferReport {
  return {
    ...previous,
    gaps: previous.gaps.filter((gap) => gap.key !== key),
  };
}

function previousSeen(previous: BufferReport): Set<string> {
  return new Set(previous.entries.map((entry) =>
    `${channelKey(entry.envelope)}/${entry.envelope.sequenceAtomic}`));
}

function lastSequence(entries: readonly LiveEntry[], key: string): bigint | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (channelKey(entries[i].envelope) === key) {
      return sequenceOf(entries[i].envelope);
    }
  }
  return null;
}

export interface LiveFilter {
  readonly chain: string | null;
  readonly channel: string | null;
  readonly completeness: string | null;
}

export const EMPTY_FILTER: LiveFilter = { chain: null, channel: null, completeness: null };

/** True when an entry passes the filter. A null filter field passes all. */
export function passesFilter(entry: LiveEntry, filter: LiveFilter): boolean {
  if (filter.chain && entry.envelope.chain !== filter.chain) { return false; }
  if (filter.channel && entry.envelope.channel !== filter.channel) { return false; }
  if (filter.completeness && entry.envelope.completeness !== filter.completeness) { return false; }
  return true;
}

/** The filtered slice, oldest first, bounded to what replay can step through. */
export function filterEntries(entries: readonly LiveEntry[], filter: LiveFilter): readonly LiveEntry[] {
  return entries.filter((entry) => passesFilter(entry, filter));
}

/** One summary row per chain and channel, for the status board. */
export interface ChannelSummary {
  readonly key: string;
  readonly chain: string;
  readonly channel: string;
  readonly count: number;
  readonly lastSequence: string | null;
  readonly lastObservedAt: string | null;
  readonly lastReceivedAt: number | null;
  readonly completeness: string | null;
  readonly missing: number;
}

export function summarize(entries: readonly LiveEntry[], gaps: readonly { readonly key: string; readonly missing: number }[]): readonly ChannelSummary[] {
  const map = new Map<string, ChannelSummary>();
  for (const entry of entries) {
    const key = channelKey(entry.envelope);
    const existing = map.get(key);
    map.set(key, {
      key,
      chain: entry.envelope.chain,
      channel: entry.envelope.channel,
      count: (existing?.count ?? 0) + 1,
      lastSequence: entry.envelope.sequenceAtomic,
      lastObservedAt: entry.envelope.observedAt,
      lastReceivedAt: entry.receivedAt,
      completeness: entry.envelope.completeness,
      missing: gaps.find((gap) => gap.key === key)?.missing ?? 0,
    });
  }
  return [...map.values()].sort((a, b) => a.key < b.key ? -1 : 1);
}

/** How old a received time is, in honest words rather than silent staleness. */
export function ageWords(receivedAt: number | null, now: number): string {
  if (receivedAt === null) { return 'never'; }
  const seconds = Math.max(0, Math.round((now - receivedAt) / 1000));
  if (seconds < 5) { return 'just now'; }
  if (seconds < 90) { return `${seconds} seconds ago`; }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) { return `${minutes} minute${minutes === 1 ? '' : 's'} ago`; }
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
