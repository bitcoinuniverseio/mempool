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

const TXID_A =
  "9f4a1c7e5b2d8036a1f4c9e7b3d5081a2c6e4f9b7d3a1c58e26f0b4d9a7c3e15";
const TXID_B =
  "3b7e9d1a5c8f2064e9b3d7a1c5f8026b4d9e7a3c1f5b8d260e4a9c7f3b1d5e82";
const TXID_C =
  "c1e5a9d3f7b2408e6a1c5d9f3b7e0246a8c2e6f0b4d8a26ce0f4b8d2a6c0e4f8";
const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BLOCK_HASH =
  "00000000000000000002a7c4c1e8b7d3f9a5c2e6b0d4f8a1c5e9b3d7f1a5c9e3";
const BITCOIN_CHECKPOINT = {
  chain: "bitcoin",
  network: "mainnet",
  heightAtomic: "887412",
  blockHash: BLOCK_HASH,
  reorgEpoch: "0",
  observedAt: "2026-09-03T00:00:00.000Z",
};

const PORTFOLIO_REQUESTED_AT = "2026-09-03T00:00:00.000Z";
const PORTFOLIO_COMPLETED_AT = "2026-09-03T00:00:01.000Z";
const PORTFOLIO_ACCOUNT = {
  portfolioId: "external",
  accountId: ADDRESS,
  addressId: ADDRESS,
  chain: "bitcoin",
  network: "mainnet",
  address: ADDRESS,
};
const PORTFOLIO_SOURCE = {
  authorityId: "universe-bitcoin-core",
  protocols: ["base"],
  state: "proven",
  checkpoint: BITCOIN_CHECKPOINT,
  lagAtomic: "0",
  releaseSha: "qa-fixture-release",
};
const PORTFOLIO_ENVELOPE = {
  schemaVersion: "universe-portfolio-v1",
  chain: "bitcoin",
  network: "mainnet",
  address: ADDRESS,
  requestedAt: PORTFOLIO_REQUESTED_AT,
  completedAt: PORTFOLIO_COMPLETED_AT,
  snapshotId: "qa-portfolio-snapshot-001",
  chainTip: BITCOIN_CHECKPOINT,
  sources: [PORTFOLIO_SOURCE],
  warnings: [],
  errors: [],
  unresolvedCount: 0,
  hasMore: false,
};
const PORTFOLIO_NATIVE_HOLDING = {
  schemaVersion: "universe-portfolio-holding-v1",
  assetKey: "bitcoin:mainnet:base:native:bitcoin",
  identity: {
    chain: "bitcoin",
    network: "mainnet",
    protocol: "base",
    assetType: "native",
    assetId: "bitcoin",
  },
  displayName: "Bitcoin",
  ticker: "BTC",
  decimals: 8,
  quantityAtomic: "123456789",
  spendableAtomic: "123456789",
  custody: [{ kind: "outpoint", reference: `${TXID_A}:0` }],
  ownerAddress: ADDRESS,
  price: {
    quoteCurrency: "USD",
    unitPrice: "60000",
    source: "qa-fixture",
    methodology: "Deterministic browser QA fixture",
    observedAt: PORTFOLIO_COMPLETED_AT,
    sampleCountAtomic: "1",
    stale: false,
  },
  value: "74074.0734",
  state: "active",
  valuationState: "priced",
  costBasisState: "unknown",
  sourceAuthority: "universe-bitcoin-core",
  sourceState: "proven",
  checkpoint: BITCOIN_CHECKPOINT,
  warnings: [],
};
const PORTFOLIO_INSCRIPTION_HOLDING = {
  schemaVersion: "universe-portfolio-holding-v1",
  assetKey: `bitcoin:mainnet:ordinals:inscription:${TXID_B}i0`,
  identity: {
    chain: "bitcoin",
    network: "mainnet",
    protocol: "ordinals",
    assetType: "inscription",
    assetId: `${TXID_B}i0`,
  },
  displayName: "QA inscription",
  ticker: "INSCRIPTION",
  decimals: 0,
  quantityAtomic: "1",
  custody: [{ kind: "outpoint", reference: `${TXID_A}:0` }],
  ownerAddress: ADDRESS,
  state: "active",
  valuationState: "unpriced",
  costBasisState: "unknown",
  sourceAuthority: "universe-ord-029",
  sourceState: "proven",
  checkpoint: BITCOIN_CHECKPOINT,
  warnings: [],
};
const PORTFOLIO_LOCATION = {
  account: PORTFOLIO_ACCOUNT,
  custodyKind: "outpoint",
  custodyReference: `${TXID_A}:0`,
  quantityAtomic: "1",
  state: "proven",
  checkpoint: BITCOIN_CHECKPOINT,
};
const PORTFOLIO_VALUATION = {
  quoteCurrency: "USD",
  pricedValue: "74074.0734",
  pricedHoldingCount: 1,
  unpricedHoldingCount: 1,
  state: "partially-priced",
};
const PORTFOLIO_SNAPSHOT = {
  schemaVersion: "universe-portfolio-snapshot-v1",
  chain: "bitcoin",
  network: "mainnet",
  address: ADDRESS,
  account: PORTFOLIO_ACCOUNT,
  requestedPoint: { timestamp: "2026-08-04T00:00:00Z" },
  resolvedPoint: {
    timestamp: "2026-08-04T00:00:00.000Z",
    blockHeightAtomic: "883000",
    blockHash: BLOCK_HASH,
  },
  holdings: [PORTFOLIO_NATIVE_HOLDING, PORTFOLIO_INSCRIPTION_HOLDING],
  nativeBalance: PORTFOLIO_NATIVE_HOLDING,
  valuation: PORTFOLIO_VALUATION,
  state: "proven",
  sources: [PORTFOLIO_SOURCE],
  warnings: [],
};

/**
 * Product landings reviewed in their honest unavailable state until their
 * authorities have deterministic populated payloads. Each entry is an exact
 * request path issued while the landing page initializes.
 */
