// Deterministic API fixtures for the Universe Explorer visual and
// accessibility matrix.
//
// The production API is not a usable source of truth for a design review: it
// changes every block, and it cannot be asked to produce an empty address, a
// stalled authority, or a 40-deep replacement chain on demand. These fixtures
// pin every state the matrix has to prove, so a screenshot difference means the
// interface changed rather than the chain moved.
//
// Values are shaped like the real payloads and are internally consistent
// (fees match weights, counts match arrays). They are not real user data.

const TXID_A = '9f4a1c7e5b2d8036a1f4c9e7b3d5081a2c6e4f9b7d3a1c58e26f0b4d9a7c3e15';
const TXID_B = '3b7e9d1a5c8f2064e9b3d7a1c5f8026b4d9e7a3c1f5b8d260e4a9c7f3b1d5e82';
const TXID_C = 'c1e5a9d3f7b2408e6a1c5d9f3b7e0246a8c2e6f0b4d8a26ce0f4b8d2a6c0e4f8';
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const BLOCK_HASH = '00000000000000000002a7c4c1e8b7d3f9a5c2e6b0d4f8a1c5e9b3d7f1a5c9e3';

export const fixtures = {
  '/api/v1/fees/recommended': {
    fastestFee: 14,
    halfHourFee: 11,
    hourFee: 8,
    economyFee: 4,
    minimumFee: 1,
  },

  '/api/v1/fees/mempool-blocks': [
    { blockSize: 1_402_881, blockVSize: 997_431, nTx: 2841, totalFees: 14_882_301, medianFee: 13.4, feeRange: [4.1, 8.2, 11.0, 13.4, 18.7, 24.9, 61.2] },
    { blockSize: 1_399_204, blockVSize: 996_002, nTx: 3120, totalFees: 9_120_774, medianFee: 8.1, feeRange: [3.0, 5.2, 7.1, 8.1, 10.4, 13.8, 22.6] },
    { blockSize: 1_401_119, blockVSize: 998_210, nTx: 3488, totalFees: 6_002_118, medianFee: 5.2, feeRange: [2.1, 3.4, 4.6, 5.2, 6.8, 8.9, 14.1] },
  ],

  '/api/v1/blocks': [
    { id: BLOCK_HASH, height: 887_412, version: 536_870_912, timestamp: 1_772_100_000, tx_count: 3_104, size: 1_612_884, weight: 3_993_112, merkle_root: TXID_A, previousblockhash: TXID_B, mediantime: 1_772_099_400, nonce: 1_884_223_901, bits: 386_101_681, difficulty: 110_568_428_300_952, extras: { totalFees: 12_884_901, medianFee: 11.2, feeRange: [1, 4, 8, 11, 17, 25, 88], reward: 325_884_901, pool: { id: 111, name: 'Universe Pool', slug: 'universe-pool' }, avgFeeRate: 12, coinbaseRaw: '', orphans: [], matchRate: 99.4, expectedFees: 12_700_000, expectedWeight: 3_992_000, similarity: 0.994 } },
    { id: TXID_B, height: 887_411, version: 536_870_912, timestamp: 1_772_099_400, tx_count: 2_881, size: 1_598_112, weight: 3_988_004, merkle_root: TXID_C, previousblockhash: TXID_C, mediantime: 1_772_098_800, nonce: 774_223_100, bits: 386_101_681, difficulty: 110_568_428_300_952, extras: { totalFees: 9_112_004, medianFee: 8.4, feeRange: [1, 3, 6, 8, 12, 19, 61], reward: 322_112_004, pool: { id: 112, name: 'Orbit Mining', slug: 'orbit-mining' }, avgFeeRate: 9, coinbaseRaw: '', orphans: [], matchRate: 98.8, expectedFees: 9_000_000, expectedWeight: 3_987_000, similarity: 0.988 } },
  ],

  '/api/v1/difficulty-adjustment': {
    progressPercent: 62.4,
    difficultyChange: 3.18,
    estimatedRetargetDate: 1_772_700_000_000,
    remainingBlocks: 758,
    remainingTime: 447_600_000,
    previousRetarget: -1.42,
    previousTime: 1_771_400_000,
    nextRetargetHeight: 888_170,
    timeAvg: 590_000,
    adjustedTimeAvg: 588_000,
    timeOffset: 0,
    expectedBlocks: 1_290,
  },

  '/api/v1/statistics/2h': buildMempoolStats(),

  '/api/v1/replacements': [
    { tx: { txid: TXID_A, fee: 4_120, vsize: 141, value: 1_882_004, rate: 29.2, time: 1_772_099_900, rbf: true, fullRbf: false }, time: 1_772_099_900, fullRbf: false, replaces: [{ tx: { txid: TXID_B, fee: 1_410, vsize: 141, value: 1_884_714, rate: 10.0, time: 1_772_099_100, rbf: true }, time: 1_772_099_100, replaces: [], interval: 800 }], interval: 800, mined: false },
    { tx: { txid: TXID_C, fee: 9_880, vsize: 247, value: 12_004_881, rate: 40.0, time: 1_772_099_700, rbf: true, fullRbf: true }, time: 1_772_099_700, fullRbf: true, replaces: [{ tx: { txid: TXID_A, fee: 2_470, vsize: 247, value: 12_012_291, rate: 10.0, time: 1_772_098_900, rbf: true }, time: 1_772_098_900, replaces: [], interval: 800 }], interval: 800, mined: true },
  ],

  // The socket's replacement summary is flat, unlike the REST replacement
  // tree above. The dashboard reads these fields directly.
  'rbf-latest-summary': [
    { txid: TXID_A, oldFee: 1_410, newFee: 4_120, oldVsize: 141, newVsize: 141, mined: false, fullRbf: false },
    { txid: TXID_C, oldFee: 2_470, newFee: 9_880, oldVsize: 247, newVsize: 247, mined: true, fullRbf: true },
    { txid: TXID_B, oldFee: 880, newFee: 3_960, oldVsize: 220, newVsize: 220, mined: false, fullRbf: false },
  ],

  '/api/mempool/recent': [
    { txid: TXID_A, fee: 4_120, vsize: 141, value: 1_882_004 },
    { txid: TXID_B, fee: 1_988, vsize: 222, value: 44_120_887 },
    { txid: TXID_C, fee: 9_880, vsize: 247, value: 12_004_881 },
  ],

  '/api/v1/mining/pools/1w': {
    pools: [
      { poolId: 111, name: 'Universe Pool', link: '', blockCount: 214, rank: 1, emptyBlocks: 0, slug: 'universe-pool', avgMatchRate: 99.2, avgFeeDelta: '0.004', poolUniqueId: 111 },
      { poolId: 112, name: 'Orbit Mining', link: '', blockCount: 188, rank: 2, emptyBlocks: 1, slug: 'orbit-mining', avgMatchRate: 98.6, avgFeeDelta: '0.006', poolUniqueId: 112 },
    ],
    blockCount: 402,
    lastEstimatedHashrate: 812_004_881_002_991_000_000,
  },

  '/api/v1/universe/protocols': {
    registryVersion: '2026.08.1',
    protocols: [
      { protocolId: 'ordinals', displayName: 'Ordinals', chain: 'bitcoin', family: 'inscriptions', releaseStatus: 'production_verified', authority: 'ord 0.29', coverage: { fromHeight: 767_430, toHeight: 887_412 } },
      { protocolId: 'runes', displayName: 'Runes', chain: 'bitcoin', family: 'fungible', releaseStatus: 'production_verified', authority: 'ord 0.29', coverage: { fromHeight: 840_000, toHeight: 887_412 } },
      { protocolId: 'alkanes', displayName: 'Alkanes', chain: 'bitcoin', family: 'contracts', releaseStatus: 'verified_read_only', authority: 'metashrew', coverage: { fromHeight: 880_000, toHeight: 887_412 } },
      { protocolId: 'stamps', displayName: 'Stamps', chain: 'bitcoin', family: 'inscriptions', releaseStatus: 'experimental', authority: 'stampchain', coverage: { fromHeight: 779_652, toHeight: 886_900 } },
      { protocolId: 'atomicals', displayName: 'Atomicals', chain: 'bitcoin', family: 'fungible', releaseStatus: 'blocked', authority: null, coverage: null },
    ],
  },

  '/api/v1/universe/pulse': {
    checked: 512,
    authorityAnswering: true,
    counts: { ordinals: 41, runes: 12, alkanes: 3, stamps: 0 },
  },
};

