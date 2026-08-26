import { describe, expect, it } from 'vitest';
import {
  formatAtomicAmount,
  groupPositionsByProtocol,
  outpointEvidence,
  shortenIdentifier,
} from '@app/universe/universe-evidence';
import type { OutpointEnrichment } from '@app/universe/universe.types';

function enrichment(patch: Partial<OutpointEnrichment> = {}): OutpointEnrichment {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    status: 'ok',
    positions: [],
    coveredProtocolIds: ['ordinals'],
    unknownAttachments: false,
    checkpoint: null,
    ...patch,
  };
}

describe('outpointEvidence', () => {
  it('calls a clean answer proven', () => {
    const view = outpointEvidence(enrichment());
    expect(view.tone).toBe('proven');
  });

  it('separates a proven empty output from a proven full one', () => {
    const empty = outpointEvidence(enrichment());
    const full = outpointEvidence(
      enrichment({ positions: [{ asset: { protocolId: 'runes' } }] as never }),
    );
    expect(empty.tone).toBe('proven');
    expect(full.tone).toBe('proven');
    expect(empty.detail).not.toBe(full.detail);
  });

  it('downgrades to partial when attachments are unaccounted for', () => {
    expect(outpointEvidence(enrichment({ unknownAttachments: true })).tone).toBe('partial');
  });

  it('treats an outage as unavailable, never as an empty result', () => {
    const view = outpointEvidence(enrichment({ status: 'unavailable' }));
    expect(view.tone).toBe('unavailable');
    expect(view.detail.toLowerCase()).toContain('nothing is claimed');
  });

  it('distinguishes an unconfigured deployment from an outage', () => {
    const unconfigured = outpointEvidence(enrichment({ status: 'unconfigured' }));
    const unavailable = outpointEvidence(enrichment({ status: 'unavailable' }));
    expect(unconfigured.label).not.toBe(unavailable.label);
  });

  it('describes a coverage boundary as a boundary, not a failure', () => {
    const view = outpointEvidence(enrichment({ status: 'not-indexed' }));
    expect(view.tone).toBe('partial');
    expect(view.detail).toContain('keeps no inventory');
  });

  it('says the chain moved when the read straddled a block', () => {
    const view = outpointEvidence(enrichment({ status: 'stale' }));
    expect(view.tone).toBe('partial');
    expect(view.label).toBeTruthy();
  });

  it('refuses to trust a malformed answer', () => {
    expect(outpointEvidence(enrichment({ status: 'malformed' })).tone).toBe('unavailable');
  });
});

describe('groupPositionsByProtocol', () => {
  it('handles no positions', () => {
    expect(groupPositionsByProtocol([])).toEqual([]);
    expect(groupPositionsByProtocol(undefined as never)).toEqual([]);
  });

  it('groups by protocol and sorts by id', () => {
    const groups = groupPositionsByProtocol([
      { asset: { protocolId: 'runes' } },
      { asset: { protocolId: 'ordinals' } },
      { asset: { protocolId: 'runes' } },
    ] as never);
    expect(groups.map((group) => group.protocolId)).toEqual(['ordinals', 'runes']);
    expect(groups[1].positions).toHaveLength(2);
  });

  it('files a position with no protocol under unknown rather than dropping it', () => {
    const groups = groupPositionsByProtocol([{ asset: undefined }] as never);
    expect(groups[0].protocolId).toBe('unknown');
  });
});

describe('formatAtomicAmount', () => {
  it('groups thousands', () => {
    expect(formatAtomicAmount('1234567')).toBe('1,234,567');
  });

  it('applies decimals without floating point', () => {
    expect(formatAtomicAmount('123456789', 8)).toBe('1.23456789');
    expect(formatAtomicAmount('100000000', 8)).toBe('1');
    expect(formatAtomicAmount('1', 8)).toBe('0.00000001');
  });

  it('keeps precision far past the safe integer range', () => {
    const huge = '340282366920938463463374607431768211455';
    expect(formatAtomicAmount(huge).replace(/,/g, '')).toBe(huge);
  });

  it('refuses anything that is not a non-negative integer string', () => {
    expect(formatAtomicAmount('-1')).toBe('');
    expect(formatAtomicAmount('1.5')).toBe('');
    expect(formatAtomicAmount('007')).toBe('');
    expect(formatAtomicAmount(undefined as never)).toBe('');
  });

  it('ignores an out-of-range divisibility rather than guessing', () => {
    expect(formatAtomicAmount('1000', 99)).toBe('1,000');
    expect(formatAtomicAmount('1000', -1)).toBe('1,000');
  });
});

describe('shortenIdentifier', () => {
  it('leaves short values alone', () => {
    expect(shortenIdentifier('abcdef')).toBe('abcdef');
  });

  it('keeps both ends of a long identifier', () => {
    const value = 'a'.repeat(30) + 'b'.repeat(30);
    const short = shortenIdentifier(value, 6);
    expect(short.startsWith('aaaaaa')).toBe(true);
    expect(short.endsWith('bbbbbb')).toBe(true);
  });

  it('tolerates a missing value', () => {
    expect(shortenIdentifier(undefined as never)).toBe('');
  });
});
