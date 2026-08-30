// Deterministic fixtures for the Dogecoin and Zcash explorer pages.
//
// These pages shipped with no visual coverage at all: the matrix knew about
// thirteen Bitcoin routes and nothing else, so eleven chain routes reached
// production without a single screenshot, contrast probe or unfinished-page
// check ever looking at them.
//
// They live in their own file rather than in fixtures.mjs because they answer
// a different API surface (the chain-domain routes the overlay owns) and
// because the states worth pinning here are different: a chain behind its own
// tip, an authority that is degraded rather than down, and a Zcash transaction
// whose shielded side cannot be read at all. Those three are the states the
// interface has to be honest about, and none of them exist on the Bitcoin
// routes.

const DOGE_TXID = '4c8f0b2e6a1d5937c0f4b8e2a6d0c4f8b2e6a0d4c8f2b6e0a4d8c2f6b0e4a8d2';
const DOGE_BLOCK = 'e1b5f9d3a7c2064e8b1d5f9a3c7e0246b8d2f6a0c4e8b2d6f0a4c8e2b6d0f4a8';
const DOGE_ADDRESS = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L';
const ZEC_TXID = '7a3e1c5f9b2d6048a2c6e0f4b8d2a6c0e4f8b2d6a0c4e8f2b6d0a4c8e2f6b0d4';
const ZEC_ADDRESS = 't1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv';
const ZEC_BLOCK = '00000000004db04aba335b14021f8dd4fa02a0a954edad7da547c3a4fd917141';
const ZEC_ZRC20 = 'ZERO';
const DOGE_DUNE_ID = '5084000:1';

/**
 * A chain capability envelope. Dogecoin is at its tip and complete; Zcash is
 * behind and partial, which is the honest state a reader has to be able to
 * tell apart from a chain that is simply down.
 */
function capability(chain, overrides = {}) {
  const asset = chain === 'dogecoin'
    ? { symbol: 'DOGE', name: 'Dogecoin', precision: 8, atomicUnit: 'koinu' }
    : { symbol: 'ZEC', name: 'Zcash', precision: 8, atomicUnit: 'zatoshi' };
  const observedAt = new Date(Date.now() - 20_000).toISOString();
  return {
    schemaVersion: 'universe-chain-capability-v1',
    chain,
    network: 'mainnet',
    asset,
    ready: true,
    tip: {
      // The real Zcash tip on 2026-08-29, twelve blocks above the height the
      // status fixture reports as behind. It used to sit below the height of
      // the Zcash block the same run renders, which is a page contradicting
      // itself, and it read that way for as long as the two numbers were
      // chosen separately.
      heightAtomic: chain === 'dogecoin' ? '5623041' : '3464729',
      blockHash: chain === 'dogecoin' ? DOGE_BLOCK : 'f'.repeat(64),
      observedAt,
    },
    sync: { state: 'ready', initialBlockDownload: false, progressDecimal: '1', updatedAt: observedAt },
    mempool: {
      supported: true,
      state: 'ready',
      completeness: 'complete',
      snapshotId: 'snap-4812',
      sequenceAtomic: '148201',
      observedAt,
    },
    // What each chain declared on 2026-08-29, read from the live capability
    // document rather than assumed. Zcash was marked here as unable to answer
    // a block lookup while production answered one, so the overview said the
    // page was not offered and nothing ever rendered the page that was.
    reads: {
      transaction: true,
      block: true,
      address: true,
      outpoint: true,
      feeEstimates: true,
      projectedBlocks: false,
    },
    protocols: chain === 'dogecoin'
      ? [
          { protocolId: 'doginals', state: 'ready', coverage: 'complete', updatedAt: observedAt, lagBlocksAtomic: '0', degradedReasons: [] },
          { protocolId: 'drc20', state: 'ready', coverage: 'complete', updatedAt: observedAt, lagBlocksAtomic: '0', degradedReasons: [] },
          // `tap_doge`, not `doge-tap`: the capability envelope and the route
          // are different namespaces, and a fixture written in the route's
          // spelling cannot see a reader that only knows one of them.
          { protocolId: 'tap_doge', state: 'degraded', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '184', degradedReasons: ['protocol-authority-stale'] },
        ]
      : [
          { protocolId: 'zerdinals', state: 'ready', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: [] },
          { protocolId: 'zrunes', state: 'ready', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: [] },
          { protocolId: 'zrc20', state: 'degraded', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: ['protocol-history-partial'] },
        ],
    coverage: {
      confirmedHistory: chain === 'dogecoin' ? 'complete' : 'partial',
      addressHistory: chain === 'dogecoin' ? 'complete' : 'partial',
      protocolHistory: 'partial',
    },
    updatedAt: observedAt,
    lagBlocksAtomic: chain === 'dogecoin' ? '0' : '12',
    degradedReasons: [],
    release: { sha: 'a1b2c3d' },
    ...overrides,
  };
}