export const failClosedProductRequests = Object.freeze({
  wildkin: ["/api/v1/wildkin/status"],
  fractal: ["/api/v1/fractal/tip"],
  "zcash-privacy": ["/api/v1/zcash/privacy/summary"],
  liquid: [
    "/api/v1/liquid/observatory/summary",
    "/api/v1/liquid/observatory/assets",
    "/api/v1/liquid/observatory/pegs",
    "/api/v1/liquid/observatory/federation",
  ],
  data: ["/api/v1/data/catalog", "/api/v1/data/query"],
  "taproot-assets": [
    "/api/v1/taproot-assets/assets",
    "/api/v1/taproot-assets/groups",
  ],
  "lightning-standards": ["/api/v1/lightning/offers", "/api/v1/lightning/rfq"],
  ark: ["/api/v1/ark/operators", "/api/v1/ark/batches"],
  rgb: [],
  "stratum-v2": [
    "/api/v1/stratum-v2/network",
    "/api/v1/stratum-v2/templates",
    "/api/v1/stratum-v2/declarations",
  ],
  script: [],
  "layer-2": ["/api/v1/l2/systems", "/api/v1/l2/challenges"],
  payment: [],
  utxo: [
    "/api/v1/utxo-set/checkpoints",
    "/api/v1/utxo-set/distribution",
    "/api/v1/utxo-set/protocols",
    "/api/v1/utreexo/roots",
  ],
});

const failClosedProductFixtures = Object.fromEntries(
  Object.entries(failClosedProductRequests).flatMap(([family, paths]) =>
    paths.map((path) => [path, failClosedProductFixture(family)]),
  ),
);

