import { describe, expect, it } from 'vitest';
import {
  ChainCapabilityEnvelope,
  ChainExplorerPayload,
} from '@app/universe/universe.types';
import {
  chainProfile,
  classifyPayload,
  formatAtomicAmount,
  formatElapsed,
  formatExactInteger,
  formatTimestamp,
  historyLabel,
  humanizeFieldName,
  readAddress,
  readBlock,
  readCapabilities,
  readCollection,
  readEmptyList,
  readHistoryCoverage,
  readNotReadyReasons,
  readAddressHoldings,
  readOutpoint,
  readPaging,
  readProtocolCoverage,
  readRecordFacts,
  readSourceDetails,
  readStatusRail,
  readTransaction,
  shortenIdentifier,
} from '@app/universe/multichain-explorer/multichain-view';

const DOGE = chainProfile('dogecoin');
const ZEC = chainProfile('zcash');
const TXID = 'a'.repeat(64);
const BLOCK_HASH = 'b'.repeat(64);

function capability(
  overrides: Partial<ChainCapabilityEnvelope> = {}
): ChainCapabilityEnvelope {
  return {
    schemaVersion: 'universe-chain-capability-v1',
    chain: 'dogecoin',
    network: 'mainnet',
    asset: { symbol: 'DOGE', name: 'Dogecoin', precision: 8, atomicUnit: 'koinu' },
    ready: true,
    tip: { heightAtomic: '5123456', blockHash: BLOCK_HASH, observedAt: '2026-08-29T05:00:00.000Z' },
    sync: { state: 'ready', initialBlockDownload: false, progressDecimal: '1', updatedAt: '2026-08-29T05:00:00.000Z' },
    mempool: { supported: true, state: 'ready', completeness: 'complete', snapshotId: 's1', sequenceAtomic: '9', observedAt: '2026-08-29T05:00:00.000Z' },
    reads: { transaction: true, block: true, address: true, outpoint: true, feeEstimates: false, projectedBlocks: false },
    protocols: [],
    coverage: { confirmedHistory: 'complete', addressHistory: 'complete', protocolHistory: 'partial' },
    updatedAt: '2026-08-29T05:00:00.000Z',
    lagBlocksAtomic: '0',
    degradedReasons: [],
    release: { sha: 'abc1234' },
    ...overrides,
  } as ChainCapabilityEnvelope;
}

describe('formatExactInteger', () => {
  it('groups digits and keeps the source string', () => {
    expect(formatExactInteger('5123456')).toEqual({ display: '5,123,456', exact: '5123456' });
  });

  it('keeps zero as zero rather than treating it as absent', () => {
    expect(formatExactInteger('0')).toEqual({ display: '0', exact: '0' });
  });

  it('groups a negative value on the digits only', () => {
    expect(formatExactInteger('-1234')?.display).toBe('-1,234');
  });

  it('rejects anything that is not an exact integer string', () => {
    expect(formatExactInteger('1.5')).toBeNull();
    expect(formatExactInteger('007')).toBeNull();
    expect(formatExactInteger('')).toBeNull();
    expect(formatExactInteger(null)).toBeNull();
    expect(formatExactInteger(undefined)).toBeNull();
  });
});

describe('formatAtomicAmount', () => {
  it('shifts an atomic amount by the chain precision', () => {
    expect(formatAtomicAmount('100000000', 8)?.display).toBe('1');
  });

  it('drops trailing zeros but keeps significant ones', () => {
    expect(formatAtomicAmount('123450000', 8)?.display).toBe('1.2345');
    expect(formatAtomicAmount('100000001', 8)?.display).toBe('1.00000001');
  });

  it('pads an amount smaller than one whole unit', () => {
    expect(formatAtomicAmount('1', 8)?.display).toBe('0.00000001');
    expect(formatAtomicAmount('0', 8)?.display).toBe('0');
  });

  it('groups the whole part of a large balance', () => {
    expect(formatAtomicAmount('123456789012345678', 8)?.display).toBe('1,234,567,890.12345678');
  });

  it('stays exact past the range a double counts single units in', () => {
    // 2^53 koinu plus one. Parsing this as a number would lose the last digit.
    const amount = formatAtomicAmount('9007199254740993', 8);
    expect(amount?.display).toBe('90,071,992.54740993');
    expect(amount?.exact).toBe('9007199254740993');
  });

  it('keeps the sign on a negative value balance', () => {
    expect(formatAtomicAmount('-50000000', 8)?.display).toBe('-0.5');
  });
});

describe('formatElapsed', () => {
  const now = Date.parse('2026-08-29T06:00:00.000Z');

  it('reports coarse units', () => {
    expect(formatElapsed('2026-08-29T05:59:30.000Z', now)).toContain('30');
    expect(formatElapsed('2026-08-29T05:30:00.000Z', now)).toContain('30');
    expect(formatElapsed('2026-08-29T01:00:00.000Z', now)).toContain('5');
  });

  it('says one minute rather than 1 minutes', () => {
    expect(formatElapsed('2026-08-29T05:59:00.000Z', now)).toBe('1 minute ago');
    expect(formatElapsed('2026-08-29T05:59:59.000Z', now)).toBe('1 second ago');
    expect(formatElapsed('2026-08-29T05:00:00.000Z', now)).toBe('1 hour ago');
    expect(formatElapsed('2026-08-26T06:00:00.000Z', now)).toBe('3 days ago');
  });

  it('refuses to invent a freshness it cannot compute', () => {
    expect(formatElapsed('not a date', now)).toBeNull();
    expect(formatElapsed(null, now)).toBeNull();
    // A timestamp from the future is a clock problem, not a fresh reading.
    expect(formatElapsed('2026-08-29T07:00:00.000Z', now)).toBeNull();
  });
});

describe('historyLabel', () => {
  it('reads as a phrase rather than a bare adjective', () => {
    expect(historyLabel('complete')).toBe('Complete history');
    expect(historyLabel('partial')).toBe('Partial history');
    expect(historyLabel(undefined)).toBe('History not stated');
  });
});

describe('formatTimestamp', () => {
  it('reads at a glance and keeps the exact string', () => {
    const moment = formatTimestamp('2026-08-29T04:02:00.000Z');
    expect(moment?.display).toBe('29 Aug 2026, 04:02 UTC');
    expect(moment?.exact).toBe('2026-08-29T04:02:00.000Z');
  });

  it('always reports UTC, so two readers describe the same block the same way', () => {
    expect(formatTimestamp('2026-01-05T23:07:09Z')?.display).toBe('5 Jan 2026, 23:07 UTC');
  });

  it('returns nothing rather than an invented date', () => {
    expect(formatTimestamp('not a date')).toBeNull();
    expect(formatTimestamp(null)).toBeNull();
  });
});

