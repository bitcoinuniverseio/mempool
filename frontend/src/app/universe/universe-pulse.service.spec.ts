import { describe, expect, it } from 'vitest';
import { protocolIdsOf } from '@app/universe/universe-pulse.service';
import { sharesOf } from '@app/universe/pulse/pulse.component';
import { stripEntries } from '@app/universe/protocol-strip/protocol-strip.component';
import type { ExplorerTransactionAssetFlow } from '@app/universe/universe.types';

function flow(patch: Partial<ExplorerTransactionAssetFlow> = {}): ExplorerTransactionAssetFlow {
  return {
    schemaVersion: 'universe-transaction-asset-flow-v1',
    chain: 'bitcoin',
    network: 'mainnet',
    txid: 'a'.repeat(64),
    status: 'confirmed',
    inputs: [],
    outputs: [],
    actions: [],
    sourceEvidence: [],
    complete: true,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
    ...patch,
  };
}

describe('protocolIdsOf', () => {
  it('finds nothing in an empty flow', () => {
    expect(protocolIdsOf(flow())).toEqual([]);
  });

  it('collects protocols from both sides and from actions', () => {
    const ids = protocolIdsOf(
      flow({
        inputs: [{ asset: { protocolId: 'ordinals' } }] as never,
        outputs: [{ asset: { protocolId: 'runes' } }] as never,
        actions: [{ protocolId: 'rare_sats' }] as never,
      }),
    );
    expect(ids).toEqual(['ordinals', 'rare_sats', 'runes']);
  });

  it('deduplicates and sorts', () => {
    const ids = protocolIdsOf(
      flow({
        inputs: [{ asset: { protocolId: 'runes' } }] as never,
        outputs: [{ asset: { protocolId: 'runes' } }] as never,
      }),
    );
    expect(ids).toEqual(['runes']);
  });

  it('tolerates missing collections', () => {
    expect(protocolIdsOf({} as ExplorerTransactionAssetFlow)).toEqual([]);
  });
});

describe('sharesOf', () => {
  const names = new Map([['runes', 'RUNES']]);

  it('floors percentages so a rare protocol is never rounded into significance', () => {
    const shares = sharesOf(
      { checked: 1000, protocolCounts: new Map([['runes', 4]]) } as never,
      names,
    );
    expect(shares[0].percent).toBe(0);
    expect(shares[0].count).toBe(4);
  });

  it('reports zero percent when nothing has been checked', () => {
    const shares = sharesOf(
      { checked: 0, protocolCounts: new Map([['runes', 0]]) } as never,
      names,
    );
    expect(shares[0].percent).toBe(0);
  });

  it('sorts by count, then by id for a stable order', () => {
    const shares = sharesOf(
      {
        checked: 10,
        protocolCounts: new Map([
          ['ordinals', 3],
          ['runes', 3],
          ['rare_sats', 5],
        ]),
      } as never,
      new Map(),
    );
    expect(shares.map((share) => share.protocolId)).toEqual(['rare_sats', 'ordinals', 'runes']);
  });

  it('falls back to the protocol id when the registry has no name', () => {
    const shares = sharesOf({ checked: 1, protocolCounts: new Map([['x', 1]]) } as never, new Map());
    expect(shares[0].displayName).toBe('x');
  });
});

describe('stripEntries', () => {
  const supported = [
    { id: 'runes', shortName: 'RUNES' },
    { id: 'ordinals', shortName: 'Ordinals' },
  ] as never;

  it('lists every supported protocol, including those with no activity', () => {
    const entries = stripEntries(supported, { protocolCounts: new Map() } as never);
    expect(entries.map((entry) => entry.protocolId).sort()).toEqual(['ordinals', 'runes']);
    expect(entries.every((entry) => entry.count === 0)).toBe(true);
  });

  it('puts the busiest protocol first', () => {
    const entries = stripEntries(supported, {
      protocolCounts: new Map([['ordinals', 7]]),
    } as never);
    expect(entries[0].protocolId).toBe('ordinals');
  });
});
