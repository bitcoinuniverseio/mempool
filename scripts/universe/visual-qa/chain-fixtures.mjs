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
      heightAtomic: chain === 'dogecoin' ? '5623041' : '2884120',
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
    reads: {
      transaction: true,
      block: chain === 'dogecoin',
      address: true,
      outpoint: true,
      feeEstimates: false,
      projectedBlocks: false,
    },
    protocols: chain === 'dogecoin'
      ? [
          { protocolId: 'doginals', state: 'ready', coverage: 'complete', updatedAt: observedAt, lagBlocksAtomic: '0', degradedReasons: [] },
          { protocolId: 'drc20', state: 'ready', coverage: 'complete', updatedAt: observedAt, lagBlocksAtomic: '0', degradedReasons: [] },
          { protocolId: 'doge-tap', state: 'degraded', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '184', degradedReasons: ['authority behind chain tip'] },
        ]
      : [
          { protocolId: 'zerdinals', state: 'ready', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: [] },
          { protocolId: 'zrunes', state: 'ready', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: [] },
          { protocolId: 'zrc20', state: 'degraded', coverage: 'partial', updatedAt: observedAt, lagBlocksAtomic: '12', degradedReasons: ['two rulesets disagree below this height'] },
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
        { indexAtomic: '0', previousOutpoint: `${ZEC_TXID}:0`, address: 't1KrGGkMTgVTNaAmXcnCrMTgVTNaAmXcnCr', valueAtomic: '250000000', coinbase: false },
      ],
      outputs: [
        { indexAtomic: '0', address: 't1SoMeTransparentOutputAddressXXXXX', valueAtomic: '99980000', spent: null },
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
};

export const chainStateOverrides = {
  // Both chain authorities are unreachable. The page must say the status is
  // unavailable and must not present an empty overview as a working one.
  'chain-authority-down': {
    '/api/v1/dogecoin/status': { status: 503 },
    '/api/v1/zcash/status': { status: 503 },
    '/api/v1/dogecoin/mempool': { status: 503 },
    '/api/v1/zcash/mempool': { status: 503 },
  },

  // The authority answers, and says it is behind. This is the state the whole
  // status rail exists for, and it is not a failure: every figure on the page
  // is true as of a block that is not the tip, and the page has to say so.
  'chain-behind': {
    '/api/v1/dogecoin/status': {
      body: capability('dogecoin', {
        ready: false,
        lagBlocksAtomic: '2841',
        sync: { state: 'degraded', initialBlockDownload: false, progressDecimal: '0.9994', updatedAt: new Date(Date.now() - 20_000).toISOString() },
        coverage: { confirmedHistory: 'partial', addressHistory: 'partial', protocolHistory: 'partial' },
        degradedReasons: ['confirmed history authority is behind the chain tip'],
      }),
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
  'chain-authority-down': ['dogecoin', 'zcash'],
  'chain-behind': ['dogecoin'],
  'chain-object-missing': ['dogecoin'],
};

export const chainSampleIds = { DOGE_TXID, DOGE_BLOCK, DOGE_ADDRESS, ZEC_TXID };