describe('readPaging', () => {
  it('offers the neighbouring pages that exist', () => {
    expect(readPaging({ pageAtomic: '2', totalPagesAtomic: '3' })).toEqual({
      page: 2, totalPages: 3, previousPage: 1, nextPage: 3,
    });
  });

  it('offers no previous page on the first and no next on the last', () => {
    expect(readPaging({ pageAtomic: '1', totalPagesAtomic: '3' })?.previousPage).toBeNull();
    expect(readPaging({ pageAtomic: '3', totalPagesAtomic: '3' })?.nextPage).toBeNull();
  });

  it('rejects paging it cannot trust rather than linking nowhere', () => {
    expect(readPaging({ pageAtomic: '0', totalPagesAtomic: '3' })).toBeNull();
    expect(readPaging({ pageAtomic: '2' })).toBeNull();
    expect(readPaging(null)).toBeNull();
  });
});

describe('humanizeFieldName', () => {
  it('drops the exact-transport suffix the contract uses', () => {
    expect(humanizeFieldName('heightAtomic')).toBe('Height');
    expect(humanizeFieldName('progressDecimal')).toBe('Progress');
  });

  it('splits camel case into a sentence', () => {
    expect(humanizeFieldName('totalReceivedAtomic')).toBe('Total received');
    expect(humanizeFieldName('unconfirmedBalanceAtomic')).toBe('Unconfirmed balance');
  });

  it('keeps the names a reader already knows', () => {
    expect(humanizeFieldName('txid')).toBe('Transaction id');
    expect(humanizeFieldName('utxos')).toBe('Unspent outputs');
    expect(humanizeFieldName('drc20')).toBe('DRC-20');
  });

  it('returns the key unchanged when there is nothing to humanise', () => {
    expect(humanizeFieldName('')).toBe('');
  });
});

describe('shortenIdentifier', () => {
  it('keeps both ends so the value stays checkable', () => {
    const short = shortenIdentifier(TXID);
    expect(short.startsWith('aaaaaaaa')).toBe(true);
    expect(short.endsWith('aaaaaa')).toBe(true);
  });

  it('leaves a short value alone', () => {
    expect(shortenIdentifier('abc')).toBe('abc');
  });
});

describe('readStatusRail', () => {
  it('always returns the same five readings, in order', () => {
    const ids = readStatusRail(capability(), DOGE, Date.now()).map((r) => r.id);
    expect(ids).toEqual(['state', 'tip', 'lag', 'freshness', 'mempool']);
  });

  it('keeps all five readings when there is no status at all', () => {
    const rail = readStatusRail(null, DOGE, Date.now());
    expect(rail).toHaveLength(5);
    expect(rail[0].tone).toBe('unavailable');
  });

  it('calls a chain at the tip proven and a lagging one partial', () => {
    const now = Date.parse('2026-08-29T05:00:10.000Z');
    const atTip = readStatusRail(capability(), DOGE, now).find((r) => r.id === 'lag');
    expect(atTip?.tone).toBe('proven');

    const behind = readStatusRail(
      capability({ lagBlocksAtomic: '42' }),
      DOGE,
      now
    ).find((r) => r.id === 'lag');
    expect(behind?.tone).toBe('partial');
    expect(behind?.exact).toBe('42');
  });

  it('says a chain without a pending set is not offering one, not that it failed', () => {
    const reading = readStatusRail(
      capability({ mempool: { supported: false, state: 'unavailable', completeness: 'unavailable', snapshotId: null, sequenceAtomic: null, observedAt: null } }),
      DOGE,
      Date.now()
    ).find((r) => r.id === 'mempool');
    expect(reading?.tone).toBe('neutral');
  });
});

describe('readStatusRail freshness', () => {
  // "3 seconds ago" is the reading and the instant behind it was dropped, so
  // the one figure on the rail that changes on its own could not be checked
  // against anything.
  it('carries the exact observation time behind the relative one', () => {
    const reading = readStatusRail(capability(), DOGE, Date.now()).find(
      (r) => r.id === 'freshness'
    );
    expect(reading?.exact).toBe('2026-08-29T05:00:00.000Z');
  });
});

describe('readHistoryCoverage', () => {
  it('reports all three dimensions, in order', () => {
    const readings = readHistoryCoverage(capability());
    expect(readings.map((r) => r.id)).toEqual([
      'confirmedHistory',
      'addressHistory',
      'protocolHistory',
    ]);
  });

  // The overview rendered `reads` and dropped `coverage`, so Dogecoin said
  // address history was offered while the same document said it could not be
  // read. Both statements are in the envelope and both have to be on the page.
  it('says an unavailable history is unavailable while the read is still offered', () => {
    const envelope = capability({
      ready: false,
      coverage: {
        confirmedHistory: 'unavailable',
        addressHistory: 'unavailable',
        protocolHistory: 'unavailable',
      },
    });
    expect(readCapabilities(envelope).find((r) => r.id === 'address')?.state).toBe(
      'offered'
    );
    const address = readHistoryCoverage(envelope).find(
      (r) => r.id === 'addressHistory'
    );
    expect(address?.tone).toBe('unavailable');
    expect(address?.stateLabel).not.toBe('Complete');
  });

  it('states the dimensions rather than dropping them when nothing answered', () => {
    const readings = readHistoryCoverage(null);
    expect(readings).toHaveLength(3);
    expect(readings.every((r) => r.tone === 'neutral')).toBe(true);
  });
});

describe('readSourceDetails', () => {
  it('keeps the whole snapshot identifier for copying and shortens what is shown', () => {
    const long = 'dogecoin-mainnet-9304b4b3a53e788898da63a1b52cd509';
    const detail = readSourceDetails(
      capability({
        mempool: {
          supported: true,
          state: 'ready',
          completeness: 'complete',
          snapshotId: long,
          sequenceAtomic: '10916',
          observedAt: '2026-08-29T05:00:00.000Z',
        },
      })
    ).find((entry) => entry.id === 'snapshot');
    expect(detail?.exact).toBe(long);
    expect(detail?.display).not.toBe(long);
    expect(detail?.display.length).toBeLessThan(long.length);
    expect(detail?.truncated).toBe(true);
  });

  it('names which component the release identifier belongs to', () => {
    const detail = readSourceDetails(capability()).find(
      (entry) => entry.id === 'release'
    );
    expect(detail?.exact).toBe('abc1234');
    expect(detail?.note).toContain('overlay');
    expect(detail?.truncated).toBe(false);
  });

  it('carries the exact observation time and the schema the document declares', () => {
    const details = readSourceDetails(capability());
    expect(details.find((entry) => entry.id === 'observed')?.exact).toBe(
      '2026-08-29T05:00:00.000Z'
    );
    expect(details.find((entry) => entry.id === 'schema')?.display).toBe(
      'universe-chain-capability-v1'
    );
  });

  it('has nothing to file when no document was read', () => {
    expect(readSourceDetails(null)).toEqual([]);
  });
});

