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
  readOutpoint,
  readPaging,
  readProtocolCoverage,
  readRecordFacts,
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

describe('readCapabilities', () => {
  it('lists every read, marking the ones the chain does not offer', () => {
    const reads = readCapabilities(capability());
    expect(reads.map((r) => r.id)).toEqual([
      'transaction', 'block', 'address', 'outpoint', 'feeEstimates', 'projectedBlocks',
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
    expect(readings.map((r) => r.routeId)).toEqual(['doginals', 'drc20', 'doge-tap']);
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
    expect(readings).toHaveLength(3);
    const tap = readings.find((r) => r.routeId === 'doge-tap');
    expect(tap?.tone).toBe('partial');
    expect(tap?.label).toBe('TAP on Doge');
    expect(readings.filter((r) => r.label === 'TAP on Doge')).toHaveLength(1);
  });

  it('lists a protocol it has no page for, and offers no route to it', () => {
    // /dogecoin/protocols/dunes answers 404 and the API service throws before
    // it asks, so a link there is a dead end. Hiding it would be a claim the
    // chain did not make.
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'dunes', state: 'unavailable', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: [] },
        ],
      }),
      DOGE
    );
    const dunes = readings.find((r) => r.protocolId === 'dunes');
    expect(dunes).toBeDefined();
    expect(dunes?.routeId).toBeNull();
    expect(dunes?.label).toBe('Dunes');
  });

  it('carries the state, coverage and lag the overlay reported', () => {
    const readings = readProtocolCoverage(
      capability({
        protocols: [
          { protocolId: 'drc20', state: 'degraded', coverage: 'partial', updatedAt: null, lagBlocksAtomic: '17', degradedReasons: ['authority behind tip'] },
        ],
      }),
      DOGE
    );
    const drc20 = readings.find((r) => r.protocolId === 'drc20');
    expect(drc20?.tone).toBe('partial');
    expect(drc20?.lag?.display).toBe('17');
    expect(drc20?.reasons).toEqual(['authority behind tip']);
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
    fee: { amountAtomic: '15000', rateDecimal: null, rateUnit: null, logicalActionsAtomic: '2' },
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