/** A confirmed Dogecoin transaction: two inputs, a payment and a change output. */
function dogecoinTransaction() {
  return {
    schemaVersion: 'universe-transaction-v1',
    chain: 'dogecoin',
    network: 'mainnet',
    txid: DOGE_TXID,
    status: 'confirmed',
    firstSeenAt: '2026-08-29T03:58:12.000Z',
    observedAt: '2026-08-29T04:02:00.000Z',
    confirmedAt: '2026-08-29T04:02:00.000Z',
    removedAt: null,
    block: { hash: DOGE_BLOCK, heightAtomic: '5623038', time: '2026-08-29T04:02:00.000Z' },
    confirmationsAtomic: '3',
    sizeBytesAtomic: '486',
    fee: { amountAtomic: '113400000', rateDecimal: '2.33', rateUnit: 'DOGE/kB', model: 'per-kilobyte' },
    conflicts: [],
    replacement: null,
    expiry: null,
    transparent: {
      inputs: [
        { indexAtomic: '0', previousOutpoint: `${DOGE_TXID}:1`, address: DOGE_ADDRESS, valueAtomic: '480000000000', coinbase: false },
        { indexAtomic: '1', previousOutpoint: `${DOGE_TXID}:0`, address: 'DKuVPFPZUwMcNCU9hYzB4Mp3cRVJPuZLyq', valueAtomic: '120000000000', coinbase: false },
      ],
      outputs: [
        { indexAtomic: '0', address: 'DPMFn6Yv9GsuTPZWCbTFmZ9UWjjjjcYfWr', valueAtomic: '525000000000', spent: false },
        { indexAtomic: '1', address: DOGE_ADDRESS, valueAtomic: '74886600000', spent: true },
      ],
    },
    shielded: null,
    protocolActions: {
      candidates: [],
      confirmed: [
        { eventId: 'doginals:1', protocolId: 'doginals', state: 'confirmed-accepted', actionType: 'inscribe', evidenceIds: ['ord-dogecoin:5623038'] },
        { eventId: 'drc20:1', protocolId: 'drc20', state: 'confirmed-rejected', actionType: 'mintOverCap', evidenceIds: ['ord-dogecoin:5623038'] },
      ],
    },
    evidenceIds: ['dogecoin-blockbook:transaction'],
    completeness: 'complete',
  };
}

/**
 * A Zcash transaction with both a transparent and a shielded side, still in
 * the pending set. It is the one fixture that proves the page reports shielded
 * structure without reporting shielded participants.
 */
function zcashTransaction() {
  return {
    schemaVersion: 'universe-transaction-v1',
    chain: 'zcash',
    network: 'mainnet',
    txid: ZEC_TXID,
    status: 'observed',
    firstSeenAt: '2026-08-29T05:01:44.000Z',
    observedAt: '2026-08-29T05:02:10.000Z',
    confirmedAt: null,
    removedAt: null,
    block: null,
    confirmationsAtomic: '0',
    sizeBytesAtomic: '2104',
    // Exactly what production sends for a pending shielded transaction: no fee
    // amount at all, because it cannot be read from the transparent side, and
    // the ZIP-317 cost instead.
    fee: {
      amountAtomic: null,
      rateDecimal: null,
      rateUnit: 'zatoshi/logical-action',
      logicalActionsAtomic: '4',
      model: 'ZIP-317-revision-1',
    },
    conflicts: [],
    replacement: null,
    expiry: { heightAtomic: '2884160', state: 'pending' },
    transparent: {
      inputs: [
        { indexAtomic: '0', previousOutpoint: `${ZEC_TXID}:0`, address: 't1WhKz4uNbLBmYMsJvUeAqDPxKfR2nGdTca', valueAtomic: '250000000', coinbase: false },
      ],
      outputs: [
        { indexAtomic: '0', address: 't1QjR7bYpNvA3kHsWmEzXuF9dLcT6gVbKrn', valueAtomic: '99980000', spent: null },
      ],
    },
    shielded: {
      sproutJoinSplitsAtomic: '0',
      saplingSpendsAtomic: '0',
      saplingOutputsAtomic: '0',
      orchardActionsAtomic: '4',
      ironwoodActionsAtomic: '0',
      valueBalanceAtomic: '-150000000',
      privacyNotice:
        'Orchard actions hide their sender, recipient and amount. This explorer reports how many there are and nothing else about them.',
    },
    protocolActions: {
      candidates: [
        { eventId: 'zerdinals:c1', protocolId: 'zerdinals', state: 'candidate', actionType: 'inscribe', evidenceIds: [] },
      ],
      confirmed: [],
    },
    evidenceIds: ['zcash-indexer:mempool'],
    completeness: 'partial',
  };
}

