import { describe, expect, it } from 'vitest';
import {
  EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION,
  SummaryDecodeError,
  coverageIncomplete,
  decodeTransactionAssetSummary,
  exactQuantity,
  summaryAssetKey,
} from './transaction-assets.types';

const TXID = 'a'.repeat(64);
const HASH = 'b'.repeat(64);
const CONTEXT = { chain: 'bitcoin', network: 'signet', txid: TXID };

function assetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chain: 'bitcoin',
    network: 'signet',
    protocolId: 'runes',
    assetId: 'UNCOMMON.GOODS',
    ruleset: null,
    assetKind: 'fungible',
    displayName: 'Uncommon Goods',
    ticker: 'UNCOMMON',
    decimals: 2,
    logo: null,
    inputs: { quantityAtomic: '0', positionCountAtomic: '0', complete: true },
    outputs: { quantityAtomic: '1234', positionCountAtomic: '1', complete: true },
    effects: [],
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const assets = (overrides.assets as unknown[]) ?? [assetRow()];
  return {
    schemaVersion: EXPLORER_TX_ASSET_SUMMARY_SCHEMA_VERSION,
    chain: 'bitcoin',
    network: 'signet',
    txid: TXID,
    status: 'confirmed',
    assets,
    perProtocolCoverage: [
      { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete' },
    ],
    counts: {
      fungibleTypeCountAtomic: '1',
      collectibleItemCountAtomic: '0',
      otherAssetCountAtomic: '0',
      protocolCountAtomic: '1',
      knownCountAtomic: String(assets.length),
      totalCount: null,
    },
    retryAfterSeconds: 5,
    ...overrides,
  };
}