describe('readCapabilities', () => {
  it('lists every read, marking the ones the chain does not offer', () => {
    const reads = readCapabilities(capability());
    expect(reads.map((r) => r.id)).toEqual([
      'transaction', 'block', 'address', 'outpoint', 'feeEstimates', 'projectedBlocks', 'candidateBuckets',
    ]);
    expect(reads.find((r) => r.id === 'projectedBlocks')?.state).toBe('not-offered');
    expect(reads.find((r) => r.id === 'transaction')?.state).toBe('offered');
  });

  it('says nothing was stated when there is no envelope, rather than nothing offered', () => {
    const reads = readCapabilities(null);
    expect(reads.every((r) => r.state === 'unknown')).toBe(true);
    expect(reads.every((r) => r.tone === 'neutral')).toBe(true);
  });
});

describe('readProtocolCoverage', () => {
  it('shows every protocol the navigation offers, even one the overlay stopped reporting', () => {
    const readings = readProtocolCoverage(capability({ protocols: [] }), DOGE);
    expect(readings.map((r) => r.routeId)).toEqual(['doginals', 'drc20', 'doge-tap', 'dunes']);
    expect(readings[0].tone).toBe('neutral');
  });

  it('matches a tab to the registry id the envelope actually uses', () => {
    // Production reports tap_doge; the route serves it at doge-tap. Matching on
    // the route id alone listed the protocol twice, once falsely as not stated.
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'tap_doge', state: 'degraded', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: [] },
        ],
      }),
      DOGE
    );
    expect(readings).toHaveLength(4);
    const tap = readings.find((r) => r.routeId === 'doge-tap');
    expect(tap?.tone).toBe('partial');
    expect(tap?.label).toBe('TAP on Doge');
    expect(readings.filter((r) => r.label === 'TAP on Doge')).toHaveLength(1);
  });

  it('lists a protocol it has no page for, and offers no route to it', () => {
    // A protocol this build has no tab for gets no link: the API service
    // throws before it asks, so a link there is a dead end. Hiding it would
    // be a claim the chain did not make. Dunes was the live example until it
    // got a page of its own, so the case now uses an id no tab claims.
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'moon_bones', state: 'unavailable', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: [] },
        ],
      }),
      DOGE
    );
    const unclaimed = readings.find((r) => r.protocolId === 'moon_bones');
    expect(unclaimed).toBeDefined();
    expect(unclaimed?.routeId).toBeNull();
  });

  it('routes dunes to its own page', () => {
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'dunes', state: 'unavailable', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: [] },
        ],
      }),
      DOGE
    );
    const dunes = readings.find((r) => r.protocolId === 'dunes');
    expect(dunes?.routeId).toBe('dunes');
    expect(dunes?.label).toBe('Dunes');
  });

  it('carries the state, coverage and lag the overlay reported', () => {
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'drc20', state: 'degraded', coverage: 'partial', updatedAt: null, lagBlocksAtomic: '17', degradedReasons: ['protocol-authority-stale'] },
        ],
      }),
      DOGE
    );
    const drc20 = readings.find((r) => r.protocolId === 'drc20');
    expect(drc20?.tone).toBe('partial');
    expect(drc20?.lag?.display).toBe('17');
    expect(drc20?.reasons.map((reason) => reason.code)).toEqual(['protocol-authority-stale']);
    expect(drc20?.historyLabel).toBe(historyLabel('partial'));
  });

  it('appends a protocol the overlay reports that the profile does not list', () => {
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'newthing', state: 'ready', coverage: 'complete', updatedAt: null, lagBlocksAtomic: null, degradedReasons: [] },
        ],
      }),
      DOGE
    );
    expect(readings.map((r) => r.protocolId)).toContain('newthing');
    expect(readings.find((r) => r.protocolId === 'newthing')?.routeId).toBeNull();
  });
});

describe('classifyPayload', () => {
  it('recognises each shape by the fields its contract guarantees', () => {
    expect(classifyPayload(null)).toBe('empty');
    expect(classifyPayload({ schemaVersion: 'universe-transaction-v1', txid: TXID })).toBe('transaction');
    expect(classifyPayload({ block: { hash: BLOCK_HASH } })).toBe('block');
    expect(classifyPayload({ outpoint: { txid: TXID, voutAtomic: '0' } })).toBe('outpoint');
    expect(classifyPayload({ address: 'D7Zx' })).toBe('address');
    expect(classifyPayload({ items: [{ a: 1 }] })).toBe('collection');
    expect(classifyPayload({ state: 'unavailable' })).toBe('record');
  });

  it('does not read a transaction envelope from a schema version alone', () => {
    expect(classifyPayload({ schemaVersion: 'universe-transaction-v1' })).toBe('record');
  });

  it('does not treat an empty array as a collection', () => {
    expect(classifyPayload({ items: [] })).toBe('record');
  });
});