/** One pending Dogecoin transaction, in the envelope shape the live API sends. */
function pendingDogecoinTransaction(txid, feeAtomic, sizeBytes, firstSeenAt) {
  const confirmed = dogecoinTransaction();
  return {
    ...confirmed,
    txid,
    status: 'pending',
    firstSeenAt,
    confirmedAt: null,
    block: null,
    confirmationsAtomic: '0',
    sizeBytesAtomic: sizeBytes,
    fee: { amountAtomic: feeAtomic, rateDecimal: null, rateUnit: null },
    protocolActions: { candidates: [], confirmed: [] },
    completeness: 'partial',
  };
}

/**
 * A ZRC-20 token as the live authority reports one: the whole ledger twice,
 * once under each ruleset, and a divergence summary naming where the two
 * disagree. The shape follows /api/v1/zcash/protocols/zrc20/ZERO as captured
 * on 2026-08-30; the figures are fixture values.
 */
function zrc20Token(tick, overrides = {}) {
  const ledger = {
    max_supply: '21000000000000000000000000',
    mint_limit: '1000000000000000000000',
    minted: '21000000000000000000000000',
    burned: '0',
    shielded: '6000000000000000000000',
    circulating: '20994000000000000000000000',
    mint_count: '21120',
    holders: '2330',
    mint_progress: { minted: '21000000000000000000000000', max_supply: '21000000000000000000000000' },
    status: 'minted',
  };
  return {
    tick,
    tick_key: Buffer.from(tick.toLowerCase()).toString('hex'),
    decimals: '18',
    deploy_inscription_id: `${ZEC_TXID}i0`,
    deploy_txid: ZEC_TXID,
    deploy_height: '3133112',
    deployer_address: ZEC_ADDRESS,
    rulesets: {
      zord: { ...ledger },
      zecscriptions: { ...ledger },
    },
    divergence: { diverges: false, fields: [], absent_from: [], unevaluated: [] },
    ...overrides,
  };
}

/** The token whose readings disagree, which is what the pages exist to show. */
function zrc20DivergingToken() {
  const token = zrc20Token(ZEC_ZRC20);
  token.rulesets.zecscriptions = {
    ...token.rulesets.zecscriptions,
    mint_count: '21000',
    holders: '2539',
  };
  token.divergence = {
    diverges: true,
    fields: ['mint_count', 'holders'],
    absent_from: [],
    unevaluated: [
      {
        id: 'zecscriptions-protocol-v2-reveal-outputs',
        summary: 'zecscriptions protocol version 2 requires three reveal outputs: the minter at vout 0, a deployer share of 19200 zatoshis at vout 1, and a platform share of 172800 zatoshis at vout 2.',
        reason: 'No activation height for protocol version 2 is recorded in the compatibility matrix, so applying the rule would require inventing one. Neither ruleset evaluates it.',
      },
      {
        id: 'shielded-settlement-accounting',
        summary: 'A settlement spend into a fully shielded transaction is a permanent burn in zord accounting.',
        reason: 'Reported as its own bucket rather than as a ruleset switch. Shielded and burned totals are published separately so either accounting can be derived exactly.',
      },
    ],
  };
  return token;
}

function zrc20Envelope(body) {
  return {
    schemaVersion: 'zcash-metaprotocols-api-v1',
    chain: 'zcash',
    network: 'mainnet',
    checkpoint: { height: '3465589', hash: ZEC_BLOCK },
    coverage: {
      scannedHeight: 3465589,
      networkHeight: 3465590,
      blocksBehindNetwork: 1,
      nodeSynced: true,
      verificationProgress: 1,
      chainComplete: true,
    },
    lens: 'zord',
    rulesets: ['zord', 'zecscriptions'],
    ...body,
  };
}

/**
 * One dune as the authority contract reports it. The digits are chosen so a
 * wrong shift is visible: divisibility 8, supply one hundred million.
 */