export const fixtures = {
  ...failClosedProductFixtures,
  "/api/v2/universe/portfolio/networks": {
    schemaVersion: "universe-portfolio-v2-networks-v1",
    releaseSha: "qa-fixture-release",
    contractVersion: "universe-portfolio-v2",
    networks: [
      {
        chain: "bitcoin",
        network: "mainnet",
        nativeAssetKey: "bitcoin:mainnet:base:native:bitcoin",
        nativeTicker: "BTC",
        nativeDecimals: 8,
        addressHistory: true,
        utxoComposition: true,
        historicalSnapshots: true,
      },
    ],
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/summary`]: {
    schemaVersion: "universe-portfolio-v2-summary-v1",
    account: PORTFOLIO_ACCOUNT,
    envelope: PORTFOLIO_ENVELOPE,
    aggregateState: "proven",
    nativeBalance: PORTFOLIO_NATIVE_HOLDING,
    valuation: PORTFOLIO_VALUATION,
    counts: {
      totalHoldingCount: 2,
      fungibleCount: 1,
      nftCount: 1,
      inscriptionCount: 1,
      protocolCount: 2,
    },
    protocols: [],
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/holdings`]: {
    schemaVersion: "universe-portfolio-v2-holdings-v1",
    account: PORTFOLIO_ACCOUNT,
    envelope: PORTFOLIO_ENVELOPE,
    holdings: [
      {
        holding: PORTFOLIO_NATIVE_HOLDING,
        locations: [{ ...PORTFOLIO_LOCATION, quantityAtomic: "123456789" }],
      },
      {
        holding: PORTFOLIO_INSCRIPTION_HOLDING,
        locations: [PORTFOLIO_LOCATION],
      },
    ],
    nextCursor: null,
    sourceState: "proven",
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/activity`]: {
    schemaVersion: "universe-portfolio-activity-v2",
    chain: "bitcoin",
    network: "mainnet",
    address: ADDRESS,
    account: PORTFOLIO_ACCOUNT,
    events: [
      {
        schemaVersion: "universe-portfolio-activity-v2",
        eventId: "qa-event-001",
        chain: "bitcoin",
        network: "mainnet",
        txid: TXID_A,
        blockHeightAtomic: "887412",
        blockHash: BLOCK_HASH,
        timestamp: PORTFOLIO_COMPLETED_AT,
        confirmationState: "confirmed",
        eventType: "receive",
        direction: "in",
        accountRefs: [PORTFOLIO_ACCOUNT],
        rawCounterparties: ["bc1qexamplecounterparty000000000000000000000"],
        holdings: [
          {
            assetKey: PORTFOLIO_NATIVE_HOLDING.assetKey,
            displayName: "Bitcoin",
            ticker: "BTC",
            decimals: 8,
            quantityDeltaAtomic: "123456789",
            direction: "in",
          },
        ],
        nativeValueAtomic: "123456789",
        feeAtomic: "1200",
        valuationAtEvent: null,
        sourceState: "proven",
        sourceReports: [PORTFOLIO_SOURCE],
        warnings: [],
      },
    ],
    nextCursor: null,
    checkpoint: BITCOIN_CHECKPOINT,
    sourceState: "proven",
    requestedAt: PORTFOLIO_REQUESTED_AT,
    completedAt: PORTFOLIO_COMPLETED_AT,
    warnings: [],
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/utxos`]: {
    schemaVersion: "universe-portfolio-utxo-v1",
    chain: "bitcoin",
    network: "mainnet",
    address: ADDRESS,
    account: PORTFOLIO_ACCOUNT,
    utxos: [
      {
        schemaVersion: "universe-portfolio-utxo-v1",
        chain: "bitcoin",
        network: "mainnet",
        txid: TXID_A,
        vout: 0,
        valueAtomic: "123456789",
        scriptType: "p2wpkh",
        address: ADDRESS,
        confirmationsAtomic: "12",
        blockHeightAtomic: "887401",
        blockHash: BLOCK_HASH,
        firstSeenAt: PORTFOLIO_REQUESTED_AT,
        spent: false,
        pending: false,
        coinbase: false,
        maturityHeightAtomic: null,
        assetState: "proven",
        assets: [PORTFOLIO_INSCRIPTION_HOLDING],
        warnings: [],
        sourceReports: [PORTFOLIO_SOURCE],
      },
    ],
    nextCursor: null,
    sourceState: "proven",
    requestedAt: PORTFOLIO_REQUESTED_AT,
    completedAt: PORTFOLIO_COMPLETED_AT,
    warnings: [],
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/performance`]: {
    schemaVersion: "universe-portfolio-v2-performance-v1",
    chain: "bitcoin",
    network: "mainnet",
    address: ADDRESS,
    account: PORTFOLIO_ACCOUNT,
    sourceState: "proven",
    quoteCurrency: "USD",
    realizedPnl: "125.5",
    unrealizedPnl: "250.25",
    totalPnl: "375.75",
    invested: "1000",
    proceeds: "1125.5",
    fees: "2.5",
    attribution: [],
    methodology: "Deterministic FIFO browser QA fixture.",
    warnings: [],
    requestedAt: PORTFOLIO_REQUESTED_AT,
    completedAt: PORTFOLIO_COMPLETED_AT,
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/coverage`]: {
    schemaVersion: "universe-portfolio-v2-coverage-v1",
    account: PORTFOLIO_ACCOUNT,
    envelope: PORTFOLIO_ENVELOPE,
    roster: [
      {
        protocol: "base",
        servingMode: "first-party-full-node",
        authorityId: "universe-bitcoin-core",
        state: "proven",
        checkpoint: BITCOIN_CHECKPOINT,
        releaseSha: "qa-fixture-release",
        detail: "Deterministic browser QA coverage.",
      },
    ],
  },
  [`/api/v2/universe/portfolio/bitcoin/mainnet/${ADDRESS}/delta`]: {
    schemaVersion: "universe-portfolio-delta-v1",
    chain: "bitcoin",
    network: "mainnet",
    address: ADDRESS,
    from: PORTFOLIO_SNAPSHOT,
    to: {
      ...PORTFOLIO_SNAPSHOT,
      requestedPoint: { timestamp: "2026-09-03T00:00:00Z" },
      resolvedPoint: {
        timestamp: PORTFOLIO_COMPLETED_AT,
        blockHeightAtomic: "887412",
        blockHash: BLOCK_HASH,
      },
    },
    acquired: [],
    disposed: [],
    quantityChanged: [],
    priceEffect: "250.25",
    externalFlowEffect: "125.5",
    internalTransferEffect: "0",
    feeEffect: "2.5",
    unresolvedEffect: "0",
    coverageChanges: [],
    warnings: [],
  },
  "/api/v1/fees/recommended": {
    fastestFee: 14,
    halfHourFee: 11,
    hourFee: 8,
    economyFee: 4,
    minimumFee: 1,
  },

  "/api/v1/fees/mempool-blocks": [
    {
      blockSize: 1_402_881,
      blockVSize: 997_431,
      nTx: 2841,
      totalFees: 14_882_301,
      medianFee: 13.4,
      feeRange: [4.1, 8.2, 11.0, 13.4, 18.7, 24.9, 61.2],
    },
    {
      blockSize: 1_399_204,
      blockVSize: 996_002,
      nTx: 3120,
      totalFees: 9_120_774,
      medianFee: 8.1,
      feeRange: [3.0, 5.2, 7.1, 8.1, 10.4, 13.8, 22.6],
    },
    {
      blockSize: 1_401_119,
      blockVSize: 998_210,
      nTx: 3488,
      totalFees: 6_002_118,
      medianFee: 5.2,
      feeRange: [2.1, 3.4, 4.6, 5.2, 6.8, 8.9, 14.1],
    },
  ],

  "/api/v1/blocks": [
    {
      id: BLOCK_HASH,
      height: 887_412,
      version: 536_870_912,
      timestamp: 1_772_100_000,
      tx_count: 3_104,
      size: 1_612_884,
      weight: 3_993_112,
      merkle_root: TXID_A,
      previousblockhash: TXID_B,
      mediantime: 1_772_099_400,
      nonce: 1_884_223_901,
      bits: 386_101_681,
      difficulty: 110_568_428_300_952,
      extras: {
        totalFees: 12_884_901,
        medianFee: 11.2,
        feeRange: [1, 4, 8, 11, 17, 25, 88],
        reward: 325_884_901,
        pool: { id: 111, name: "Universe Pool", slug: "universe-pool" },
        avgFeeRate: 12,
        coinbaseRaw: "",
        orphans: [],
        matchRate: 99.4,
        expectedFees: 12_700_000,
        expectedWeight: 3_992_000,
        similarity: 0.994,
      },
    },
    {
      id: TXID_B,
      height: 887_411,
      version: 536_870_912,
      timestamp: 1_772_099_400,
      tx_count: 2_881,
      size: 1_598_112,
      weight: 3_988_004,
      merkle_root: TXID_C,
      previousblockhash: TXID_C,
      mediantime: 1_772_098_800,
      nonce: 774_223_100,
      bits: 386_101_681,
      difficulty: 110_568_428_300_952,
      extras: {
        totalFees: 9_112_004,
        medianFee: 8.4,
        feeRange: [1, 3, 6, 8, 12, 19, 61],
        reward: 322_112_004,
        pool: { id: 112, name: "Orbit Mining", slug: "orbit-mining" },
        avgFeeRate: 9,
        coinbaseRaw: "",
        orphans: [],
        matchRate: 98.8,
        expectedFees: 9_000_000,
        expectedWeight: 3_987_000,
        similarity: 0.988,
      },
    },
  ],

  "/api/v1/difficulty-adjustment": {
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

  "/api/v1/statistics/2h": buildMempoolStats(),

  "/api/v1/replacements": [
    {
      tx: {
        txid: TXID_A,
        fee: 4_120,
        vsize: 141,
        value: 1_882_004,
        rate: 29.2,
        time: 1_772_099_900,
        rbf: true,
        fullRbf: false,
      },
      time: 1_772_099_900,
      fullRbf: false,
      replaces: [
        {
          tx: {
            txid: TXID_B,
            fee: 1_410,
            vsize: 141,
            value: 1_884_714,
            rate: 10.0,
            time: 1_772_099_100,
            rbf: true,
          },
          time: 1_772_099_100,
          replaces: [],
          interval: 800,
        },
      ],
      interval: 800,
      mined: false,
    },
    {
      tx: {
        txid: TXID_C,
        fee: 9_880,
        vsize: 247,
        value: 12_004_881,
        rate: 40.0,
        time: 1_772_099_700,
        rbf: true,
        fullRbf: true,
      },
      time: 1_772_099_700,
      fullRbf: true,
      replaces: [
        {
          tx: {
            txid: TXID_A,
            fee: 2_470,
            vsize: 247,
            value: 12_012_291,
            rate: 10.0,
            time: 1_772_098_900,
            rbf: true,
          },
          time: 1_772_098_900,
          replaces: [],
          interval: 800,
        },
      ],
      interval: 800,
      mined: true,
    },
  ],

  // The socket's replacement summary is flat, unlike the REST replacement
  // tree above. The dashboard reads these fields directly.
  "rbf-latest-summary": [
    {
      txid: TXID_A,
      oldFee: 1_410,
      newFee: 4_120,
      oldVsize: 141,
      newVsize: 141,
      mined: false,
      fullRbf: false,
    },
    {
      txid: TXID_C,
      oldFee: 2_470,
      newFee: 9_880,
      oldVsize: 247,
      newVsize: 247,
      mined: true,
      fullRbf: true,
    },
    {
      txid: TXID_B,
      oldFee: 880,
      newFee: 3_960,
      oldVsize: 220,
      newVsize: 220,
      mined: false,
      fullRbf: false,
    },
  ],

  "/api/mempool/recent": [
    { txid: TXID_A, fee: 4_120, vsize: 141, value: 1_882_004 },
    { txid: TXID_B, fee: 1_988, vsize: 222, value: 44_120_887 },
    { txid: TXID_C, fee: 9_880, vsize: 247, value: 12_004_881 },
  ],

  // The homepage protocol strip and Pulse resolve the same three transactions
  // sent by the socket. Keep the batch response aligned with that socket list.
  "/api/v1/universe/transactions/batch": {
    results: [
      {
        txid: TXID_A,
        status: "ok",
        flow: buildPulseFlow(TXID_A, "runes", "transfer"),
      },
      {
        txid: TXID_B,
        status: "ok",
        flow: buildPulseFlow(TXID_B, "ordinals", "inscribe"),
      },
      {
        txid: TXID_C,
        status: "ok",
        flow: buildPulseFlow(TXID_C, "alkanes", "contract-call"),
      },
    ],
  },

  "/api/v1/mining/pools/1w": {
    pools: [
      {
        poolId: 111,
        name: "Universe Pool",
        link: "",
        blockCount: 214,
        rank: 1,
        emptyBlocks: 0,
        slug: "universe-pool",
        avgMatchRate: 99.2,
        avgFeeDelta: "0.004",
        poolUniqueId: 111,
      },
      {
        poolId: 112,
        name: "Orbit Mining",
        link: "",
        blockCount: 188,
        rank: 2,
        emptyBlocks: 1,
        slug: "orbit-mining",
        avgMatchRate: 98.6,
        avgFeeDelta: "0.006",
        poolUniqueId: 112,
      },
    ],
    blockCount: 402,
    lastEstimatedHashrate: 812_004_881_002_991_000_000,
  },

  // The mining dashboard's hashrate and difficulty panels.
  //
  // Without these the right half of the Mining route rendered as skeletons and
  // a spinner in every screenshot, so half of one of the thirteen reviewed
  // routes was never reviewed at all.
  "/api/v1/mining/hashrate/3d": buildHashrateSeries(),
  "/api/v1/mining/hashrate/1w": buildHashrateSeries(),
  "/api/v1/mining/hashrate/1m": buildHashrateSeries(),
  "/api/v1/mining/hashrate": buildHashrateSeries(),
  "/api/v1/mining/difficulty-adjustments/1y": buildDifficultyAdjustments(),
  "/api/v1/mining/difficulty-adjustments": buildDifficultyAdjustments(),

  "/api/v1/universe/protocols": {
    registryVersion: "2026.08.1",
    protocols: [
      {
        protocolId: "ordinals",
        displayName: "Ordinals",
        chain: "bitcoin",
        family: "inscriptions",
        releaseStatus: "production_verified",
        authority: "ord 0.29",
        coverage: { fromHeight: 767_430, toHeight: 887_412 },
      },
      {
        protocolId: "runes",
        displayName: "Runes",
        chain: "bitcoin",
        family: "fungible",
        releaseStatus: "production_verified",
        authority: "ord 0.29",
        coverage: { fromHeight: 840_000, toHeight: 887_412 },
      },
      {
        protocolId: "alkanes",
        displayName: "Alkanes",
        chain: "bitcoin",
        family: "contracts",
        releaseStatus: "verified_read_only",
        authority: "metashrew",
        coverage: { fromHeight: 880_000, toHeight: 887_412 },
      },
      {
        protocolId: "stamps",
        displayName: "Stamps",
        chain: "bitcoin",
        family: "inscriptions",
        releaseStatus: "experimental",
        authority: "stampchain",
        coverage: { fromHeight: 779_652, toHeight: 886_900 },
      },
      {
        protocolId: "atomicals",
        displayName: "Atomicals",
        chain: "bitcoin",
        family: "fungible",
        releaseStatus: "blocked",
        authority: null,
        coverage: null,
      },
      // The ANIMA entry in the registry contract's own shape, so the
      // protocol page for it renders as the real page will.
      {
        schemaVersion: "universe-explorer-protocol-v1",
        id: "anima",
        aliases: [],
        displayName: "ANIMA",
        shortName: "ANIMA",
        family: "OTHER",
        chain: "bitcoin",
        networks: ["mainnet"],
        icon: "protocol-anima",
        visualToken: "protocol-anima",
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: "BLOCKED",
        indexerAuthority: "index-anima",
        coverage: "unknown",
      },
    ],
  },

  "/api/v1/universe/sources": {
    generatedAt: "2026-09-03T00:00:00.000Z",
    sources: [
      {
        authorityId: "ord-0.29",
        protocols: ["ordinals", "runes"],
        ready: true,
        status: "ready",
        checkpoint: {
          heightAtomic: "887412",
          blockHash: BLOCK_HASH,
          observedAt: "2026-09-03T00:00:00.000Z",
        },
        checkedAt: "2026-09-03T00:00:00.000Z",
        lagBlocks: "0",
        lastSuccessAt: "2026-09-03T00:00:00.000Z",
        consecutiveFailures: 0,
      },
      {
        authorityId: "index-anima",
        protocols: ["anima"],
        ready: true,
        status: "ready",
        checkpoint: {
          heightAtomic: "907144",
          blockHash:
            "000000000000000000012a4c5d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b",
          observedAt: "2026-09-03T00:00:00.000Z",
        },
        checkedAt: "2026-09-03T00:00:00.000Z",
        lagBlocks: "0",
        lastSuccessAt: "2026-09-03T00:00:00.000Z",
        consecutiveFailures: 0,
      },
    ],
  },

  // The release identity the /source page publishes.
  //
  // It arrives over the socket for the header, but the source page asks for it
  // over REST, and that route had no fixture. So the one page whose entire job
  // is to say which commit is running rendered with an empty release and an
  // empty backend in every screenshot, and nobody reviewing the matrix could
  // have seen that it works.
  "/api/v1/backend-info": {
    hostname: "universe-explorer",
    version: "3.3.1",
    gitCommit: "fixture0",
    lightning: false,
    backend: "electrum",
    coreVersion: "/Satoshi:31.0.0/",
  },

  "/api/v1/universe/pulse": {
    checked: 512,
    authorityAnswering: true,
    counts: { ordinals: 41, runes: 12, alkanes: 3, stamps: 0 },
  },

  // The ANIMA evidence explorer reads its own authority through the overlay.
  // The fixture carries the served documents the pages render, in the
  // authority's own field shapes.
  "/api/v1/anima/status": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    status: {
      network: "mainnet",
      activationHeight: 864_720,
      kindling: { start: 864_720, end: 868_751 },
      scanner: {
        tipHeight: 907_144,
        tipHash:
          "000000000000000000012a4c5d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b",
        nodeHeight: 907_144,
        reorgs: 2,
        blocksApplied: 42_424,
        syncing: false,
        lastError: null,
      },
      supply: {
        created: 3_412,
        live: 2_980,
        fused: 104,
        spawned: 210,
        retired: 88,
        burned: 30,
      },
    },
    loggedEventCountAtomic: "12_804".replace("_", ""),
    degradedReason: null,
  },
  "/api/v1/anima/events": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    total: 4,
    from: 0,
    events: [
      {
        eventId: "a907100:1",
        height: 907_100,
        txIndex: 1,
        txid: "1f2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef".slice(
          0,
          64,
        ),
        kind: "transfer",
        organisms: ["0aff"],
      },
      {
        eventId: "a907098:0",
        height: 907_098,
        txIndex: 0,
        txid: "2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef01".slice(
          0,
          64,
        ),
        kind: "waymark",
        organisms: ["0aff", "0b3e"],
      },
      {
        eventId: "a907090:2",
        height: 907_090,
        txIndex: 2,
        txid: "3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef0122".slice(
          0,
          64,
        ),
        kind: "achieve",
        organisms: ["0b3e"],
      },
      {
        eventId: "a907081:0",
        height: 907_081,
        txIndex: 0,
        txid: "4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef01233".slice(
          0,
          64,
        ),
        kind: "genesis",
        organisms: ["0c7d"],
      },
    ],
    degradedReason: null,
  },
  "/api/v1/anima/organisms": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    total: 3,
    offset: 0,
    limit: 50,
    organisms: [
      {
        id: "0aff",
        genesisTxid:
          "1f2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef",
        genesisVout: 0,
        genome: "aa55aa55",
        spec: "a-1",
        meta: null,
        vessel: null,
        status: "alive",
        createdHeight: 907_081,
        generationZero: true,
        origin: "genesis",
        parents: [],
        children: [],
        waymarkSeq: 1,
        waymarks: [],
        achievements: [],
        transferCount: 4,
        endedHeight: null,
        endedTxid: null,
      },
      {
        id: "0b3e",
        genesisTxid:
          "2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef01".slice(
            0,
            64,
          ),
        genesisVout: 1,
        genome: "bb66bb66",
        spec: "a-1",
        meta: null,
        vessel: null,
        status: "fused",
        createdHeight: 899_212,
        generationZero: false,
        origin: "fuse",
        parents: ["0aff"],
        children: [],
        waymarkSeq: 3,
        waymarks: [],
        achievements: [],
        transferCount: 9,
        endedHeight: 906_402,
        endedTxid: null,
      },
      {
        id: "0c7d",
        genesisTxid:
          "3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef0122".slice(
            0,
            64,
          ),
        genesisVout: 0,
        genome: "cc77cc77",
        spec: "a-2",
        meta: null,
        vessel: null,
        status: "retired",
        createdHeight: 890_004,
        generationZero: false,
        origin: "spawn",
        parents: [],
        children: ["0aff"],
        waymarkSeq: 0,
        waymarks: [],
        achievements: [],
        transferCount: 2,
        endedHeight: 902_118,
        endedTxid: null,
      },
    ],
    degradedReason: null,
  },
  "/api/v1/anima/events/a907098%3A0": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    event: {
      eventId: "a907098:0",
      height: 907_098,
      txIndex: 0,
      txid: "2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef01".slice(
        0,
        64,
      ),
      kind: "waymark",
      organisms: ["0aff", "0b3e"],
    },
    degradedReason: null,
  },
  "/api/v1/anima/organisms/0aff": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    organism: {
      id: "0aff",
      genesisTxid:
        "1f2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef",
      genesisVout: 0,
      genome: "aa55aa55",
      spec: "a-1",
      meta: null,
      vessel: null,
      status: "alive",
      createdHeight: 907_081,
      generationZero: true,
      origin: "genesis",
      parents: [],
      children: [],
      waymarkSeq: 1,
      waymarks: [],
      achievements: [],
      transferCount: 4,
      endedHeight: null,
      endedTxid: null,
    },
    degradedReason: null,
  },
  "/api/v1/anima/organisms/0aff/history": {
    schemaVersion: "universe-anima-v1",
    authorityId: "index-anima",
    state: "served",
    organism: {
      id: "0aff",
      genesisTxid:
        "1f2e3d4c5b6a79880123456789abcdef0123456789abcdef0123456789abcdef",
      genesisVout: 0,
      genome: "aa55aa55",
      spec: "a-1",
      meta: null,
      vessel: null,
      status: "alive",
      createdHeight: 907_081,
      generationZero: true,
      origin: "genesis",
      parents: [],
      children: [],
      waymarkSeq: 1,
      waymarks: [],
      achievements: [],
      transferCount: 4,
      endedHeight: null,
      endedTxid: null,
    },
    lineage: {
      id: "0aff",
      parents: [],
      children: [],
      ancestors: [],
      descendants: [],
    },
    degradedReason: null,
  },
};