describe('readTransaction', () => {
  const envelope: ChainExplorerPayload = {
    schemaVersion: 'universe-transaction-v1',
    chain: 'zcash',
    network: 'mainnet',
    txid: TXID,
    status: 'confirmed',
    firstSeenAt: '2026-08-29T04:00:00.000Z',
    confirmationsAtomic: '12',
    sizeBytesAtomic: '1450',
    block: { hash: BLOCK_HASH, heightAtomic: '2900001', time: '2026-08-29T04:10:00.000Z' },
    fee: {
      amountAtomic: '15000',
      rateDecimal: null,
      rateUnit: null,
      logicalActionsAtomic: '2',
      model: 'ZIP-317-revision-1',
      evidence: {
        source: 'node-and-value-pool',
        nodeAmountAtomic: '15000',
        valuePoolAmountAtomic: '15000',
        unavailableReason: null,
      },
      rule: {
        name: 'ZIP-317-revision-1',
        revision: '1',
        supported: true,
        branchId: '37a5165b',
        upgradeName: 'NU6.3',
        activationBasis: 'block-height',
        activationHeightAtomic: '3428143',
        marginalFeeAtomic: '5000',
        graceActionsAtomic: '2',
        logicalActionsAtomic: '2',
        conventionalFeeAtomic: '10000',
        unsupportedReason: null,
        evidenceSource: 'zebra:getblockchaininfo:upgrades',
      },
    },
    conflicts: [],
    replacement: null,
    expiry: null,
    transparent: {
      inputs: [
        { indexAtomic: '0', previousOutpoint: `${TXID}:1`, address: 't1abc', valueAtomic: '200000000', coinbase: false },
      ],
      outputs: [
        { indexAtomic: '0', address: 't1def', valueAtomic: '150000000', spent: false },
        { indexAtomic: '1', address: 't1ghi', valueAtomic: '49985000', spent: true },
      ],
    },
    shielded: {
      sproutJoinSplitsAtomic: '0',
      saplingSpendsAtomic: '2',
      saplingOutputsAtomic: '2',
      orchardActionsAtomic: '0',
      ironwoodActionsAtomic: '0',
      valueBalanceAtomic: '-50000000',
      privacyNotice: 'Shielded participants are not recorded on chain.',
    },
    protocolActions: {
      candidates: [{ eventId: 'e1', protocolId: 'zerdinals', state: 'candidate', actionType: 'inscribe', evidenceIds: [] }],
      confirmed: [{ eventId: 'e2', protocolId: 'zrc20', state: 'confirmed-rejected', actionType: 'transfer', evidenceIds: [] }],
    },
    evidenceIds: [],
    completeness: 'complete',
  };

  it('reports the fee of a shielded transaction with the readings behind it', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.feeAmount?.display).toBe('0.00015');
    expect(tx?.feeEvidence?.crossChecked).toBe(true);
    expect(tx?.feeEvidence?.sourceLabel).toContain('in agreement');
    expect(tx?.feeEvidence?.unavailableLabel).toBeNull();
  });

  it('names the read that failed and never calls a fee private', () => {
    const unreadable = {
      ...envelope,
      fee: {
        ...(envelope.fee as Record<string, unknown>),
        amountAtomic: null,
        evidence: {
          source: null,
          nodeAmountAtomic: null,
          valuePoolAmountAtomic: null,
          unavailableReason: 'transparent-input-value',
        },
      },
    };
    const tx = readTransaction(unreadable, ZEC);
    expect(tx?.feeAmount).toBeNull();
    expect(tx?.feeEvidence?.unavailableLabel).toBe(
      'a transparent input this transaction spends could not be read'
    );
    expect(JSON.stringify(tx?.feeEvidence)).not.toMatch(/not public|private/i);
  });

  it('keeps both readings visible when the sources disagreed', () => {
    const disputed = {
      ...envelope,
      fee: {
        ...(envelope.fee as Record<string, unknown>),
        amountAtomic: null,
        evidence: {
          source: null,
          nodeAmountAtomic: '15000',
          valuePoolAmountAtomic: '14000',
          unavailableReason: 'sources-disagree',
        },
      },
    };
    const tx = readTransaction(disputed, ZEC);
    expect(tx?.feeAmount).toBeNull();
    expect(tx?.feeEvidence?.nodeAmount?.display).toBe('0.00015');
    expect(tx?.feeEvidence?.valuePoolAmount?.display).toBe('0.00014');
    expect(tx?.feeEvidence?.unavailableLabel).toContain('disagreed');
  });

  it('states the fee rule with the upgrade that put it in force', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.feeRule?.supported).toBe(true);
    expect(tx?.feeRule?.name).toBe('ZIP-317-revision-1');
    expect(tx?.feeRule?.upgradeName).toBe('NU6.3');
    expect(tx?.feeRule?.activationHeight?.display).toBe('3,428,143');
    expect(tx?.feeRule?.conventionalFee?.display).toBe('0.0001');
    expect(tx?.feeRule?.activationBasisLabel).toContain('own block');
  });

  it('shows an unsupported fee rule as unsupported, and still shows the fee', () => {
    const historical = {
      ...envelope,
      fee: {
        ...(envelope.fee as Record<string, unknown>),
        model: 'fee-rule-unsupported',
        rule: {
          name: 'fee-rule-unsupported',
          revision: null,
          supported: false,
          branchId: 'e9ff75a6',
          upgradeName: 'Canopy',
          activationBasis: 'block-height',
          activationHeightAtomic: '1046400',
          marginalFeeAtomic: null,
          graceActionsAtomic: null,
          logicalActionsAtomic: '2',
          conventionalFeeAtomic: null,
          unsupportedReason: 'zip317-not-in-force-at-this-height',
          evidenceSource: 'zebra:getblockchaininfo:upgrades',
        },
      },
    };
    const tx = readTransaction(historical, ZEC);
    expect(tx?.feeRule?.supported).toBe(false);
    expect(tx?.feeRule?.unsupportedLabel).toContain('not in force');
    expect(tx?.feeRule?.conventionalFee).toBeNull();
    // An unsupported rule never suppresses a fee that could be read.
    expect(tx?.feeAmount?.display).toBe('0.00015');
  });

  it('reads an authority that sends no fee evidence without inventing any', () => {
    const older = {
      ...envelope,
      fee: { amountAtomic: '15000', rateDecimal: null, rateUnit: null, logicalActionsAtomic: '2' },
    };
    const tx = readTransaction(older, ZEC);
    expect(tx?.feeAmount?.display).toBe('0.00015');
    expect(tx?.feeEvidence).toBeNull();
    expect(tx?.feeRule).toBeNull();
  });

  it('reads the lifecycle state as a sentence with an evidence tone', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.statusTone).toBe('proven');
    expect(tx?.statusLabel).toContain('block');
  });

  it('totals the transparent sides exactly', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.inputTotal?.display).toBe('2');
    expect(tx?.outputTotal?.display).toBe('1.99985');
  });

  it('shows no total when an amount was not reported, rather than a short one', () => {
    const partial = {
      ...envelope,
      transparent: {
        inputs: [
          { indexAtomic: '0', address: 't1abc', valueAtomic: '200000000', coinbase: false },
          { indexAtomic: '1', address: null, valueAtomic: null, coinbase: false },
        ],
        outputs: [],
      },
    };
    expect(readTransaction(partial, ZEC)?.inputTotal).toBeNull();
  });

  it('keeps the shielded structure without inferring participants', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.shielded?.valueBalance?.display).toBe('-0.5');
    expect(tx?.shielded?.components).toHaveLength(5);
    expect(tx?.shielded?.notice).toContain('not recorded');
  });

  it('separates candidate actions from evaluated ones and tones them apart', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.candidateActions[0].tone).toBe('pending');
    expect(tx?.confirmedActions[0].tone).toBe('unavailable');
    expect(tx?.confirmedActions[0].actionType).toBe('Transfer');
  });

  it('names a protocol the way the navigation does, not by its wire id', () => {
    const tx = readTransaction(envelope, ZEC);
    expect(tx?.candidateActions[0].protocolLabel).toBe('Zerdinals');
    expect(tx?.confirmedActions[0].protocolLabel).toBe('ZRC-20');
  });

  it('returns null for a payload that is not a transaction envelope', () => {
    expect(readTransaction({ address: 'D7Zx' }, ZEC)).toBeNull();
  });
});

