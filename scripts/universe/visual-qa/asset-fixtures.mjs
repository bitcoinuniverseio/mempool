// Fixtures for the Universe asset pages and the page that remembers them.
//
// The outpoint page, the three asset lookups, and the local-state page are
// Universe-authored routes the matrix never looked at either. They answer the
// overlay's asset endpoints rather than the base chain API, which is why they
// live here and not in fixtures.mjs.

import { chainSampleIds } from './chain-fixtures.mjs';

const INSCRIPTION_TXID =
  '8d2f6b0e4a8c2f6b0d4a8c2e6f0b4d8a2c6e0f4b8d2a6c0e4f8b2d6a0c4e8f2b';
const INSCRIPTION_ID = `${INSCRIPTION_TXID}i0`;
const RUNE_NAME = 'UNIVERSE';
const SAT_NUMBER = '1905130000000000';
const OUTPOINT_TXID =
  '2c6e0f4b8d2a6c0e4f8b2d6a0c4e8f2b6d0a4c8e2f6b0d4a8c2e6f0b4d8a2c6e';
const OWNER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

/** The evidence block every asset lookup carries. */
const CHECKPOINT = {
  chain: 'bitcoin',
  network: 'mainnet',
  heightAtomic: '887412',
  blockHash:
    '00000000000000000002a7c4c1e8b7d3f9a5c2e6b0d4f8a1c5e9b3d7f1a5c9e3',
  reorgEpoch: '0',
  observedAt: '2026-08-29T04:00:00.000Z',
};

export const assetFixtures = {
  [`/api/v1/universe/outpoints/${OUTPOINT_TXID}/1`]: {
    outpoint: `${OUTPOINT_TXID}:1`,
    status: 'ok',
    coveredProtocolIds: ['ordinals', 'runes', 'rare_sats'],
    unknownAttachments: false,
    checkpoint: CHECKPOINT,
    positions: [
      {
        outpoint: `${OUTPOINT_TXID}:1`,
        vout: 1,
        valueSatsAtomic: '10000',
        asset: {
          protocolId: 'runes',
          assetId: '887000:12',
          displayName: 'UNIVERSE',
          ticker: 'UNI',
          assetKind: 'fungible',
        },
        quantityAtomic: '100000000000',
        ownerAddress: OWNER,
        state: 'proven',
        evidence: {
          authorityId: 'ord',
          protocolId: 'runes',
          coverage: 'complete',
          checkpoint: CHECKPOINT,
        },
      },
      {
        outpoint: `${OUTPOINT_TXID}:1`,
        vout: 1,
        valueSatsAtomic: '10000',
        asset: {
          protocolId: 'ordinals',
          assetId: INSCRIPTION_ID,
          displayName: 'Inscription 74,120,884',
          assetKind: 'inscription',
        },
        notableSats: [
          { satAtomic: SAT_NUMBER, rarity: 'uncommon', heightAtomic: '840000' },
        ],
        notableSatsTruncated: false,
        ownerAddress: OWNER,
        state: 'proven',
        evidence: {
          authorityId: 'ord',
          protocolId: 'ordinals',
          coverage: 'complete',
          checkpoint: CHECKPOINT,
        },
      },
    ],
  },

  [`/api/v1/universe/inscriptions/${INSCRIPTION_ID}`]: {
    schemaVersion: 'universe-asset-lookup-v1',
    status: 'ok',
    authorityId: 'ord',
    checkpoint: CHECKPOINT,
    value: {
      id: INSCRIPTION_ID,
      numberAtomic: '74120884',
      address: OWNER,
      contentType: 'image/svg+xml',
      contentLengthAtomic: '4182',
      heightAtomic: '884120',
      feeAtomic: '12400',
      valueAtomic: '10000',
      satAtomic: SAT_NUMBER,
      satpoint: `${OUTPOINT_TXID}:1:0`,
      timestampAtomic: '1772000000',
      charms: [],
      parents: [],
      childCountAtomic: '0',
      rune: null,
      metaprotocol: null,
    },
  },

  [`/api/v1/universe/runes/${RUNE_NAME}`]: {
    schemaVersion: 'universe-asset-lookup-v1',
    status: 'ok',
    authorityId: 'ord',
    checkpoint: CHECKPOINT,
    value: {
      id: '887000:12',
      spacedRune: 'UNIVERSE',
      rune: RUNE_NAME,
      symbol: 'U',
      divisibilityAtomic: '8',
      blockAtomic: '887000',
      numberAtomic: '412',
      mintsAtomic: '18422',
      burnedAtomic: '0',
      premineAtomic: '2100000000000000',
      etchingTxid: OUTPOINT_TXID,
      timestampAtomic: '1771800000',
      turbo: true,
      mintable: true,
      terms: {
        amountAtomic: '100000000000',
        capAtomic: '21000',
        heightStartAtomic: '887000',
        heightEndAtomic: '900000',
        offsetStartAtomic: null,
        offsetEndAtomic: null,
      },
      parentInscriptionId: null,
    },
  },

  [`/api/v1/universe/sats/${SAT_NUMBER}`]: {
    schemaVersion: 'universe-asset-lookup-v1',
    status: 'ok',
    authorityId: 'ord',
    checkpoint: CHECKPOINT,
    value: {
      numberAtomic: SAT_NUMBER,
      rarity: 'uncommon',
      name: 'gjmbctuywsb',
      decimal: '840000.0',
      degree: '1.4.18',
      percentile: '90.7301%',
      blockAtomic: '840000',
      cycleAtomic: '1',
      epochAtomic: '4',
      periodAtomic: '416',
      offsetAtomic: '0',
      timestampAtomic: '1713571767',
      satpoint: `${OUTPOINT_TXID}:1:0`,
      address: OWNER,
      inscriptions: [INSCRIPTION_ID],
    },
  },
};