/**
 * A confirmed transaction, its status, and the block it landed in.
 *
 * Shaped so the detail page has something real to lay out: several inputs, a
 * payment output and a change output, and a fee that matches the difference.
 */
export const detailFixtures = {
  // The dashboard asks for fixed neighbouring windows while checking reduced
  // motion. Keep those exact requests deterministic instead of permitting a
  // broad prefix fallback that could hide a new endpoint.
  "/api/v1/blocks/887400": fixtures["/api/v1/blocks"],
  "/api/v1/blocks/887410": fixtures["/api/v1/blocks"],
  [`/api/tx/${TXID_A}`]: buildTransaction(),
  [`/api/tx/${TXID_A}/status`]: {
    confirmed: true,
    block_height: 887_412,
    block_hash: BLOCK_HASH,
    block_time: 1_772_100_000,
  },
  [`/api/tx/${TXID_A}/outspends`]: [{ spent: false }, { spent: false }],
  [`/api/v1/tx/${TXID_A}/rbf`]: { replacements: null, replaces: [] },
  [`/api/v1/tx/${TXID_A}/cached`]: null,
  [`/api/block/${BLOCK_HASH}`]: fixtures["/api/v1/blocks"][0],
  [`/api/block/${BLOCK_HASH}/txids`]: [TXID_A, TXID_B, TXID_C],
  [`/api/v1/block/${BLOCK_HASH}/summary`]: buildBlockSummary(),
  [`/api/block/${BLOCK_HASH}/txs/0`]: buildBlockPage(),
  [`/api/v1/block/${BLOCK_HASH}`]: fixtures["/api/v1/blocks"][0],
  "/api/v1/universe/blocks/887412/inscriptions": {
    schemaVersion: "universe-asset-lookup-v1",
    status: "ok",
    authorityId: "ord-0.29",
    checkpoint: BITCOIN_CHECKPOINT,
    value: {
      ids: [`${TXID_C}i0`],
      more: false,
    },
  },

  // The second block on the chain strip, answered as fully as the first.
  //
  // The block page asks for the neighbouring block's transactions, and only
  // the first block was pinned, so that request fell through to the empty-list
  // fallback and one skeleton on the page waited for it forever. It is the
  // same class of gap as the address sub-routes: a prefix match that answers
  // with the wrong thing, or nothing, keeps a page in a loading state that no
  // screenshot can distinguish from a slow one.
  [`/api/block/${TXID_B}`]: fixtures["/api/v1/blocks"][1],
  [`/api/v1/block/${TXID_B}`]: fixtures["/api/v1/blocks"][1],
  [`/api/block/${TXID_B}/txids`]: [TXID_C, TXID_A],
  [`/api/block/${TXID_B}/txs/0`]: buildBlockPage(),
  [`/api/v1/block/${TXID_B}/summary`]: buildBlockSummary(),
  "/api/txs/outspends": [[{ spent: false }, { spent: false }]],
  [`/api/v1/cpfp/${TXID_A}`]: {
    ancestors: [],
    descendants: [],
    bestDescendant: null,
    effectiveFeePerVsize: 19.7,
    sigops: 2,
    adjustedVsize: 209,
  },
  "/api/v1/historical-price": {
    prices: [{ time: 1_772_100_000, USD: 96_400 }],
    exchangeRates: {
      USDEUR: 0.92,
      USDGBP: 0.79,
      USDCAD: 1.36,
      USDCHF: 0.88,
      USDAUD: 1.5,
      USDJPY: 155,
    },
  },
  "/api/v1/mining/pools/1m": fixtures["/api/v1/mining/pools/1w"],
  // The Universe authority answers for this transaction: one proven output
  // position, so the flow has something real to lay out rather than only
  // ever being reviewed in its empty state.
  [`/api/v1/universe/transactions/${TXID_A}`]: {
    txid: TXID_A,
    status: "confirmed",
    complete: true,
    coinbase: false,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
    inputs: [
      {
        vout: 0,
        asset: {
          protocolId: "runes",
          assetId: "UNIVERSE.RUNE",
          name: "UNIVERSE",
        },
        quantityAtomic: "125000000000",
        valueSatsAtomic: "1200000",
        ownerAddress: ADDRESS,
        evidence: { authorityId: "ord 0.29", coverage: "complete" },
      },
    ],
    outputs: [
      {
        vout: 0,
        asset: {
          protocolId: "runes",
          assetId: "UNIVERSE.RUNE",
          name: "UNIVERSE",
        },
        quantityAtomic: "100000000000",
        valueSatsAtomic: "1500000",
        ownerAddress: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
        evidence: { authorityId: "ord 0.29", coverage: "complete" },
      },
      {
        vout: 1,
        asset: {
          protocolId: "runes",
          assetId: "UNIVERSE.RUNE",
          name: "UNIVERSE",
        },
        quantityAtomic: "25000000000",
        valueSatsAtomic: "395884",
        ownerAddress: ADDRESS,
        evidence: { authorityId: "ord 0.29", coverage: "complete" },
      },
    ],
    actions: [
      {
        protocolId: "runes",
        actionType: "transfer",
        asset: {
          protocolId: "runes",
          assetId: "UNIVERSE.RUNE",
          name: "UNIVERSE",
        },
        quantityAtomic: "100000000000",
      },
    ],
    sourceEvidence: [
      {
        authorityId: "ord 0.29",
        coverage: "complete",
        checkpoint: { heightAtomic: "887412" },
      },
    ],
  },
  "/api/v1/mining/hashrate/3d": {
    hashrates: [{ timestamp: 1_772_000_000, avgHashrate: 8.1e20 }],
    difficulty: [
      { timestamp: 1_772_000_000, difficulty: 1.1e14, height: 887_000 },
    ],
    currentHashrate: 8.12e20,
    currentDifficulty: 1.105e14,
  },
  "/api/v1/mining/reward-stats/144": {
    startBlock: 887_268,
    endBlock: 887_412,
    totalReward: "46_800_000_000".replace(/_/g, ""),
    totalFee: "1_400_000_000".replace(/_/g, ""),
    totalTx: "412_004".replace(/_/g, ""),
  },
  "/api/v1/mining/blocks/fees/1w": [
    { avgHeight: 887_000, timestamp: 1_772_000_000, avgFees: 12_884_901 },
  ],
  "/api/v1/difficulty-adjustments/1m": [[1_772_000_000, 887_000, 1.1e14, 3.18]],
};