describe('readBlock', () => {
  const payload: ChainExplorerPayload = {
    chain: 'dogecoin',
    network: 'mainnet',
    block: {
      hash: BLOCK_HASH,
      heightAtomic: '5123456',
      confirmationsAtomic: '3',
      sizeBytesAtomic: '28000',
      time: '2026-08-29T04:00:00.000Z',
      previousBlockHash: 'c'.repeat(64),
      nextBlockHash: null,
      merkleRoot: 'd'.repeat(64),
      versionAtomic: '4',
      nonce: '0',
      bits: '1a',
      difficulty: '12345.67',
      transactionCountAtomic: '42',
    },
    pagination: { pageAtomic: '1', totalPagesAtomic: '2', itemsOnPageAtomic: '50' },
    txids: [TXID],
  };

  it('reads the header facts and the paging', () => {
    const block = readBlock(payload);
    expect(block?.height?.display).toBe('5,123,456');
    expect(block?.transactionCount?.display).toBe('42');
    expect(block?.time?.display).toBe('29 Aug 2026, 04:00 UTC');
    expect(block?.paging).toEqual({ page: 1, totalPages: 2, previousPage: null, nextPage: 2 });
    expect(block?.txids).toEqual([TXID]);
  });

  it('accepts pagination that arrives as a JSON number', () => {
    const block = readBlock({ ...payload, pagination: { page: 3, totalPages: 9 } });
    expect(block?.paging?.page).toBe(3);
    expect(block?.paging?.nextPage).toBe(4);
  });

  it('leaves the next block absent rather than inventing one', () => {
    expect(readBlock(payload)?.nextBlockHash).toBeNull();
  });
});

describe('readAddress', () => {
  const payload: ChainExplorerPayload = {
    chain: 'dogecoin',
    network: 'mainnet',
    address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    balanceAtomic: '1234500000000',
    totalReceivedAtomic: '5000000000000',
    totalSentAtomic: '3765500000000',
    unconfirmedBalanceAtomic: '0',
    unconfirmedTransactionsAtomic: '0',
    transactionCountAtomic: '87',
    pagination: { pageAtomic: '1', totalPagesAtomic: '2', itemsOnPageAtomic: '50' },
    txids: [TXID],
    utxos: [
      { txid: TXID, voutAtomic: '0', valueAtomic: '1234500000000', heightAtomic: '5123400', confirmationsAtomic: '56', address: 'DH5y', lockTimeAtomic: '0', coinbase: false },
    ],
  };

  it('shifts every balance into the ticker unit', () => {
    const address = readAddress(payload, DOGE);
    expect(address?.balance?.display).toBe('12,345');
    expect(address?.totalReceived?.display).toBe('50,000');
    expect(address?.transactionCount?.display).toBe('87');
  });

  it('keeps a zero pending balance as zero rather than dropping it', () => {
    expect(readAddress(payload, DOGE)?.unconfirmedBalance?.display).toBe('0');
  });

  it('carries the paging so the rest of a long history is reachable', () => {
    expect(readAddress(payload, DOGE)?.paging).toEqual({
      page: 1, totalPages: 2, previousPage: null, nextPage: 2,
    });
  });

  it('reads unspent outputs into routable parts', () => {
    const [utxo] = readAddress(payload, DOGE)?.utxos ?? [];
    expect(utxo.txid).toBe(TXID);
    expect(utxo.vout).toBe('0');
    expect(utxo.amount?.display).toBe('12,345');
  });
});

describe('readOutpoint', () => {
  it('reads the output and its spent state', () => {
    const out = readOutpoint(
      {
        chain: 'dogecoin',
        network: 'mainnet',
        outpoint: { txid: TXID, voutAtomic: '2' },
        output: { valueAtomic: '500000000', address: 'DH5y', spent: false },
      },
      DOGE
    );
    expect(out?.vout).toBe('2');
    expect(out?.amount?.display).toBe('5');
    expect(out?.spent).toBe(false);
  });

  it('leaves the spent state unknown when the authority did not state it', () => {
    const out = readOutpoint(
      { chain: 'dogecoin', outpoint: { txid: TXID, voutAtomic: '0' }, output: { valueAtomic: '1' } },
      DOGE
    );
    expect(out?.spent).toBeNull();
  });
});