function dogeDune(dune, duneId, overrides = {}) {
  return {
    dune,
    duneId,
    numberAtomic: '1',
    symbol: 'D',
    divisibilityAtomic: '8',
    etchingTxid: DOGE_TXID,
    supplyAtomic: '10000000000000000',
    premineAtomic: '100000000',
    mintsAtomic: '21000',
    burnedAtomic: '0',
    etchedHeightAtomic: '5084000',
    etchedTimestampAtomic: '1700000000',
    mintable: true,
    ...overrides,
  };
}

function dogeDuneEnvelope(body) {
  return {
    chain: 'dogecoin',
    network: 'mainnet',
    blockCountAtomic: '5900001',
    blockHash: DOGE_BLOCK,
    inventoryComplete: true,
    ...body,
  };
}

export const chainFixtures = {
  '/api/v1/chains': [capability('bitcoin'), capability('dogecoin'), capability('zcash')],

  '/api/v1/dogecoin/status': capability('dogecoin'),
  '/api/v1/zcash/status': capability('zcash'),

  [`/api/v1/dogecoin/tx/${DOGE_TXID}`]: dogecoinTransaction(),
  [`/api/v1/zcash/tx/${ZEC_TXID}`]: zcashTransaction(),

  [`/api/v1/dogecoin/block/${DOGE_BLOCK}`]: {
    chain: 'dogecoin',
    network: 'mainnet',
    block: {
      hash: DOGE_BLOCK,
      heightAtomic: '5623038',
      confirmationsAtomic: '3',
      sizeBytesAtomic: '41882',
      time: '2026-08-29T04:02:00.000Z',
      previousBlockHash: '9c3e7a1b5d9f2064c8e2a6d0f4b8c2e6a0d4f8b2c6e0a4d8f2b6c0e4a8d2f6b0',
      nextBlockHash: null,
      merkleRoot: '2f6b0d4a8c2e6f0b4d8a2c6e0f4b8d2a6c0e4f8b2d6a0c4e8f2b6d0a4c8e2f6b',
      versionAtomic: '6422788',
      nonce: '0',
      bits: '1a0f2b8c',
      difficulty: '52418844.4218',
      transactionCountAtomic: '112',
    },
    pagination: { pageAtomic: '1', totalPagesAtomic: '3', itemsOnPageAtomic: '50' },
    txids: [DOGE_TXID],
  },

  [`/api/v1/dogecoin/address/${DOGE_ADDRESS}`]: {
    chain: 'dogecoin',
    network: 'mainnet',
    address: DOGE_ADDRESS,
    balanceAtomic: '1284460000000',
    totalReceivedAtomic: '9930000000000',
    totalSentAtomic: '8645540000000',
    unconfirmedBalanceAtomic: '0',
    unconfirmedTransactionsAtomic: '0',
    transactionCountAtomic: '318',
    historicalTransactionCountAtomic: '318',
    pagination: { pageAtomic: '1', totalPagesAtomic: '7', itemsOnPageAtomic: '50' },
    txids: [DOGE_TXID],
    utxos: [
      { txid: DOGE_TXID, voutAtomic: '1', valueAtomic: '74886600000', heightAtomic: '5623038', confirmationsAtomic: '3', address: DOGE_ADDRESS, lockTimeAtomic: '0', coinbase: false },
      { txid: DOGE_BLOCK, voutAtomic: '0', valueAtomic: '1209573400000', heightAtomic: '5620112', confirmationsAtomic: '2929', address: DOGE_ADDRESS, lockTimeAtomic: '0', coinbase: false },
    ],
  },

  // A real Zcash block, exactly as production returned it. The transaction
  // list is kept whole: trimming it left the page saying page 1 of 1 over
  // four of the seventeen ids the same response counts, which is a false
  // claim of completeness in a screenshot. Zcash puts the block's
  // fields at the top level, in snake_case, with a unix time and an
  // offset-counted transaction list, and none of that is the Dogecoin shape
  // above. Written from a real response, because the page shipped as a field
  // dump on exactly this difference.
  //
  // This block carries one Zerdinal, so it also exercises the path that names
  // the lists the page has no reading for. A block with all of them empty
  // would have left that path unrendered by anything.
  [`/api/v1/zcash/block/${ZEC_BLOCK}`]: {
    "schemaVersion": "zcash-metaprotocols-api-v1",
    "network": "mainnet",
    "checkpoint": {
      "height": "3464740",
      "hash": "000000000027615ceabc9b72fe71165b65a726b7c8b6cdc49552bedeefe70033"
    },
    "coverage": {
      "scannedHeight": "3464740",
      "networkHeight": "3464742",
      "blocksBehindNetwork": "2",
      "nodeSynced": true,
      "verificationProgress": 0.9999994227564419,
      "chainComplete": true
    },
    "height": "3132356",
    "hash": "00000000004db04aba335b14021f8dd4fa02a0a954edad7da547c3a4fd917141",
    "prev_hash": "0000000000404690d08f1b4d51cbd29b629dcf69575477aebb0b8be1e684622c",
    "time": "1762955823",
    "tx_count": "17",
    "transactions": {
      "total": "17",
      "offset": "0",
      "limit": "50",
      "items": [
        "c7b1b83c597564f17d3a1e85569f15766e9ec41e8bcb98b80c16cabe8d906efa",
        "7af7c97b40057e4bd66a060b590a2974364757bac236aa954a311f0565c844ad",
        "c8629f9c0929e99d16e8848f62ec05f2fc6a8c0c6db8f90db242e89979600b05",
        "1c85153ef3707e601ff095167d54c4b7dd396c240647828524adbc1518a0fa2a",
        "385f7a1bfd45b9fc4a79ef110a3144086a51ec0755c92acb473184af2ea38fe7",
        "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7",
        "5380b950889eb9b9635cd4ae317b9222e78a773b7e96951df436f5a0163fa5e0",
        "056c95bdf6858cd66f7cad716695342a21df4c359b75606b3ba70216a9d7b82e",
        "ecee360011f2866c552e4c3fdb2d183d85fd68b05332d76959531a1791af2b6d",
        "220f8d2ddb34705808df739a4e08b2d88c0edcc9d012178ba7acb9ff62b49972",
        "8cf2bd26da6b319647e31ea2a2ac686ad2541d1af1716842cfacb8d9c61f3803",
        "e3215cff08b36d0dcfc118ff41b8cf18b51ba9b16554a164866e6f4ab1a0c53e",
        "a88f237bbc8a8035d94c0ebd559cd5b079eddc9f844f241e8c074290826d6f01",
        "a27482dcbda2bdb279fcea415bc5ba0cf6e776de5411e58fed32a4c3703dfbfc",
        "a73ad0cf234164acd70a2fa681dbb0efd2379f2d9ab305e292ff649a25515065",
        "1e8ecb2cd0a20057f838877706d8524ab488b9ac0dd5949ad8e0cc8c6b3444cf",
        "bd1b547d9c803caff668b8b2801714f0894560156a6923048c71be650416816a"
      ],
      "has_more": false
    },
    "inscription_count": "1",
    "inscriptions": [
      {
        "id": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7i0",
        "sequence": "1",
        "content_type": "text/plain",
        "content_length": "15",
        "content_hash": "cc24bb0eb02674e155c2fe8a9e5ee33291e3f3b244cc4f33851c3294acd9d814",
        "genesis_height": "3132356",
        "genesis_txid": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7",
        "completion_txid": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7",
        "completion_height": "3132356",
        "owner_address": "t1Yidqtcf4FeDzbZi4EBZkn84HyS9sypqWU",
        "outpoint": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7:0",
        "family": "zordinals-legacy",
        "state": "confirmed",
        "total_pieces": "1",
        "pieces_found": "1",
        "complete": true,
        "terminal_txid": null,
        "collection_slug": null
      }
    ],
    "envelopes": [
      {
        "txid": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7",
        "vin_index": "0",
        "family": "zordinals-legacy",
        "total_pieces": "1",
        "piece_count": "1",
        "malformed_reason": null
      }
    ],
    "events": [
      {
        "inscription_id": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7i0",
        "event": "inscribed",
        "txid": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7",
        "to_address": "t1Yidqtcf4FeDzbZi4EBZkn84HyS9sypqWU",
        "outpoint": "219cadf573630d346484043ab12c1199a78730036852870872eeee682f3496d7:0"
      }
    ],
    "zrune_events": [],
    "chain": "zcash"
  },

  // A Zcash address, as production returned it, with the unspent output list
  // and the history trimmed. The balance is nested and in snake_case, the
  // history counts from an offset, and an unspent output states its index as a
  // number. Read against the Dogecoin names this page showed an identifier, no
  // balance at all, and a table of unspent outputs with every amount blank.
  [`/api/v1/zcash/address/${ZEC_ADDRESS}`]: {
    "schemaVersion": "zcash-metaprotocols-api-v1",
    "network": "mainnet",
    "checkpoint": {
      "height": "3464734",
      "hash": "0000000000645e18fd55f18a5b2681f0becdc180d14d35a730875c4dc66add1a"
    },
    "coverage": {
      "scannedHeight": "3464734",
      "networkHeight": "3464734",
      "blocksBehindNetwork": "0",
      "nodeSynced": true,
      "verificationProgress": 0.9999997113775545,
      "chainComplete": true
    },
    "address": "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv",
    "address_type": "transparent",
    "publicly_observable": true,
    "balance": {
      "confirmed_zatoshis": "1251345400",
      "received_zatoshis": "920300177805"
    },
    "utxos": [
      {
        "txid": "e642bab049488871a307aff5a46be789b374858dfa7163e33ddff27c76e80438",
        "vout": 0,
        "valueZatoshis": "125522000",
        "scriptPubKey": "76a9145bbd8cad40c669b9ef2a5b7b2fbedbe9f74d7bea88ac"
      },
      {
        "txid": "44b60d006a4197f81385da1718eeddb5be23fdfdaa45553f0cae97766f2e150e",
        "vout": 0,
        "valueZatoshis": "125015000",
        "scriptPubKey": "76a9145bbd8cad40c669b9ef2a5b7b2fbedbe9f74d7bea88ac"
      },
      {
        "txid": "69fb0df1609d51da8f8526bf28fd7d92213461609811e3e119cc88623e93e5a5",
        "vout": 0,
        "valueZatoshis": "125176000",
        "scriptPubKey": "76a9145bbd8cad40c669b9ef2a5b7b2fbedbe9f74d7bea88ac"
      }
    ],
    "transactions": {
      "total": "8945",
      "offset": "0",
      "limit": "50",
      "items": [
        "73c47124313064d13e53b921857de4d57ac45e3e712b97233a2b38092f39ffbf",
        "8dc93dfbc11a54d0a71488e6ba5193216018ef289a3e2f4ea8f115bab03011f6",
        "983ac6acd606a66b0c948ce14455b0d35c5465100bba275a78c171dbf9a91ccc",
        "33ca5b4e93fde681a9b263b588398a2623b3198a8a89cf7815d773f235a80ffe"
      ],
      "has_more": true
    },
    "privacy_notice": "This page covers only publicly observable transparent activity and does not reveal shielded or Unified Address history.",
    "chain": "zcash"
  },

  // The pending lists carry whole transaction envelopes, one per entry, which
  // is what the live API returns. They were summary rows here until the real
  // payloads were read, and the difference matters: a list of envelopes is
  // rendered as transactions, a list of summary rows falls through to the
  // generic table, and only one of those is what production does.
  '/api/v1/dogecoin/mempool': {
    snapshot: {
      chain: 'dogecoin',
      network: 'mainnet',
      snapshotId: 'snap-4812',
      sequenceAtomic: '148201',
      observedAt: new Date(Date.now() - 9_000).toISOString(),
      completeness: 'complete',
    },
    transactions: [
      pendingDogecoinTransaction(DOGE_TXID, '113400000', '486', '2026-08-29T05:03:00.000Z'),
      pendingDogecoinTransaction(DOGE_BLOCK, '50000000', '225', '2026-08-29T05:03:41.000Z'),
    ],
  },

  // Zcash reports no fee amount on a pending transaction, because a shielded
  // transaction's fee cannot be read from its transparent side. It reports
  // ZIP-317 logical actions instead, and the page has to show that rather than
  // a column of "not reported".
  '/api/v1/zcash/mempool': {
    snapshot: {
      chain: 'zcash',
      network: 'mainnet',
      snapshotId: 'snap-2210',
      sequenceAtomic: '22104',
      observedAt: new Date(Date.now() - 14_000).toISOString(),
      completeness: 'partial',
    },
    transactions: [zcashTransaction()],
  },

  '/api/v1/dogecoin/protocols': {
    chain: 'dogecoin',
    network: 'mainnet',
    items: [
      { id: 'doginals', displayName: 'Doginals', family: 'inscriptions', releaseStatus: 'stable' },
      { id: 'drc20', displayName: 'DRC-20', family: 'tokens', releaseStatus: 'stable' },
      { id: 'doge-tap', displayName: 'Doge TAP', family: 'tokens', releaseStatus: 'beta' },
    ],
    confirmedHistory: { configured: true, state: 'ready', lastSuccessAt: '2026-08-29T05:03:00.000Z' },
    mempool: { configured: true, state: 'ready' },
    protocolAuthority: { configured: true, state: 'ready' },
    dogeTapAuthority: { configured: true, state: 'degraded' },
  },

  '/api/v1/zcash/protocols': {
    chain: 'zcash',
    network: 'mainnet',
    items: [
      { id: 'zerdinals', displayName: 'Zerdinals', family: 'inscriptions', releaseStatus: 'beta' },
      { id: 'zrunes', displayName: 'ZRunes', family: 'tokens', releaseStatus: 'beta' },
      { id: 'zrc20', displayName: 'ZRC-20', family: 'tokens', releaseStatus: 'beta' },
    ],
    status: { configured: true, state: 'ready', lagBlocksAtomic: '12' },
  },

  '/api/v1/dogecoin/protocols/drc20': {
    chain: 'dogecoin',
    network: 'mainnet',
    items: [
      { tick: 'doge', supplyAtomic: '100000000000', mintedAtomic: '100000000000', holdersAtomic: '18422', deployHeightAtomic: '4610221' },
      { tick: 'wow', supplyAtomic: '21000000', mintedAtomic: '18400000', holdersAtomic: '2044', deployHeightAtomic: '4812009' },
      { tick: 'such', supplyAtomic: '5000000', mintedAtomic: '5000000', holdersAtomic: '891', deployHeightAtomic: '4901884' },
    ],
    cursor: '3',
    completeness: 'complete',
  },

  // The ZRC-20 list and one token. Each item carries its ledger twice, under
  // two rulesets that are allowed to disagree, and the divergence summary.
  '/api/v1/zcash/protocols/zrc20': zrc20Envelope({
    total: '159',
    limit: '50',
    offset: '0',
    items: [
      zrc20DivergingToken(),
      zrc20Token('ZATS'),
      zrc20Token('ZILL', { decimals: '0' }),
    ],
  }),
  [`/api/v1/zcash/protocols/zrc20/${ZEC_ZRC20}`]: zrc20Envelope(zrc20DivergingToken()),

  // The dune catalog: one open mint, one closed with no symbol, and one with
  // zero divisibility so an unshifted quantity is on the page deliberately.
  '/api/v1/dogecoin/protocols/dunes': dogeDuneEnvelope({
    totalCountAtomic: '3',
    nextCursor: null,
    dunes: [
      dogeDune('SUCH•WOW•DUNE', DOGE_DUNE_ID),
      dogeDune('BARE•DUNE', '5084001:0', { symbol: null, mintable: false }),
      dogeDune('WHOLE•THINGS', '5084002:0', { divisibilityAtomic: '0', supplyAtomic: '21000' }),
    ],
  }),
  [`/api/v1/dogecoin/protocols/dunes/${DOGE_DUNE_ID}`]: dogeDuneEnvelope({
    dune: dogeDune('SUCH•WOW•DUNE', DOGE_DUNE_ID),
  }),
};