/** Address with history, and its transactions. */
/**
 * The address page, and every sub-route it asks for.
 *
 * Only the summary used to be pinned. The harness falls back to a prefix match,
 * so `/api/address/<addr>/txs` matched the summary's key and was answered with
 * the summary object. The page called forEach on it, threw, and rendered its
 * error state in every screenshot the matrix has ever taken, which is how one
 * of the thirteen reviewed routes was never actually reviewed. Each sub-route
 * is pinned explicitly now, and each returns the shape its caller expects.
 */
export const addressFixtures = {
  [`/api/address/${ADDRESS}`]: {
    address: ADDRESS,
    chain_stats: {
      funded_txo_count: 42,
      funded_txo_sum: 184_002_881,
      spent_txo_count: 38,
      spent_txo_sum: 171_004_002,
      tx_count: 51,
    },
    mempool_stats: {
      funded_txo_count: 1,
      funded_txo_sum: 220_000,
      spent_txo_count: 0,
      spent_txo_sum: 0,
      tx_count: 1,
    },
  },
  [`/api/address/${ADDRESS}/txs`]: [buildTransaction()],
  [`/api/address/${ADDRESS}/txs/chain`]: [buildTransaction()],
  [`/api/address/${ADDRESS}/txs/mempool`]: [],
  [`/api/address/${ADDRESS}/txs/summary`]: [
    { txid: TXID_A, height: 887_412, time: 1_772_100_000, value: 1_500_000 },
    { txid: TXID_B, height: 887_411, time: 1_772_099_400, value: -220_000 },
  ],
  [`/api/address/${ADDRESS}/utxo`]: [
    {
      txid: TXID_A,
      vout: 0,
      value: 1_500_000,
      status: {
        confirmed: true,
        block_height: 887_412,
        block_hash: BLOCK_HASH,
        block_time: 1_772_100_000,
      },
    },
    { txid: TXID_B, vout: 1, value: 220_000, status: { confirmed: false } },
  ],
  "/api/v1/universe/outpoints/batch": {
    results: [
      {
        outpoint: `${TXID_A}:0`,
        status: "ok",
        positions: [
          {
            outpoint: `${TXID_A}:0`,
            vout: 0,
            valueSatsAtomic: "1500000",
            asset: {
              protocolId: "runes",
              assetId: "UNIVERSE.RUNE",
              displayName: "UNIVERSE",
              ticker: "UNI",
              assetKind: "fungible",
            },
            quantityAtomic: "100000000000",
            ownerAddress: ADDRESS,
            state: "proven",
            evidence: {
              authorityId: "ord-0.29",
              protocolId: "runes",
              coverage: "complete",
              checkpoint: BITCOIN_CHECKPOINT,
            },
          },
        ],
        coveredProtocolIds: ["ordinals", "runes"],
        unknownAttachments: false,
        checkpoint: BITCOIN_CHECKPOINT,
      },
      {
        outpoint: `${TXID_B}:1`,
        status: "ok",
        positions: [],
        coveredProtocolIds: ["ordinals", "runes"],
        unknownAttachments: false,
        checkpoint: BITCOIN_CHECKPOINT,
      },
    ],
  },
};