describe('readCollection', () => {
  it('takes columns from the union of the rows, so a sparse row leaves a gap', () => {
    const collection = readCollection(
      { items: [{ tick: 'ABC', supplyAtomic: '100' }, { tick: 'DEF', holdersAtomic: '4' }] },
      DOGE
    );
    expect(collection?.columns.map((c) => c.key)).toEqual(['tick', 'supplyAtomic', 'holdersAtomic']);
    expect(collection?.rows[1][1].fact?.kind).toBe('absent');
  });

  it('names the field the rows came from', () => {
    const collection = readCollection({ holders: [{ address: 'DH5y' }] }, DOGE);
    expect(collection?.sourceKey).toBe('holders');
    expect(collection?.title).toBe('Holders');
  });

  it('picks the longest array when a payload carries several', () => {
    const collection = readCollection({ txids: ['a'], events: [{ x: '1' }, { y: '2' }] }, DOGE);
    expect(collection?.sourceKey).toBe('events');
  });

  it('reports how many rows it is holding back', () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ n: String(index) }));
    const collection = readCollection({ items: rows }, DOGE);
    expect(collection?.shownCount).toBe(100);
    expect(collection?.totalCount).toBe(120);
  });

  it('wraps a list of plain values so it still has a column', () => {
    const collection = readCollection({ items: ['one', 'two'] }, DOGE);
    expect(collection?.columns.map((c) => c.key)).toEqual(['value']);
  });

  it('routes the identifiers the explorer has a page for', () => {
    const collection = readCollection(
      { transactions: [{ txid: TXID, address: 'DH5y', note: 'x' }] },
      DOGE
    );
    const byKey = Object.fromEntries(
      (collection?.rows[0] ?? []).map((cell) => [cell.key, cell.fact])
    );
    expect(byKey.txid?.link).toEqual(['/', 'dogecoin', 'tx', TXID]);
    expect(byKey.address?.link).toEqual(['/', 'dogecoin', 'address', 'DH5y']);
    expect(byKey.note?.link).toBeNull();
  });

  it('names a coin amount column unit once, in the header', () => {
    const collection = readCollection({ items: [{ feeAtomic: '1', sizeBytesAtomic: '2' }] }, DOGE);
    const byKey = Object.fromEntries((collection?.columns ?? []).map((c) => [c.key, c]));
    expect(byKey.feeAtomic.unit).toBe('DOGE');
    expect(byKey.sizeBytesAtomic.unit).toBeNull();
  });

  it('names the structured fields a table cannot hold, rather than dropping them', () => {
    // The live ZRC-20 list carries rulesets and divergence on every row. They
    // were skipped in silence while hiddenColumnCount reported zero, so the
    // page claimed it had held nothing back while holding back the ledger.
    const collection = readCollection(
      {
        items: [
          { tick: 'ZERO', decimals: '18', rulesets: { zord: { holders: '2330' } }, divergence: { diverges: true } },
          { tick: 'ONE', decimals: '18', rulesets: { zord: { holders: '11' } }, divergence: { diverges: false } },
        ],
      },
      DOGE
    );
    expect(collection?.structuredFields).toEqual(['rulesets', 'divergence']);
    expect(collection?.columns.map((c) => c.key)).toEqual(['tick']);
  });

  it('reports no structured fields when every value is a scalar', () => {
    expect(readCollection({ items: [{ a: '1' }, { a: '2' }] }, DOGE)?.structuredFields).toEqual([]);
  });

  it('says how many fields per row the table left out', () => {
    const wide = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6', g: '7', h: '8', i: '9' };
    const collection = readCollection({ items: [wide] }, DOGE);
    expect(collection?.columns).toHaveLength(7);
    expect(collection?.hiddenColumnCount).toBe(2);
  });

  it('holds nothing back when every field fits', () => {
    expect(readCollection({ items: [{ a: '1', b: '2' }] }, DOGE)?.hiddenColumnCount).toBe(0);
  });

  it('returns nothing when there is no array to read', () => {
    expect(readCollection({ state: 'unavailable' }, DOGE)).toBeNull();
  });
});

describe('readEmptyList', () => {
  it('calls a complete empty list none, and an incomplete one not established', () => {
    // The live Zcash pending set is empty and complete, which is a proven none.
    expect(
      readEmptyList({ snapshot: { completeness: 'complete' }, transactions: [] })
    ).toEqual({ field: 'transactions', label: 'Transactions', proven: true });

    expect(
      readEmptyList({ snapshot: { completeness: 'partial' }, transactions: [] })?.proven
    ).toBe(false);

    // No completeness stated at all is not a proven none either.
    expect(readEmptyList({ transactions: [] })?.proven).toBe(false);
  });

  it('reads a top-level completeness as well as a nested one', () => {
    expect(readEmptyList({ completeness: 'complete', items: [] })?.proven).toBe(true);
  });

  it('says nothing when there is a list to show instead', () => {
    expect(readEmptyList({ transactions: [{ txid: 'a' }] })).toBeNull();
    expect(readEmptyList({ txids: [], transactions: [{ txid: 'a' }] })).toBeNull();
  });

  it('says nothing when the payload has no list at all', () => {
    expect(readEmptyList({ state: 'unavailable' })).toBeNull();
    expect(readEmptyList(null)).toBeNull();
  });
});

describe('readRecordFacts', () => {
  it('classifies amounts, counts, identifiers, flags and absences apart', () => {
    const facts = readRecordFacts(
      {
        balanceAtomic: '100000000',
        transactionCountAtomic: '12',
        blockHash: BLOCK_HASH,
        coinbase: true,
        note: null,
      },
      DOGE
    );
    const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact]));
    expect(byKey.balanceAtomic.kind).toBe('amount');
    expect(byKey.balanceAtomic.unit).toBe('DOGE');
    expect(byKey.transactionCountAtomic.kind).toBe('count');
    expect(byKey.blockHash.kind).toBe('identifier');
    expect(byKey.coinbase.kind).toBe('flag');
    expect(byKey.note.kind).toBe('absent');
  });

  it('skips fields a purpose-built reading already presented', () => {
    const keys = readRecordFacts({ chain: 'dogecoin', state: 'ready' }, DOGE, ['chain']).map((f) => f.key);
    expect(keys).toEqual(['state']);
  });

  it('flattens one level of nesting so a nested scalar is not dropped', () => {
    const facts = readRecordFacts({ status: { state: 'ready', lagBlocksAtomic: '3' } }, DOGE);
    expect(facts.map((fact) => fact.label)).toEqual(['Status state', 'Status lag blocks']);
  });

  it('does not repeat a parent the child already names', () => {
    // The live pending response nests snapshotId inside snapshot, which read
    // as "Snapshot snapshot ID".
    const facts = readRecordFacts(
      { snapshot: { snapshotId: 'snap-4812', sequenceAtomic: '148201' } },
      DOGE
    );
    expect(facts.map((fact) => fact.label)).toEqual(['Snapshot ID', 'Snapshot sequence']);
  });

  it('drops a nested chain and network, which only repeat the heading', () => {
    const facts = readRecordFacts(
      { snapshot: { chain: 'dogecoin', network: 'mainnet', completeness: 'complete' } },
      DOGE
    );
    expect(facts.map((fact) => fact.key)).toEqual(['snapshot completeness']);
  });

  it('shifts only the fields that carry the chain own coin', () => {
    // A DRC-20 supply is denominated in the token's units. Shifting it by the
    // chain precision printed 100000000000 as 1,000 DOGE, which is not a
    // formatting choice, it is a different number.
    const facts = readRecordFacts(
      { supplyAtomic: '100000000000', balanceAtomic: '100000000000' },
      DOGE
    );
    const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact]));
    expect(byKey.supplyAtomic.kind).toBe('count');
    expect(byKey.supplyAtomic.display).toBe('100,000,000,000');
    expect(byKey.supplyAtomic.unit).toBeNull();
    expect(byKey.balanceAtomic.kind).toBe('amount');
    expect(byKey.balanceAtomic.display).toBe('1,000');
  });

  it('never drops a zero by treating it as absent', () => {
    const [fact] = readRecordFacts({ balanceAtomic: '0' }, DOGE);
    expect(fact.kind).toBe('amount');
    expect(fact.display).toBe('0');
  });
});