/** Address with history, and its transactions. */
export const addressFixtures = {
  [`/api/address/${ADDRESS}`]: {
    address: ADDRESS,
    chain_stats: { funded_txo_count: 42, funded_txo_sum: 184_002_881, spent_txo_count: 38, spent_txo_sum: 171_004_002, tx_count: 51 },
    mempool_stats: { funded_txo_count: 1, funded_txo_sum: 220_000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
  },
};

/**
 * States the matrix has to prove beyond the populated one. Each entry maps a
 * URL pattern to a response, so a run can assert that the interface says
 * something true when the answer is missing rather than showing a confident
 * zero.
 */
export const stateOverrides = {
  // Every Universe authority call fails. The interface must say it could not
  // reach the authority, and must not report "0 protocols" as if that were an
  // answer.
  'authority-down': {
    '/api/v1/universe/protocols': { status: 502 },
    '/api/v1/universe/pulse': { status: 502 },
  },

  // The registry answers, but with nothing in it.
  'authority-empty': {
    '/api/v1/universe/protocols': { body: { registryVersion: '2026.08.1', protocols: [] } },
  },

  // Core chain data is unavailable.
  'chain-down': {
    '/api/v1/fees/recommended': { status: 502 },
    '/api/v1/blocks': { status: 502 },
    '/api/v1/difficulty-adjustment': { status: 502 },
  },

  // Requests never resolve, so every surface stays in its loading state.
  loading: { '**': { hang: true } },

  // An address that has never been used.
  'address-empty': {
    [`/api/address/${ADDRESS}`]: {
      body: {
        address: ADDRESS,
        chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
        mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
      },
    },
    [`/api/address/${ADDRESS}/txs`]: { body: [] },
  },
};

export const sampleIds = { TXID_A, TXID_B, TXID_C, ADDRESS, BLOCK_HASH };

function buildMempoolStats() {
  const now = Math.floor(Date.now() / 1000);
  const points = [];
  for (let i = 120; i >= 0; i--) {
    const drift = Math.sin(i / 9) * 40 + Math.cos(i / 4) * 12;
    points.push({
      added: now - i * 60,
      count: Math.round(28_000 + drift * 120),
      vbytes_per_second: Math.round(1_600 + drift * 6),
      total_fee: Math.round(88_000_000 + drift * 200_000),
      mempool_byte_weight: Math.round(112_000_000 + drift * 400_000),
      vsizes: Array.from({ length: 38 }, (_, band) => Math.round(Math.max(0, 900 - band * 22 + drift))),
    });
  }
  return points;
}