function failClosedProductFixture(family) {
  return {
    __qaHttpResponse: {
      status: 503,
      body: {
        error: "qa-product-authority-unavailable",
        family,
      },
    },
  };
}

function buildPulseFlow(txid, protocolId, actionType) {
  const authorityId = protocolId === "alkanes" ? "metashrew" : "ord-0.29";
  return {
    schemaVersion: "universe-transaction-flow-v1",
    chain: "bitcoin",
    network: "mainnet",
    txid,
    status: "mempool-candidate",
    checkpoint: null,
    coinbase: false,
    inputs: [],
    outputs: [],
    actions: [
      {
        eventId: `${protocolId}:${txid.slice(0, 12)}`,
        protocolId,
        actionType,
        inputOutpoints: [],
        outputOutpoints: [],
        evidence: {
          authorityId,
          protocolId,
          coverage: "complete",
          checkpoint: BITCOIN_CHECKPOINT,
        },
      },
    ],
    sourceEvidence: [],
    complete: true,
    unknownAttachmentCount: 0,
    outOfCoverageCount: 0,
  };
}

/**
 * States the matrix has to prove beyond the populated one. Each entry maps a
 * URL pattern to a response, so a run can assert that the interface says
 * something true when the answer is missing rather than showing a confident
 * zero.
 */