describe('the chain reading on the status rail', () => {
  it('does not report a chain as ready when the chain says it is not', () => {
    // The node can be caught up while a protocol indexer this chain needs is
    // not answering. That publishes sync.state ready and ready false, and the
    // rail used to read the sync state alone: Ready, in the proven tone, on
    // the reading a visitor trusts most, for a chain that had just said no.
    const rail = readStatusRail(
      capability({ ready: false, degradedReasons: ['protocol-history-unavailable'] }),
      DOGE,
      Date.parse('2026-08-29T05:00:10.000Z')
    );
    const state = rail.find((reading) => reading.id === 'state');
    expect(state?.value).toBe('Degraded');
    expect(state?.tone).toBe('partial');
  });

  it('keeps the worse reading when the node itself is the problem', () => {
    const rail = readStatusRail(
      capability({ ready: false, sync: { state: 'unavailable', initialBlockDownload: false, progressDecimal: null, updatedAt: null } }),
      DOGE,
      Date.parse('2026-08-29T05:00:10.000Z')
    );
    expect(rail.find((reading) => reading.id === 'state')?.value).toBe('Unavailable');
  });

  it('still reads ready when the chain says so', () => {
    const rail = readStatusRail(capability(), DOGE, Date.parse('2026-08-29T05:00:10.000Z'));
    const state = rail.find((reading) => reading.id === 'state');
    expect(state?.value).toBe('Ready');
    expect(state?.tone).toBe('proven');
  });
});

describe('readNotReadyReasons', () => {
  it('says nothing about a ready chain', () => {
    expect(readNotReadyReasons(capability())).toBeNull();
    expect(readNotReadyReasons(null)).toBeNull();
  });

  it('reads the reasons the chain gave', () => {
    const reasons = readNotReadyReasons(
      capability({ ready: false, degradedReasons: ['base-chain-authority-unavailable', 'protocol-history-unavailable'] })
    );
    expect(reasons).toHaveLength(2);
    expect(reasons?.[0].text).toContain('did not answer');
  });

  it('says a chain withheld readiness without explaining, rather than showing nothing', () => {
    const reasons = readNotReadyReasons(capability({ ready: false, degradedReasons: [] }));
    expect(reasons).toHaveLength(1);
    expect(reasons?.[0].text).toContain('states no reason');
  });
});

describe('readProtocolCoverage reasons', () => {
  it('hands the page sentences rather than wire codes', () => {
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'drc20', state: 'unavailable', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: ['authority-capability-disabled'] },
        ],
      }),
      DOGE
    );
    const drc20 = readings.find((reading) => reading.protocolId === 'drc20');
    expect(drc20?.reasons.map((reason) => reason.code)).toEqual(['authority-capability-disabled']);
    expect(drc20?.reasons[0].text).not.toContain('-disabled');
  });
});

describe('per-outpoint asset readings', () => {
  const duneTx = (): ChainExplorerPayload => ({
    schemaVersion: 'universe-transaction-v1',
    txid: TXID,
    status: 'confirmed',
    transparent: {
      inputs: [
        {
          indexAtomic: '0',
          previousOutpoint: `${'c'.repeat(64)}:1`,
          address: 'D8input',
          valueAtomic: '100000000',
          coinbase: false,
          assets: { positions: [], coverage: 'out-of-coverage', coveredProtocolIds: [] },
        },
      ],
      outputs: [
        {
          indexAtomic: '0',
          address: 'D8output',
          valueAtomic: '100000',
          spent: false,
          assets: {
            positions: [
              {
                outpoint: `${TXID}:0`,
                vout: 0,
                valueSatsAtomic: '100000',
                asset: {
                  protocolId: 'dunes',
                  assetId: 'WOW SUCH DUNE',
                  displayName: 'WOW SUCH DUNE',
                  ticker: 'W',
                  assetKind: 'fungible',
                  decimals: 8,
                },
                quantityAtomic: '150000000',
                state: 'active',
              },
              {
                outpoint: `${TXID}:0`,
                vout: 0,
                valueSatsAtomic: '100000',
                asset: {
                  protocolId: 'doginals',
                  assetId: `${'d'.repeat(64)}i0`,
                  assetKind: 'inscription',
                },
                state: 'active',
              },
            ],
            coverage: 'complete',
            coveredProtocolIds: ['doginals', 'dunes'],
          },
        },
        {
          indexAtomic: '1',
          address: 'D8empty',
          valueAtomic: '5000',
          spent: false,
          assets: { positions: [], coverage: 'proven-empty', coveredProtocolIds: ['doginals', 'dunes'] },
        },
      ],
    },
    protocolActions: {
      candidates: [],
      confirmed: [
        {
          eventId: 'e1',
          protocolId: 'dunes',
          state: 'confirmed-accepted',
          actionType: 'etch',
          evidenceIds: [],
          asset: {
            protocolId: 'dunes',
            assetId: 'WOW SUCH DUNE',
            displayName: 'WOW SUCH DUNE',
            ticker: 'W',
            assetKind: 'fungible',
            decimals: 8,
          },
          quantityAtomic: '150000000',
          outputOutpoints: [`${TXID}:0`],
        },
      ],
    },
  });

  it('reads asset chips on outputs with quantities shifted by the asset decimals', () => {
    const reading = readTransaction(duneTx(), DOGE);
    const output = reading?.outputs[0];
    expect(output?.outpoint).toBe(`${TXID}:0`);
    const dune = output?.assets?.chips[0];
    expect(dune?.protocolLabel).toBe('Dunes');
    expect(dune?.name).toBe('WOW SUCH DUNE');
    // 150000000 shifted by the dune's own 8 decimals, not the chain's.
    expect(dune?.quantity?.display).toBe('1.5');
    expect(dune?.quantity?.exact).toBe('150000000');
    expect(dune?.link).toEqual(['/', 'dogecoin', 'protocols', 'dunes', 'WOW SUCH DUNE']);
    const doginal = output?.assets?.chips[1];
    expect(doginal?.protocolLabel).toBe('Doginals');
    // The asset id is the mandated fallback name, never a blank label.
    expect(doginal?.name).toBe(`${'d'.repeat(64)}i0`);
    expect(doginal?.quantity).toBeNull();
  });

  it('keeps proven emptiness and out-of-coverage distinguishable', () => {
    const reading = readTransaction(duneTx(), DOGE);
    const empty = reading?.outputs[1].assets;
    expect(empty?.provenEmpty).toBe(true);
    expect(empty?.coverageLabel).toBeNull();
    const input = reading?.inputs[0].assets;
    expect(input?.provenEmpty).toBe(false);
    expect(input?.coverageLabel).not.toBeNull();
    expect(input?.coverageTone).toBe('neutral');
  });

  it('carries asset identity, exact quantity and outpoints on actions', () => {
    const reading = readTransaction(duneTx(), DOGE);
    const action = reading?.confirmedActions[0];
    expect(action?.assetName).toBe('WOW SUCH DUNE');
    expect(action?.assetTicker).toBe('W');
    expect(action?.quantity?.display).toBe('1.5');
    expect(action?.quantity?.exact).toBe('150000000');
    expect(action?.outputOutpoints).toEqual([`${TXID}:0`]);
    expect(action?.assetLink).toEqual(['/', 'dogecoin', 'protocols', 'dunes', 'WOW SUCH DUNE']);
  });

  it('reads actions without assets exactly as before', () => {
    const payload = duneTx();
    (payload.protocolActions as Record<string, unknown>).confirmed = [
      { eventId: 'e2', protocolId: 'drc20', state: 'confirmed-rejected', actionType: 'transfer', evidenceIds: [] },
    ];
    const action = readTransaction(payload, DOGE)?.confirmedActions[0];
    expect(action?.assetName).toBeNull();
    expect(action?.quantity).toBeNull();
    expect(action?.inputOutpoints).toEqual([]);
  });
});

