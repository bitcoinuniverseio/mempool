import { describe, expect, it } from 'vitest';

import {
  MAXIMUM_BUFFER,
  ageWords,
  appendEnvelopes,
  channelKey,
  clearGap,
  EMPTY_FILTER,
  filterEntries,
  passesFilter,
  summarize,
  type BufferReport,
} from './live-buffer';
import { UniverseLiveEnvelope } from '@app/universe/universe-websocket.service';

const EMPTY: BufferReport = { entries: [], evicted: 0, duplicates: 0, gaps: [] };

let sequenceCounter = 0;

function envelope(overrides: Partial<UniverseLiveEnvelope> = {}): UniverseLiveEnvelope {
  sequenceCounter += 1;
  return {
    schemaVersion: 'universe-websocket-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    channel: 'chain-status',
    snapshotId: 'snap-1',
    sequenceAtomic: String(sequenceCounter),
    observedAt: '2026-09-02T00:00:00Z',
    completeness: 'complete',
    ...overrides,
  };
}

describe('appendEnvelopes', () => {
  it('keeps everything it received, oldest first', () => {
    const first = envelope();
    const second = envelope();
    const state = appendEnvelopes(EMPTY, [first, second]);
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].envelope.sequenceAtomic).toBe(first.sequenceAtomic);
    expect(state.entries[1].envelope.sequenceAtomic).toBe(second.sequenceAtomic);
  });

  it('absorbs a redelivered envelope as a duplicate, once, not twice', () => {
    const same = envelope();
    const state = appendEnvelopes(appendEnvelopes(EMPTY, [same]), [same]);
    expect(state.entries).toHaveLength(1);
    expect(state.duplicates).toBe(1);
  });

  it('detects a gap in the exact sequence, beyond safe integer size', () => {
    const first = envelope({ sequenceAtomic: '18446744073709551616' });
    const next = envelope({ sequenceAtomic: '18446744073709551620' });
    const state = appendEnvelopes(appendEnvelopes(EMPTY, [first]), [next]);
    expect(state.gaps).toEqual([{ key: 'bitcoin/chain-status', missing: 3 }]);
  });

  it('tracks gaps per channel, not globally', () => {
    const state = appendEnvelopes(appendEnvelopes(EMPTY, [
      envelope({ chain: 'bitcoin', sequenceAtomic: '10' }),
      envelope({ chain: 'dogecoin', sequenceAtomic: '10' }),
    ]), [
      envelope({ chain: 'bitcoin', sequenceAtomic: '13' }),
      envelope({ chain: 'dogecoin', sequenceAtomic: '11' }),
    ]);
    expect(state.gaps.map((gap) => gap.key)).toEqual(['bitcoin/chain-status']);
  });

  it('clears a gap when told the service resynced it', () => {
    const withGap: BufferReport = {
      ...EMPTY,
      gaps: [{ key: 'bitcoin/chain-status', missing: 5 }],
    };
    expect(clearGap(withGap, 'bitcoin/chain-status').gaps).toHaveLength(0);
    expect(clearGap(withGap, 'other').gaps).toHaveLength(1);
  });

  it('evicts the oldest past the ceiling and counts what it dropped', () => {
    let state = EMPTY;
    for (let i = 0; i < MAXIMUM_BUFFER + 12; i++) {
      state = appendEnvelopes(state, [envelope()]);
    }
    expect(state.entries).toHaveLength(MAXIMUM_BUFFER);
    expect(state.evicted).toBe(12);
  });
});

describe('filters', () => {
  const entries = appendEnvelopes(EMPTY, [
    envelope({ chain: 'bitcoin', channel: 'chain-status' }),
    envelope({ chain: 'dogecoin', channel: 'mempool-snapshot', completeness: 'partial' }),
  ]).entries;

  it('passes everything when no filter is set', () => {
    expect(filterEntries(entries, EMPTY_FILTER)).toHaveLength(2);
  });

  it('narrows by chain and channel', () => {
    expect(filterEntries(entries, { ...EMPTY_FILTER, chain: 'dogecoin' })).toHaveLength(1);
    expect(filterEntries(entries, { ...EMPTY_FILTER, channel: 'chain-status' })).toHaveLength(1);
  });

  it('narrows by stated completeness', () => {
    expect(filterEntries(entries, { ...EMPTY_FILTER, completeness: 'partial' })).toHaveLength(1);
    expect(passesFilter(entries[0], { ...EMPTY_FILTER, completeness: 'partial' })).toBe(false);
  });
});

describe('summarize', () => {
  it('rolls the buffer into one row per channel, with the gap carried', () => {
    const state = appendEnvelopes(appendEnvelopes(EMPTY, [
      envelope({ sequenceAtomic: '5' }),
    ]), [envelope({ sequenceAtomic: '7' })]);
    const summary = summarize(state.entries, state.gaps);
    expect(summary).toHaveLength(1);
    expect(summary[0].count).toBe(2);
    expect(summary[0].lastSequence).toBe('7');
    expect(summary[0].missing).toBe(1);
  });

  it('says never for a channel the view has not heard', () => {
    const summary = summarize([], []);
    expect(summary).toHaveLength(0);
  });
});

describe('ageWords', () => {
  const now = 1_000_000_000_000;

  it('says never when nothing was received', () => {
    expect(ageWords(null, now)).toBe('never');
  });

  it('speaks seconds, minutes, and hours', () => {
    expect(ageWords(now - 7_000, now)).toBe('7 seconds ago');
    expect(ageWords(now - 120_000, now)).toBe('2 minutes ago');
    expect(ageWords(now - 7_200_000, now)).toBe('2 hours ago');
  });
});

describe('channelKey', () => {
  it('pairs the chain with the channel', () => {
    expect(channelKey(envelope({ chain: 'zcash', channel: 'candidate-buckets' })))
      .toBe('zcash/candidate-buckets');
  });
});