/**
 * The contents of the sample block, in the shape the Lens draws from.
 *
 * This was an empty array, so the block detail page rendered the product's
 * signature view as a blank rectangle in every screenshot and the one thing
 * worth reviewing there went unreviewed. Sized and spread like a real block:
 * a long tail of small transactions, a few large ones, and a spread of fee
 * rates so the colour scale is actually exercised.
 */
/**
 * One page of a block's transactions.
 *
 * This returned a single transaction for a block that declares three thousand
 * of them, so the list component asked for the page, got less than a page
 * back, and sat in its skeleton waiting for the rest. A screenshot cannot tell
 * that apart from a slow request, which is why it survived every review.
 *
 * A full page, with distinct ids so the rows are not all the same transaction.
 */
function buildBlockPage() {
  const base = buildTransaction();
  return Array.from({ length: 25 }, (_, i) => ({
    ...base,
    txid: (i + 1).toString(16).padStart(4, "0").repeat(16).slice(0, 64),
  }));
}

function buildBlockSummary() {
  const txs = [];
  for (let i = 0; i < 1800; i++) {
    const big = i % 89 === 0;
    const vsize = big ? 2400 + (i % 13) * 380 : 141 + (i % 19) * 22;
    const rate = 1 + ((i * 11) % 58) + (big ? 9 : 0);
    txs.push({
      txid: i.toString(16).padStart(8, "0").repeat(8).slice(0, 64),
      fee: Math.round(rate * vsize),
      vsize,
      value: 40_000 + (i % 61) * 85_000,
      rate,
      flags: i % 11 === 0 ? 2 : 0,
      time: 1_772_099_000 - (i % 800),
    });
  }
  return txs;
}

