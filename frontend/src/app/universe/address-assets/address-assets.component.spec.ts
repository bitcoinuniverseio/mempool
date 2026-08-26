import { describe, expect, it } from 'vitest';
import { summarise } from '@app/universe/address-assets/address-assets.component';
import type { OutpointEnrichment } from '@app/universe/universe.types';

function result(patch: Partial<OutpointEnrichment> = {}): OutpointEnrichment {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    status: 'ok',
    positions: [],
    coveredProtocolIds: [],
    unknownAttachments: false,
    checkpoint: null,
    ...patch,
  };
}

function position(protocolId: string, assetId: string, quantityAtomic?: string): unknown {
  return {
    outpoint: `${'a'.repeat(64)}:0`,
    vout: 0,
    valueSatsAtomic: '546',
    asset: { protocolId, canonicalAssetId: assetId, assetKind: 'fungible', displayName: assetId },
    quantityAtomic,
    state: 'unspent',
    evidence: { authorityId: 'ord', coverage: 'complete' },
  };
}

describe('summarise', () => {
  it('reports nothing for no results', () => {
    const summary = summarise([]);
    expect(summary.holdings).toEqual([]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(false);
  });

  it('counts only the outputs the authority actually answered for', () => {
    const summary = summarise([result(), result({ status: 'unavailable' })]);
    expect(summary.resolved).toBe(1);
    expect(summary.partial).toBe(true);
  });

  it('does not treat a coverage boundary as a failure', () => {
    const summary = summarise([result({ status: 'not-indexed' })]);
    expect(summary.resolved).toBe(0);
    expect(summary.partial).toBe(false);
  });

  it('flags unknown attachments as partial', () => {
    const summary = summarise([result({ unknownAttachments: true })]);
    expect(summary.partial).toBe(true);
  });

  it('sums quantities across outputs without losing precision', () => {
    const big = '340282366920938463463374607431768211455';
    const summary = summarise([
      result({ positions: [position('runes', 'RUNE', big)] as never }),
      result({ positions: [position('runes', 'RUNE', '1')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBe(
      (BigInt(big) + 1n).toString(),
    );
  });

  it('keeps a holding with no quantity rather than inventing a zero', () => {
    const summary = summarise([
      result({ positions: [position('ordinals', 'insc1')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
    expect(summary.holdings[0].outpoints).toHaveLength(1);
  });

  it('separates assets that share a protocol', () => {
    const summary = summarise([
      result({
        positions: [position('runes', 'A', '1'), position('runes', 'B', '2')] as never,
      }),
    ]);
    expect(summary.holdings).toHaveLength(2);
  });

  it('ignores a malformed quantity instead of guessing', () => {
    const summary = summarise([
      result({ positions: [position('runes', 'A', '-5')] as never }),
    ]);
    expect(summary.holdings[0].quantityAtomic).toBeNull();
  });

  it('drops a position with no protocol rather than filing it wrongly', () => {
    const summary = summarise([
      result({ positions: [{ outpoint: 'x', asset: {} }] as never }),
    ]);
    expect(summary.holdings).toEqual([]);
  });

  it('reports the most recent checkpoint it saw', () => {
    const summary = summarise([
      result({ checkpoint: { heightAtomic: '900000', blockHash: 'a' } as never }),
      result({ checkpoint: { heightAtomic: '900001', blockHash: 'b' } as never }),
    ]);
    expect(summary.checkpointHeight).toBe('900001');
  });

  it('sorts holdings by protocol, then by how many outputs hold them', () => {
    const summary = summarise([
      result({
        positions: [
          position('runes', 'A', '1'),
          position('runes', 'B', '1'),
          position('runes', 'B', '1'),
          position('ordinals', 'C'),
        ] as never,
      }),
    ]);
    expect(summary.holdings.map((holding) => holding.protocolId)).toEqual([
      'ordinals',
      'runes',
      'runes',
    ]);
    expect(summary.holdings[1].displayName).toBe('B');
  });
});