describe('decodeTransactionAssetSummary', () => {
  it('decodes a well-formed summary', () => {
    const summary = decodeTransactionAssetSummary(payload(), CONTEXT);
    expect(summary.txid).toBe(TXID);
    expect(summary.assets).toHaveLength(1);
    expect(summary.assets[0].outputs.quantityAtomic).toBe('1234');
    expect(summary.counts.totalCount).toBeNull();
    expect(coverageIncomplete(summary)).toBe(true);
  });

  it('keeps an unknown field from a newer source without failing', () => {
    const summary = decodeTransactionAssetSummary(
      payload({ someFutureField: { nested: true } }),
      CONTEXT,
    );
    expect(summary.assets).toHaveLength(1);
  });

  it('refuses a payload for another transaction or network', () => {
    expect(() => decodeTransactionAssetSummary(payload(), { ...CONTEXT, txid: 'c'.repeat(64) }))
      .toThrow(SummaryDecodeError);
    expect(() => decodeTransactionAssetSummary(payload(), { ...CONTEXT, network: 'mainnet' }))
      .toThrow(SummaryDecodeError);
    expect(() => decodeTransactionAssetSummary(payload(), { ...CONTEXT, chain: 'dogecoin' }))
      .toThrow(SummaryDecodeError);
  });

  it('refuses an unsupported schema version', () => {
    expect(() => decodeTransactionAssetSummary(payload({ schemaVersion: 'v2' }), CONTEXT))
      .toThrow(SummaryDecodeError);
  });

  it('refuses a quantity that is a number, signed or exponent form', () => {
    for (const quantityAtomic of [1234, '-1', '1e8', '1.5', '01']) {
      const assets = [assetRow({ outputs: { quantityAtomic, positionCountAtomic: '1', complete: true } })];
      expect(() => decodeTransactionAssetSummary(payload({ assets }), CONTEXT))
        .toThrow(SummaryDecodeError);
    }
  });

  it('accepts a quantity beyond the safe integer range verbatim', () => {
    const big = (2n ** 128n - 1n).toString();
    const assets = [assetRow({ outputs: { quantityAtomic: big, positionCountAtomic: '1', complete: true } })];
    const summary = decodeTransactionAssetSummary(payload({ assets }), CONTEXT);
    expect(summary.assets[0].outputs.quantityAtomic).toBe(big);
  });

  it('refuses out-of-range divisibility rather than rounding later', () => {
    for (const decimals of [39, -1, 1.5, '2']) {
      expect(() => decodeTransactionAssetSummary(payload({ assets: [assetRow({ decimals })] }), CONTEXT))
        .toThrow(SummaryDecodeError);
    }
  });

  it('keeps a null divisibility as unknown', () => {
    const summary = decodeTransactionAssetSummary(
      payload({ assets: [assetRow({ decimals: null })] }),
      CONTEXT,
    );
    expect(summary.assets[0].decimals).toBeNull();
  });

  it('refuses a summary that lists one identity twice', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({
        assets: [assetRow(), assetRow()],
        counts: { ...(payload().counts as Record<string, unknown>), knownCountAtomic: '2' },
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses counts that disagree with the rows', () => {
    const counts = { ...(payload().counts as Record<string, unknown>), knownCountAtomic: '7' };
    expect(() => decodeTransactionAssetSummary(payload({ counts }), CONTEXT))
      .toThrow(SummaryDecodeError);
  });

  it('refuses a totalCount that is neither null nor a count', () => {
    const counts = { ...(payload().counts as Record<string, unknown>), totalCount: 'many' };
    expect(() => decodeTransactionAssetSummary(payload({ counts }), CONTEXT))
      .toThrow(SummaryDecodeError);
  });

  it('accepts a proven-empty transaction with a total of zero', () => {
    const summary = decodeTransactionAssetSummary(payload({
      assets: [],
      counts: {
        fungibleTypeCountAtomic: '0',
        collectibleItemCountAtomic: '0',
        otherAssetCountAtomic: '0',
        protocolCountAtomic: '0',
        knownCountAtomic: '0',
        totalCount: 0,
      },
    }), CONTEXT);
    expect(summary.counts.totalCount).toBe(0);
    expect(coverageIncomplete(summary)).toBe(false);
  });

  it('accepts a same-origin content-addressed logo', () => {
    const logo = {
      objectPath: '/universe-media/v1/objects/' + HASH,
      contentHash: HASH,
      mediaType: 'image/png',
      metadataRevision: 'rev-1',
      verified: true,
    };
    const summary = decodeTransactionAssetSummary(payload({ assets: [assetRow({ logo })] }), CONTEXT);
    expect(summary.assets[0].logo?.contentHash).toBe(HASH);
  });

  it('drops an unsafe logo without dropping the asset or its quantity', () => {
    for (const logo of [
      { objectPath: 'https://cdn.example/x.png', contentHash: HASH, metadataRevision: 'r' },
      { objectPath: '/universe-media/v1/objects/../../etc/passwd', contentHash: '../..', metadataRevision: 'r' },
      { objectPath: '/universe-media/v1/objects/' + HASH, contentHash: 'c'.repeat(64), metadataRevision: 'r' },
      // Not marked verified by the producer, so it is not promoted to a logo.
      { objectPath: '/universe-media/v1/objects/' + HASH, contentHash: HASH, metadataRevision: 'r' },
      'not-an-object',
    ]) {
      const summary = decodeTransactionAssetSummary(payload({ assets: [assetRow({ logo })] }), CONTEXT);
      expect(summary.assets[0].logo).toBeNull();
      expect(summary.assets[0].outputs.quantityAtomic).toBe('1234');
    }
  });

  it('refuses an asset row from another context', () => {
    const assets = [assetRow({ network: 'mainnet' })];
    expect(() => decodeTransactionAssetSummary(payload({ assets }), CONTEXT))
      .toThrow(SummaryDecodeError);
  });
});

describe('summaryAssetKey', () => {
  it('separates protocols, rulesets and networks', () => {
    const base = { chain: 'bitcoin', network: 'signet', protocolId: 'runes', assetId: 'A', ruleset: null };
    expect(summaryAssetKey(base)).not.toBe(summaryAssetKey({ ...base, protocolId: 'alkanes' }));
    expect(summaryAssetKey(base)).not.toBe(summaryAssetKey({ ...base, ruleset: 'strict' }));
    expect(summaryAssetKey(base)).not.toBe(summaryAssetKey({ ...base, network: 'mainnet' }));
  });

  it('does not collide on ids that contain the separator characters', () => {
    const base = { chain: 'bitcoin', network: 'signet', protocolId: 'runes', assetId: '840000:1', ruleset: null };
    expect(summaryAssetKey(base)).not.toBe(summaryAssetKey({ ...base, assetId: '840000', ruleset: '1' }));
  });
});

describe('exactQuantity', () => {
  it('shifts by the stated divisibility using string arithmetic', () => {
    expect(exactQuantity('1234', 2)).toBe('12.34');
    expect(exactQuantity('1', 18)).toBe('0.000000000000000001');
    expect(exactQuantity('150000000', 8)).toBe('1.5');
    expect(exactQuantity('100', 0)).toBe('100');
  });

  it('is exact beyond the safe integer range', () => {
    expect(exactQuantity('340282366920938463463374607431768211455', 0))
      .toBe('340282366920938463463374607431768211455');
  });

  it('is null when divisibility is unknown, so digits are labelled atomic', () => {
    expect(exactQuantity('1234', null)).toBeNull();
  });

  it('is null for an unstated quantity rather than zero', () => {
    expect(exactQuantity(null, 8)).toBeNull();
  });
});

describe('decoder: coverage and totals must agree', () => {
  it('refuses a coverage state the contract does not define', () => {
    // A cast would render whichever template branch a value falls through to,
    // and the fall-through branch is the reassuring one.
    expect(() => decodeTransactionAssetSummary(
      payload({
        perProtocolCoverage: [
          { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'probably-fine' },
        ],
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses two coverage rows for one protocol', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({
        perProtocolCoverage: [
          { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete' },
          { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'unavailable' },
        ],
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses a coverage row from another context', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({
        perProtocolCoverage: [
          { protocolId: 'runes', chain: 'bitcoin', network: 'mainnet', state: 'complete' },
        ],
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses a stated total while a source is inconclusive', () => {
    // The defect this closes: a total claims nothing is missing, so it cannot
    // stand beside a protocol nobody read.
    expect(() => decodeTransactionAssetSummary(
      payload({
        perProtocolCoverage: [
          { protocolId: 'runes', chain: 'bitcoin', network: 'signet', state: 'complete' },
          { protocolId: 'brc20', chain: 'bitcoin', network: 'signet', state: 'unconfigured' },
        ],
        counts: { ...(payload().counts as Record<string, unknown>), totalCount: 1 },
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses a stated total that disagrees with the identities listed', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({
        counts: { ...(payload().counts as Record<string, unknown>), totalCount: 7 },
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('refuses a stated total with no coverage at all', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({
        perProtocolCoverage: [],
        counts: { ...(payload().counts as Record<string, unknown>), totalCount: 1 },
      }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });

  it('accepts a stated total that every source accounts for', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({
        counts: { ...(payload().counts as Record<string, unknown>), totalCount: 1 },
      }),
      CONTEXT,
    );
    expect(decoded.counts.totalCount).toBe(1);
    expect(coverageIncomplete(decoded)).toBe(false);
  });

  it('refuses a missing assets array rather than rendering an empty inventory', () => {
    // The most misleading thing this component can do is say "no supported
    // assets" because a field was absent.
    const broken = payload();
    delete broken.assets;
    expect(() => decodeTransactionAssetSummary(broken, CONTEXT)).toThrow(SummaryDecodeError);
  });

  it('refuses a missing coverage array', () => {
    const broken = payload();
    delete broken.perProtocolCoverage;
    expect(() => decodeTransactionAssetSummary(broken, CONTEXT)).toThrow(SummaryDecodeError);
  });

  it('refuses a non-array effects list on an asset', () => {
    expect(() => decodeTransactionAssetSummary(
      payload({ assets: [assetRow({ effects: 'none' })] }),
      CONTEXT,
    )).toThrow(SummaryDecodeError);
  });
});

describe('decoder: evidence and checkpoints survive', () => {
  const evidence = {
    authorityId: 'ord',
    protocolId: 'runes',
    coverage: 'complete',
    checkedAt: '2026-09-19T00:00:00.000Z',
    checkpoint: {
      chain: 'bitcoin',
      network: 'signet',
      heightAtomic: '240000',
      blockHash: HASH,
      reorgEpoch: '0',
      observedAt: '2026-09-19T00:00:00.000Z',
    },
  };

  it('keeps an effect\u2019s evidence rather than dropping it', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({
        assets: [
          assetRow({
            effects: [
              { eventId: 'e1', actionType: 'transfer', quantityAtomic: '1234', accepted: false, evidence },
            ],
          }),
        ],
      }),
      CONTEXT,
    );
    const [effect] = decoded.assets[0].effects;
    // Without this, "not accepted" cannot be told apart from "not yet ruled on".
    expect(effect.accepted).toBe(false);
    expect(effect.evidence?.authorityId).toBe('ord');
    expect(effect.evidence?.checkpoint?.heightAtomic).toBe('240000');
  });

  it('keeps the asset\u2019s own evidence list', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({ assets: [assetRow({ evidence: [evidence] })] }),
      CONTEXT,
    );
    expect(decoded.assets[0].evidence).toHaveLength(1);
  });

  it('drops malformed evidence without discarding the proven quantity', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({ assets: [assetRow({ evidence: [{ nonsense: true }] })] }),
      CONTEXT,
    );
    expect(decoded.assets[0].evidence).toHaveLength(0);
    expect(decoded.assets[0].outputs.quantityAtomic).toBe('1234');
  });

  it('keeps a complete checkpoint and refuses a partial one', () => {
    const complete = decodeTransactionAssetSummary(
      payload({ checkpoint: evidence.checkpoint }),
      CONTEXT,
    );
    expect(complete.checkpoint?.heightAtomic).toBe('240000');

    // Absent is null. A zero height beside a real block hash would say the
    // reading was taken at genesis, which is false for all but one block.
    const partial = decodeTransactionAssetSummary(
      payload({ checkpoint: { blockHash: HASH } }),
      CONTEXT,
    );
    expect(partial.checkpoint).toBeNull();

    const absent = decodeTransactionAssetSummary(payload(), CONTEXT);
    expect(absent.checkpoint).toBeNull();
  });

  it('keeps an accepted effect and a rejected one distinguishable', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({
        assets: [
          assetRow({
            effects: [
              { eventId: 'a', actionType: 'transfer', quantityAtomic: '1', accepted: true },
              { eventId: 'b', actionType: 'transfer', quantityAtomic: '1', accepted: 'yes' },
              { eventId: 'c', actionType: 'transfer', quantityAtomic: '1' },
            ],
          }),
        ],
      }),
      CONTEXT,
    );
    // Only an explicit true is acceptance: a truthy string is not the authority
    // saying yes.
    expect(decoded.assets[0].effects.map((effect) => effect.accepted))
      .toEqual([true, false, false]);
  });
});

describe('decoder: quantity boundaries', () => {
  it('keeps a zero quantity and an unstated one apart', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({
        assets: [
          assetRow({
            inputs: { quantityAtomic: '0', positionCountAtomic: '0', complete: true },
            outputs: { quantityAtomic: null, positionCountAtomic: '1', complete: false },
          }),
        ],
      }),
      CONTEXT,
    );
    expect(decoded.assets[0].inputs.quantityAtomic).toBe('0');
    expect(decoded.assets[0].outputs.quantityAtomic).toBeNull();
  });

  it('accepts the divisibility boundaries and refuses what is past them', () => {
    for (const decimals of [0, 38]) {
      const decoded = decodeTransactionAssetSummary(
        payload({ assets: [assetRow({ decimals })] }),
        CONTEXT,
      );
      expect(decoded.assets[0].decimals).toBe(decimals);
    }
    for (const decimals of [-1, 39, 1.5]) {
      expect(() => decodeTransactionAssetSummary(
        payload({ assets: [assetRow({ decimals })] }),
        CONTEXT,
      )).toThrow(SummaryDecodeError);
    }
  });

  it('keeps a u128 maximum exact', () => {
    const max = '340282366920938463463374607431768211455';
    const decoded = decodeTransactionAssetSummary(
      payload({
        assets: [
          assetRow({
            outputs: { quantityAtomic: max, positionCountAtomic: '1', complete: true },
          }),
        ],
      }),
      CONTEXT,
    );
    expect(decoded.assets[0].outputs.quantityAtomic).toBe(max);
  });

  it('refuses a logo the payload has not marked verified', () => {
    const decoded = decodeTransactionAssetSummary(
      payload({
        assets: [
          assetRow({
            logo: {
              objectPath: '/universe-media/v1/objects/' + HASH,
              contentHash: HASH,
              mediaType: 'image/png',
              metadataRevision: 'rev-1',
              verified: false,
            },
          }),
        ],
      }),
      CONTEXT,
    );
    // A labelled fallback, and the amount is untouched.
    expect(decoded.assets[0].logo).toBeNull();
    expect(decoded.assets[0].outputs.quantityAtomic).toBe('1234');
  });
});