export const stateOverrides = {
  // Every Universe authority call fails. The interface must say it could not
  // reach the authority, and must not report "0 protocols" as if that were an
  // answer.
  "authority-down": {
    "/api/v1/universe/protocols": { status: 502 },
    "/api/v1/universe/pulse": { status: 502 },
  },

  // The registry answers, but with nothing in it.
  "authority-empty": {
    "/api/v1/universe/protocols": {
      body: { registryVersion: "2026.08.1", protocols: [] },
    },
  },

  // Core chain data is unavailable.
  "chain-down": {
    "/api/v1/fees/recommended": { status: 502 },
    "/api/v1/blocks": { status: 502 },
    "/api/v1/difficulty-adjustment": { status: 502 },
  },

  // The node this explorer reads is still catching up. Nothing here is wrong,
  // but a large part of the chain is not available yet and the interface has to
  // say so rather than presenting a months-old tip as the present. This state
  // carries no REST override: it is expressed through the socket, in
  // socketState() in capture.mjs, because that is where backendInfo arrives.
  "catching-up": {},

  // Requests never resolve, so every surface stays in its loading state.
  loading: { "**": { hang: true } },

  // The address resolves, its transactions do not.
  //
  // The address page has two independent waits, and the blanket `loading`
  // fixture above can only ever photograph the first: with every request held
  // open the page never gets past `isLoadingAddress`, so the branch that waits
  // for the transaction list, the one a reader actually meets on a slow page
  // or when they ask for more, was never on screen for any check to see. This
  // fixture answers the summary and holds only the transaction request, which
  // is the state pagination and "load more" leave behind.
  //
  // The harness falls back to a prefix match, so this reaches the whole
  // `/txs` subtree. That is the intent: every route that feeds the transaction
  // list waits, and nothing else does.
  "address-txs-loading": {
    [`/api/address/${ADDRESS}/txs`]: { hang: true },
  },

  // An address that has never been used.
  "address-empty": {
    [`/api/address/${ADDRESS}`]: {
      body: {
        address: ADDRESS,
        chain_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      },
    },
    [`/api/address/${ADDRESS}/txs`]: { body: [] },
  },
};

export const sampleIds = { TXID_A, TXID_B, TXID_C, ADDRESS, BLOCK_HASH };

/**
 * Network hashrate and difficulty over time, in the shape the mining charts
 * expect: a hashrate point per day and a difficulty point per retarget.
 *
 * The numbers are the right order of magnitude for the network, so the axis
 * formats into EH/s rather than collapsing to zero the way the mempool series
 * used to.
 */
function buildHashrateSeries() {
  const now = Math.floor(Date.now() / 1000);
  const hashrates = [];
  const difficulty = [];
  for (let day = 90; day >= 0; day--) {
    const drift = Math.sin(day / 11) * 0.06 + Math.cos(day / 5) * 0.02;
    hashrates.push({
      timestamp: now - day * 86_400,
      avgHashrate: Math.round(812_004_881_002_991_000_000 * (1 + drift)),
    });
    if (day % 14 === 0) {
      difficulty.push({
        timestamp: now - day * 86_400,
        difficulty: Math.round(110_568_428_300_952 * (1 + drift / 3)),
        height: 964_000 - day * 144,
        adjustment: Number((drift * 12).toFixed(2)),
      });
    }
  }
  return {
    hashrates,
    difficulty,
    currentHashrate: hashrates[hashrates.length - 1].avgHashrate,
    currentDifficulty: difficulty[difficulty.length - 1].difficulty,
  };
}

/** Retarget history, newest first, as the difficulty chart reads it. */
function buildDifficultyAdjustments() {
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: 26 }, (_, i) => [
    now - i * 14 * 86_400,
    964_000 - i * 2016,
    110_568_428_300_952 * (1 - i * 0.004),
    Number((Math.sin(i / 3) * 3).toFixed(2)),
  ]);
}

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
      // One band per fee level, in vBytes, summing to roughly the
      // mempool_byte_weight above.
      //
      // These used to be single-digit thousands of vBytes in total, which is
      // four orders of magnitude below a real mempool. Two things followed from
      // that, and both of them defeated the point of the fixture: every y axis
      // label rounded to "0 MvB", and the bands were too small to resolve, so
      // the most colour-dense surface in the product rendered as one flat area
      // and its palette was never actually reviewed.
      //
      // The shape is unchanged. Only the scale is real now: a fat low-fee tail
      // thinning out towards the high-fee bands, which is what a mempool
      // between blocks actually looks like.
      vsizes: Array.from({ length: 38 }, (_, band) =>
        Math.round(Math.max(0, 900 - band * 22 + drift) * 6_000),
      ),
    });
  }
  return points;
}

/**
 * One transaction, in the shape the detail page expects.
 *
 * Two inputs and two outputs so the flow has a real payment and a real change
 * output rather than a single-line stub, and a fee that is genuinely the
 * difference between the two sides.
 */
function buildTransaction() {
  const vin = [
    {
      txid: TXID_B,
      vout: 0,
      is_coinbase: false,
      scriptsig: "",
      scriptsig_asm: "",
      sequence: 4_294_967_293,
      prevout: {
        scriptpubkey: "0014a1b2",
        scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 a1b2",
        scriptpubkey_type: "v0_p2wpkh",
        scriptpubkey_address: ADDRESS,
        value: 1_200_000,
      },
      witness: ["3045", "02a1"],
      inner_redeemscript_asm: "",
      inner_witnessscript_asm: "",
      is_pegin: false,
    },
    {
      txid: TXID_C,
      vout: 1,
      is_coinbase: false,
      scriptsig: "",
      scriptsig_asm: "",
      sequence: 4_294_967_293,
      prevout: {
        scriptpubkey: "0014c3d4",
        scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 c3d4",
        scriptpubkey_type: "v0_p2wpkh",
        scriptpubkey_address:
          "bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cg6d3tg6axemvljvt2k76zs50tv4q",
        value: 700_004,
      },
      witness: ["3044", "02b2"],
      inner_redeemscript_asm: "",
      inner_witnessscript_asm: "",
      is_pegin: false,
    },
  ];
  const vout = [
    {
      scriptpubkey: "0014e5f6",
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 e5f6",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      value: 1_500_000,
    },
    {
      scriptpubkey: "0014a1b2",
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 a1b2",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: ADDRESS,
      value: 395_884,
    },
  ];
  const inSum = vin.reduce((t, i) => t + i.prevout.value, 0);
  const outSum = vout.reduce((t, o) => t + o.value, 0);
  return {
    txid: TXID_A,
    version: 2,
    locktime: 0,
    vin,
    vout,
    size: 372,
    weight: 837,
    sigops: 2,
    fee: inSum - outSum,
    status: {
      confirmed: true,
      block_height: 887_412,
      block_hash: BLOCK_HASH,
      block_time: 1_772_100_000,
    },
  };
}