/**
 * What a browser that has used the explorer remembers.
 *
 * The saved page has two quite different faces, an empty one and a populated
 * one, and only the empty one appears without this. It is seeded through
 * localStorage rather than through a request, because that is where the state
 * actually lives: nothing on this page was ever sent to a server.
 *
 * The instant is fixed rather than relative to the run, so the screenshot of
 * this page is the same every time.
 */
const SAVED_AT = Date.parse('2026-08-29T03:30:00.000Z');

export const savedStorageSeed = {
  'universe.bookmarks.v2': [
    {
      chain: 'bitcoin',
      network: 'mainnet',
      kind: 'transaction',
      value: '9f4a1c7e5b2d8036a1f4c9e7b3d5081a2c6e4f9b7d3a1c58e26f0b4d9a7c3e15',
      path: '/tx/9f4a1c7e5b2d8036a1f4c9e7b3d5081a2c6e4f9b7d3a1c58e26f0b4d9a7c3e15',
      label: 'Transaction 9f4a1c7e',
      at: SAVED_AT,
    },
    {
      chain: 'dogecoin',
      network: 'mainnet',
      kind: 'address',
      value: chainSampleIds.DOGE_ADDRESS,
      path: `/dogecoin/address/${chainSampleIds.DOGE_ADDRESS}`,
      label: `Dogecoin address ${chainSampleIds.DOGE_ADDRESS}`,
      at: SAVED_AT - 600_000,
    },
    {
      chain: 'zcash',
      network: 'mainnet',
      kind: 'transaction',
      value: chainSampleIds.ZEC_TXID,
      path: `/zcash/tx/${chainSampleIds.ZEC_TXID}`,
      label: `Zcash transaction ${chainSampleIds.ZEC_TXID}`,
      at: SAVED_AT - 1_800_000,
    },
  ],
  'universe.recent.v2': [
    {
      chain: 'dogecoin',
      network: 'mainnet',
      kind: 'block',
      value: chainSampleIds.DOGE_BLOCK,
      path: `/dogecoin/block/${chainSampleIds.DOGE_BLOCK}`,
      label: `Dogecoin block ${chainSampleIds.DOGE_BLOCK}`,
      at: SAVED_AT - 120_000,
    },
    {
      chain: 'bitcoin',
      network: 'mainnet',
      kind: 'outpoint',
      value: `${OUTPOINT_TXID}:1`,
      path: `/outpoint/${OUTPOINT_TXID}/1`,
      label: 'Output 2c6e0f4b:1',
      at: SAVED_AT - 300_000,
    },
  ],
  'universe.preferences.v2': {
    pinnedProtocols: ['runes', 'ordinals'],
    animatePulse: true,
    selectedChain: 'bitcoin',
  },
};

export const assetSampleIds = {
  INSCRIPTION_ID,
  RUNE_NAME,
  SAT_NUMBER,
  OUTPOINT_TXID,
};