describe('readAddressHoldings', () => {
  const view = (overrides: Record<string, unknown> = {}): ChainExplorerPayload => ({
    schemaVersion: 'universe-address-holdings-v1',
    chain: 'zcash',
    network: 'mainnet',
    address: 't1Example',
    utxos: [
      {
        outpoint: `${TXID}:0`,
        txid: TXID,
        vout: 0,
        valueAtomic: '250000000',
        assets: {
          positions: [
            {
              outpoint: `${TXID}:0`,
              vout: 0,
              valueSatsAtomic: '250000000',
              asset: {
                protocolId: 'zrunes',
                assetId: '10:1',
                displayName: 'ZRUNE ONE',
                ticker: 'Z',
                assetKind: 'fungible',
                decimals: 2,
              },
              quantityAtomic: '12345',
              state: 'active',
            },
          ],
          coverage: 'complete',
          coveredProtocolIds: ['zerdinals', 'zrunes'],
        },
      },
    ],
    addressLevelBalances: [
      {
        asset: {
          protocolId: 'zrc20',
          assetId: 'zord:zero',
          ticker: 'ZERO',
          assetKind: 'fungible',
          decimals: 8,
        },
        quantityAtomic: '900000000',
        availableAtomic: '400000000',
        transferableAtomic: '500000000',
        decimals: 8,
        semantics: 'zrc20-zord-ledger',
      },
    ],
    aggregateHoldings: [
      {
        asset: {
          protocolId: 'zrunes',
          assetId: '10:1',
          displayName: 'ZRUNE ONE',
          ticker: 'Z',
          assetKind: 'fungible',
          decimals: 2,
        },
        quantityAtomic: '12345',
        utxoCountAtomic: '1',
        source: 'utxo-bound',
      },
    ],
    paging: {
      limitAtomic: '50',
      offsetAtomic: '0',
      returnedAtomic: '1',
      totalUtxoCountAtomic: '1',
      hasMore: false,
    },
    checkpoint: { chain: 'zcash', network: 'mainnet', heightAtomic: '3131000', blockHash: BLOCK_HASH, reorgEpoch: '0', observedAt: '2026-08-30T00:00:00.000Z' },
    sourceEvidence: [],
    complete: true,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
    ...overrides,
  });

  it('reads the complete holdings view exactly', () => {
    const reading = readAddressHoldings(view(), ZEC);
    expect(reading?.address).toBe('t1Example');
    expect(reading?.utxos[0].outpoint).toBe(`${TXID}:0`);
    expect(reading?.utxos[0].amount?.display).toBe('2.5');
    expect(reading?.utxos[0].assets?.chips[0].quantity?.display).toBe('123.45');
    expect(reading?.aggregates[0].quantity?.exact).toBe('12345');
    expect(reading?.aggregates[0].utxoCount?.display).toBe('1');
    expect(reading?.addressLevel[0].quantity?.display).toBe('9');
    expect(reading?.addressLevel[0].available?.display).toBe('4');
    expect(reading?.addressLevel[0].transferable?.display).toBe('5');
    expect(reading?.complete).toBe(true);
    expect(reading?.completenessNote).toBeNull();
    expect(reading?.privacyNotice).toBeNull();
    expect(reading?.checkpointHeight?.exact).toBe('3131000');
  });

  it('never renders a partial reading as complete', () => {
    const reading = readAddressHoldings(
      view({ complete: false, unknownAttachmentCount: 2 }),
      ZEC
    );
    expect(reading?.complete).toBe(false);
    expect(reading?.completenessNote).not.toBeNull();
  });

  it('passes the privacy boundary through verbatim instead of a fabricated empty account', () => {
    const reading = readAddressHoldings(
      view({
        utxos: [],
        aggregateHoldings: [],
        addressLevelBalances: [],
        privacy: { publiclyObservable: false, notice: 'Shielded activity is not publicly observable.' },
      }),
      ZEC
    );
    expect(reading?.privacyNotice).toBe('Shielded activity is not publicly observable.');
    expect(reading?.utxos).toEqual([]);
    expect(reading?.completenessNote).toBeNull();
  });

  it('refuses payloads that are not the holdings contract', () => {
    expect(readAddressHoldings({ schemaVersion: 'other', address: 'x' }, ZEC)).toBeNull();
    expect(readAddressHoldings(null, ZEC)).toBeNull();
  });

  it('never publishes a partial aggregate sum', () => {
    const reading = readAddressHoldings(
      view({
        aggregateHoldings: [
          {
            asset: { protocolId: 'zrunes', assetId: '10:1', assetKind: 'fungible' },
            quantityAtomic: null,
            utxoCountAtomic: '2',
            source: 'utxo-bound',
          },
        ],
      }),
      ZEC
    );
    expect(reading?.aggregates[0].quantity).toBeNull();
    expect(reading?.aggregates[0].utxoCount?.exact).toBe('2');
  });
});