/**
 * Dogecoin as it stood on 2026-08-29: caught up on blocks, not ready overall,
 * because the protocol side is not answering and the DRC-20 index was created
 * without the flag that would let it serve at all.
 */
const DOGECOIN_NOT_READY = {
  ready: false,
  degradedReasons: [
    'base-chain-authority-unavailable',
    'confirmed-history-authority-unavailable',
    'protocol-history-unavailable',
  ],
};

/** Answering, and behind. Not a failure: every figure is true as of an older block. */
const DOGECOIN_BEHIND = {
  ready: false,
  degradedReasons: ['protocol-history-partial'],
};

export const chainStateOverrides = {
  // A pending set that is genuinely empty and says so.
  //
  // This is a real and common production state: at 2026-08-29T08:54Z the live
  // Zcash pending set held nothing and reported its view complete. It has to
  // read as a proven none rather than as a list that failed to arrive, and
  // without a fixture the page said neither.
  'chain-empty-pending': {
    '/api/v1/zcash/mempool': {
      body: {
        snapshot: {
          network: 'mainnet',
          snapshotId: 'zcash-ba6a8834d37e822b13a88c323255e2b3d2c6e68d',
          sequenceAtomic: '384',
          completeness: 'complete',
          transactionCountAtomic: '0',
          observedAt: new Date(Date.now() - 11_000).toISOString(),
        },
        transactions: [],
      },
    },
    '/api/v1/dogecoin/mempool': {
      body: {
        snapshot: {
          network: 'mainnet',
          snapshotId: 'dogecoin-partial-view',
          sequenceAtomic: '12',
          completeness: 'partial',
          observedAt: new Date(Date.now() - 11_000).toISOString(),
        },
        transactions: [],
      },
    },
  },

  // Both chain authorities are unreachable. The page must say the status is
  // unavailable and must not present an empty overview as a working one.
  'chain-authority-down': {
    // The list too. It is the same overlay, so an outage that reaches one
    // reaches both, and overriding only the single status photographed a
    // header claiming the chain is ready above a page saying it cannot be
    // reached, which production cannot produce.
    '/api/v1/chains': { status: 503 },
    '/api/v1/dogecoin/status': { status: 503 },
    '/api/v1/zcash/status': { status: 503 },
    '/api/v1/dogecoin/mempool': { status: 503 },
    '/api/v1/zcash/mempool': { status: 503 },
  },

  // The authority answers, and says it is behind. This is the state the whole
  // status rail exists for, and it is not a failure: every figure on the page
  // is true as of a block that is not the tip, and the page has to say so.
  'chain-behind': {
    '/api/v1/chains': {
      body: [capability('dogecoin', DOGECOIN_BEHIND), capability('zcash')],
    },
    '/api/v1/dogecoin/status': {
      body: capability('dogecoin', {
        ...DOGECOIN_BEHIND,
        lagBlocksAtomic: '2841',
        sync: { state: 'degraded', initialBlockDownload: false, progressDecimal: '0.9994', updatedAt: new Date(Date.now() - 20_000).toISOString() },
        coverage: { confirmedHistory: 'partial', addressHistory: 'partial', protocolHistory: 'partial' },
      }),
    },
  },

  // A chain whose node is caught up while the protocol side is not, which is
  // what Dogecoin published on 2026-08-29: ready false, sync ready, three
  // reasons, and a DRC-20 index that was created without the flag and so
  // cannot serve it at all. Reading the sync state alone printed Ready in the
  // proven tone on a chain that had just said no, and the reasons were carried
  // in the same document and rendered nowhere.
  'chain-not-ready-protocols': {
    // The header switcher reads the chain list and the page reads the single
    // status, so a fixture that overrides one and not the other photographs a
    // disagreement production cannot produce, both documents come from the
    // same overlay.
    '/api/v1/chains': {
      body: [
        capability('dogecoin', DOGECOIN_NOT_READY),
        capability('zcash'),
      ],
    },
    '/api/v1/dogecoin/status': {
      body: capability('dogecoin', {
        ...DOGECOIN_NOT_READY,
        protocols: [
          { protocolId: 'doginals', state: 'degraded', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: ['protocol-authority-unavailable'] },
          { protocolId: 'drc20', state: 'unavailable', coverage: 'unavailable', updatedAt: null, lagBlocksAtomic: null, degradedReasons: ['authority-capability-disabled'] },
          // Ready, and still reporting two edges of its coverage. Those are
          // not faults and must not be printed as though they were.
          { protocolId: 'tap_doge', state: 'ready', coverage: 'complete', updatedAt: new Date(Date.now() - 20_000).toISOString(), lagBlocksAtomic: '0', degradedReasons: ['pending-protocol-coverage-unavailable', 'reorg-evidence-tail-only'] },
        ],
      }),
    },
  },

  // A chain that withholds readiness and states no reason for it. The page has
  // to say that out loud rather than leave the space where the explanation
  // belongs empty, which reads as a chain that is simply fine.
  'chain-not-ready-unexplained': {
    '/api/v1/chains': {
      body: [
        capability('dogecoin'),
        capability('zcash', { ready: false, degradedReasons: [] }),
      ],
    },
    '/api/v1/zcash/status': {
      body: capability('zcash', { ready: false, degradedReasons: [] }),
    },
  },

  // The object simply is not there. A 404 from the authority is an answer, not
  // an outage, and the page must not describe it as one.
  'chain-object-missing': {
    [`/api/v1/dogecoin/tx/${DOGE_TXID}`]: { status: 404 },
    [`/api/v1/dogecoin/block/${DOGE_BLOCK}`]: { status: 404 },
    [`/api/v1/dogecoin/address/${DOGE_ADDRESS}`]: { status: 404 },
  },
};

/**
 * The chain failure states describe the chain-domain API, so running them
 * against a Bitcoin route measures nothing and costs a page load in every
 * theme and at every width. Each one names the route prefixes it applies to,
 * and the matrix skips the rest.
 *
 * Only the states declared here are scoped. Every state without an entry
 * still runs against every route, which is what the Bitcoin states have
 * always done.
 */
export const chainStateScope = {
  'chain-empty-pending': ['dogecoin-mempool', 'zcash-mempool'],
  'chain-authority-down': ['dogecoin', 'zcash'],
  'chain-behind': ['dogecoin'],
  'chain-not-ready-protocols': ['dogecoin'],
  'chain-not-ready-unexplained': ['zcash'],
  'chain-object-missing': ['dogecoin'],
};

export const chainSampleIds = { DOGE_TXID, DOGE_BLOCK, DOGE_ADDRESS, DOGE_DUNE_ID, ZEC_TXID, ZEC_BLOCK, ZEC_ADDRESS, ZEC_ZRC20 };
