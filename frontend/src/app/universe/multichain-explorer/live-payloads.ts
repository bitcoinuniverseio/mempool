/**
 * Payloads captured from the live public origin, not written by hand.
 *
 * https://explorer.bitcoinuniverse.io at 2026-08-29T08:26Z, release
 * mempool-8f6005ae0, overlay backend-apis-d1b34dbd. Only the pending
 * transaction lists are trimmed, to four and five entries; nothing else is
 * edited, reordered or tidied.
 *
 * They are here because the hand-written fixtures encoded what the API was
 * expected to send and the real thing differs in ways that changed the
 * design. Three of them, each found by these payloads and not by the
 * fixtures:
 *
 *   - the pending list carries whole transaction envelopes, not summary rows,
 *     so a generic table spent three of its seven columns on schemaVersion,
 *     chain and network, identical in every row;
 *   - Zcash reports no fee amount on a pending transaction at all, because a
 *     shielded transaction's fee cannot be read from its transparent side, and
 *     reports ZIP-317 logical actions instead;
 *   - the capability envelope names TAP on Doge `tap_doge` while the API
 *     serves it at `/protocols/doge-tap`, and reports `dunes`, which this
 *     explorer has no page for.
 *
 * Refresh them by re-capturing from the same endpoints. They are a record of
 * a shape, so a refresh that changes one is a finding rather than a chore.
 */

export const LIVE_PAYLOADS = {
  dogecoinStatus: {
    schemaVersion: 'universe-chain-capability-v1',
    chain: 'dogecoin',
    network: 'mainnet',
    asset: {
      symbol: 'DOGE',
      name: 'Dogecoin',
      precision: 8,
      atomicUnit: 'koinu'
    },
    ready: false,
    tip: {
      heightAtomic: '6351906',
      blockHash: '648c241e0a6602ebae1b6e589a228cd5b3e60d6988423343f6dae74216779576',
      observedAt: '2026-08-29T08:27:13.782Z'
    },
    sync: {
      state: 'degraded',
      initialBlockDownload: false,
      progressDecimal: null,
      updatedAt: '2026-08-29T08:27:13.782Z'
    },
    mempool: {
      supported: true,
      state: 'ready',
      completeness: 'complete',
      snapshotId: 'dogecoin-mainnet-125515f9916eb54b416b2ace409554db',
      sequenceAtomic: '1554',
      observedAt: '2026-08-29T08:27:13.782Z'
    },
    reads: {
      transaction: true,
      block: true,
      address: true,
      outpoint: true,
      feeEstimates: true,
      projectedBlocks: false
    },
    protocols: [
      {
        protocolId: 'doginals',
        state: 'unavailable',
        coverage: 'unavailable',
        updatedAt: null,
        lagBlocksAtomic: null,
        degradedReasons: [
          'authority-capability-disabled'
        ]
      },
      {
        protocolId: 'drc20',
        state: 'unavailable',
        coverage: 'unavailable',
        updatedAt: null,
        lagBlocksAtomic: null,
        degradedReasons: [
          'authority-capability-disabled'
        ]
      },
      {
        protocolId: 'tap_doge',
        state: 'degraded',
        coverage: 'unavailable',
        updatedAt: null,
        lagBlocksAtomic: null,
        degradedReasons: [
          'protocol-authority-unavailable'
        ]
      },
      {
        protocolId: 'dunes',
        state: 'unavailable',
        coverage: 'unavailable',
        updatedAt: null,
        lagBlocksAtomic: null,
        degradedReasons: [
          'authority-capability-disabled'
        ]
      }
    ],
    coverage: {
      confirmedHistory: 'unavailable',
      addressHistory: 'unavailable',
      protocolHistory: 'unavailable'
    },
    updatedAt: '2026-08-29T08:27:13.782Z',
    lagBlocksAtomic: null,
    degradedReasons: [
      'base-chain-authority-unavailable',
      'confirmed-history-authority-unavailable',
      'protocol-history-unavailable'
    ],
    release: {
      sha: 'development'
    }
  },
  zcashStatus: {
    schemaVersion: 'universe-chain-capability-v1',
    chain: 'zcash',
    network: 'mainnet',
    asset: {
      symbol: 'ZEC',
      name: 'Zcash',
      precision: 8,
      atomicUnit: 'zatoshi'
    },
    ready: false,
    tip: {
      heightAtomic: '3464548',
      blockHash: '000000000094e3f346dd672170a92ff16ad6e74694c9ffd43d72296e4bda42ab',
      observedAt: '2026-08-29T08:27:13.196Z'
    },
    sync: {
      state: 'degraded',
      initialBlockDownload: true,
      progressDecimal: null,
      updatedAt: '2026-08-29T08:27:13.790Z'
    },
    mempool: {
      supported: true,
      state: 'ready',
      completeness: 'complete',
      snapshotId: 'zcash-fcdd0365c79832b5d61484b5d0cc834e143ac771',
      sequenceAtomic: '57',
      observedAt: '2026-08-29T08:27:13.196Z'
    },
    reads: {
      transaction: true,
      block: true,
      address: true,
      outpoint: true,
      feeEstimates: true,
      projectedBlocks: false
    },
    protocols: [
      {
        protocolId: 'zerdinals',
        state: 'ready',
        coverage: 'complete',
        updatedAt: '2026-08-29T08:27:13.790Z',
        lagBlocksAtomic: '2',
        degradedReasons: []
      },
      {
        protocolId: 'zrunes',
        state: 'ready',
        coverage: 'complete',
        updatedAt: '2026-08-29T08:27:13.790Z',
        lagBlocksAtomic: '2',
        degradedReasons: []
      },
      {
        protocolId: 'zrc20',
        state: 'ready',
        coverage: 'complete',
        updatedAt: '2026-08-29T08:27:13.790Z',
        lagBlocksAtomic: '2',
        degradedReasons: []
      }
    ],
    coverage: {
      confirmedHistory: 'complete',
      addressHistory: 'complete',
      protocolHistory: 'complete'
    },
    updatedAt: '2026-08-29T08:27:13.196Z',
    lagBlocksAtomic: '2',
    degradedReasons: [],
    release: {
      sha: 'development'
    }
  },
  dogecoinMempool: {
    snapshot: {
      chain: 'dogecoin',
      network: 'mainnet',
      snapshotId: 'dogecoin-mainnet-125515f9916eb54b416b2ace409554db',
      sequenceAtomic: '1554',
      tip: {
        heightAtomic: '6351906',
        blockHash: '648c241e0a6602ebae1b6e589a228cd5b3e60d6988423343f6dae74216779576',
        observedAt: '2026-08-29T08:27:13.782Z'
      },
      initialBlockDownload: false,
      observedAt: '2026-08-29T08:27:13.782Z',
      completeness: 'complete'
    },
    transactions: [
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'dogecoin',
        network: 'mainnet',
        txid: '00d2039119ea4ecb7d026f4c89a84a908de826a3d68adc036f905dc574e0a4a7',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:26:53.779Z',
        observedAt: '2026-08-29T08:27:13.782Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '2751',
        fee: {
          amountAtomic: '10884900',
          rateDecimal: null,
          rateUnit: null
        },
        conflicts: [],
        replacement: null,
        expiry: null,
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: '1b6675e3f71d8bf44e8c3309c6f86d50d5bab1759d6647777959ee02d5887313:80',
              address: null,
              valueAtomic: '122645319284',
              scriptSigHex: '473044022053f94d02b596cf107085a79f4a6dd505110a7f7cd5c02260ee45c3d7d45bfc39022028de83441de3e8f2927cbec735f704e6cf9c875e7c1caf19663746cd2d7baa1e0121038981275966cee875fa3dc0c403aad7cd77f6fedd2e6d4488ab8f45a5e51c04cc',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f351ce53d9e6e808b183d40e1d30a679aa3b1ba087',
              spent: null
            },
            {
              indexAtomic: '1',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9149c877b266645cdbb0b22a86740b82b19465c40bd87',
              spent: null
            },
            {
              indexAtomic: '2',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144b13a115b62c2908b474d6fb1f72b993f75a2ebc87',
              spent: null
            },
            {
              indexAtomic: '3',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914e353e26d9aa368283b5e330fc8fd4addafe0d17987',
              spent: null
            },
            {
              indexAtomic: '4',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914519433b6d2bff4cdb965b4b4758dfc73c3ff1bf587',
              spent: null
            },
            {
              indexAtomic: '5',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9140bb0296f0e744fc0ff5e24bd037d0112a0b3ff5387',
              spent: null
            },
            {
              indexAtomic: '6',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914e4b311be790f5a84088158b574f041eb05a5113687',
              spent: null
            },
            {
              indexAtomic: '7',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9146e69f43c5d40e84b213eab57e01022105e4e02f887',
              spent: null
            },
            {
              indexAtomic: '8',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91416066f7c799f43cafa85550899356a32b11d687a87',
              spent: null
            },
            {
              indexAtomic: '9',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144ee9af04979865296f117189fdd28d105d92daf787',
              spent: null
            },
            {
              indexAtomic: '10',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914d314c510ba7d93c1e36c8df3259059c3101833cf87',
              spent: null
            },
            {
              indexAtomic: '11',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914ad3a7df5d5e66031961d49b0df2bfa590a1c336987',
              spent: null
            },
            {
              indexAtomic: '12',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144fad30104fa12d596fa2ee80f90c9a91a3627b9887',
              spent: null
            },
            {
              indexAtomic: '13',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914be3bc741874795b1f25e530d335d9ca6189d22ad87',
              spent: null
            },
            {
              indexAtomic: '14',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144f930025f9540c42ee6370ba27da98f86ffc42f987',
              spent: null
            },
            {
              indexAtomic: '15',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914ae0786d14929a5da804df259b2c62bfb28128d6b87',
              spent: null
            },
            {
              indexAtomic: '16',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9147ba26de4403ee1e298658afd64c3d8a76165cb7b87',
              spent: null
            },
            {
              indexAtomic: '17',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914fe7d364d6193fc1d3e1ced723f2cb7202b11838987',
              spent: null
            },
            {
              indexAtomic: '18',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91434616c7fd40a4256607b586fcbe644183e2bac9787',
              spent: null
            },
            {
              indexAtomic: '19',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9140111e815a3f7a62f3fe324739e0ea1470c27883a87',
              spent: null
            },
            {
              indexAtomic: '20',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91432e3de02856a9814aee166cb21bdacfa1ab5d7e787',
              spent: null
            },
            {
              indexAtomic: '21',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f9b8a0e13eaa5511c47743fecc13828cfd7df34887',
              spent: null
            },
            {
              indexAtomic: '22',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914aec8308026a6cd3d546ff5251aec750c621b8a8287',
              spent: null
            },
            {
              indexAtomic: '23',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914491b6304333bcc45bf6224a9e2a9ac1739fb650087',
              spent: null
            },
            {
              indexAtomic: '24',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914c15d1d600998b738f7de342e409f1115b5d8cfbf87',
              spent: null
            },
            {
              indexAtomic: '25',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9141767fc89c583518ba816d8b4ba00f1107a8e5b3e87',
              spent: null
            },
            {
              indexAtomic: '26',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9148efaffaee1d88bb5f3ca2664ec536b9057cd5fd687',
              spent: null
            },
            {
              indexAtomic: '27',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91477d8fc2319ad8e75f8a264b01bfd9581ac4c50f487',
              spent: null
            },
            {
              indexAtomic: '28',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91484e68cc0fd8785617d91d5dbe53e615b8ec7362787',
              spent: null
            },
            {
              indexAtomic: '29',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914121e246489354aa999dc99f0d7959989081499b487',
              spent: null
            },
            {
              indexAtomic: '30',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914b9bd3e9313405c5b53851a65cdd8b0adaa4c8a8a87',
              spent: null
            },
            {
              indexAtomic: '31',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914913577f7ed3e1c6c43add217fc17388c519c3f5587',
              spent: null
            },
            {
              indexAtomic: '32',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9142353d0b44a112962cb750b82c9178d049fad917687',
              spent: null
            },
            {
              indexAtomic: '33',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144108dad0d0bbe6a314e0ec5c33ae9d5f06ae0a6c87',
              spent: null
            },
            {
              indexAtomic: '34',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9147b17c2cd7ab0150badd8baeaf1648f525864428287',
              spent: null
            },
            {
              indexAtomic: '35',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f6edd5a06996e0081cf1fada0ce527999853035d87',
              spent: null
            },
            {
              indexAtomic: '36',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91459443886670fdeebb8f1c1b0d27dccc181d969e987',
              spent: null
            },
            {
              indexAtomic: '37',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9142f20a56df6997a1c6862f595229b7206a66cda8187',
              spent: null
            },
            {
              indexAtomic: '38',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914373c4d1aa25e2caa539a2fafaf1ba4a29892166287',
              spent: null
            },
            {
              indexAtomic: '39',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91473e5121c30cc33bfbcf2a60a1a18169af3b3464e87',
              spent: null
            },
            {
              indexAtomic: '40',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914cbcc6bdd735ffe3b45596d473f1f797b5d79d2fe87',
              spent: null
            },
            {
              indexAtomic: '41',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9145a10270165f4d4c1692877cc689d1a2585eb194d87',
              spent: null
            },
            {
              indexAtomic: '42',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9142f8b5d8f9e3cf756c35724bedb8fd39f5f1d964a87',
              spent: null
            },
            {
              indexAtomic: '43',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914a6c471d5cf899e818005462794a34bdf1f4d634587',
              spent: null
            },
            {
              indexAtomic: '44',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9140b7fe409b308ffb4d1a548e64992a24b09b641be87',
              spent: null
            },
            {
              indexAtomic: '45',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914fb96a3ac34d85535b9ba6bca00ad8c8a9cd85f6f87',
              spent: null
            },
            {
              indexAtomic: '46',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91467967d690e4ca4bb5476429017e53ee4b3a234e087',
              spent: null
            },
            {
              indexAtomic: '47',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914a9380fe298761b20467e3ae75473e3d399fc25e587',
              spent: null
            },
            {
              indexAtomic: '48',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914768793cc89063d66208d30993add92e487af246287',
              spent: null
            },
            {
              indexAtomic: '49',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f7e6e7f09e20c493e4d56cf0cd4364892aae87ae87',
              spent: null
            },
            {
              indexAtomic: '50',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9149346a048c2d8d71d1dfc24d194b9e80e2b09909b87',
              spent: null
            },
            {
              indexAtomic: '51',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914805e457185f06cc8cca6aa171fe0d59874ec55d987',
              spent: null
            },
            {
              indexAtomic: '52',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914cf9861f0b1fcbf81f922cfbe4cd8764ff555b0bc87',
              spent: null
            },
            {
              indexAtomic: '53',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914083585a6a05ced615539513a7e8087a0499bec0087',
              spent: null
            },
            {
              indexAtomic: '54',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914b64094cb985e8128b1e110805c01094f2216d50287',
              spent: null
            },
            {
              indexAtomic: '55',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9142e3b0fe57ebe2f3e09089eca65e9008eed88021687',
              spent: null
            },
            {
              indexAtomic: '56',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914d89a9a832f0ef58e4c2ba7f6eb164279ce2abbd087',
              spent: null
            },
            {
              indexAtomic: '57',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914c6c2ea6fca6f947cdf12438a87a1411f891e7ad287',
              spent: null
            },
            {
              indexAtomic: '58',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144b12b11f20ef9f7fc8f1ee4c48680aa85e70ea9b87',
              spent: null
            },
            {
              indexAtomic: '59',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914892830d7e23803c3429e50839c11c2b1606a784d87',
              spent: null
            },
            {
              indexAtomic: '60',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91468f90a79ebc33f4142f25233537461d9a98efe5187',
              spent: null
            },
            {
              indexAtomic: '61',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9145bac018119ec73b4bde99e9961928f8140fca8a787',
              spent: null
            },
            {
              indexAtomic: '62',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9148a552cb7c5c673fae953f74c8e6cfe0805562d4c87',
              spent: null
            },
            {
              indexAtomic: '63',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f9232fdd70c160e3af4057db284b9fadf1b529ad87',
              spent: null
            },
            {
              indexAtomic: '64',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91485033b8b775e06d8b3c31c694db747b9165dbddb87',
              spent: null
            },
            {
              indexAtomic: '65',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914ed087b0a907b01336b15510bfb42bc80cd4d468687',
              spent: null
            },
            {
              indexAtomic: '66',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a91443af873d267fa175ef33c8150b3eeba3f299569c87',
              spent: null
            },
            {
              indexAtomic: '67',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914c3f1a64fc7a05ca0175e3de5c36eaf365da394e187',
              spent: null
            },
            {
              indexAtomic: '68',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914db47501d3714cba1cdb72d28062a05cc716b9c4187',
              spent: null
            },
            {
              indexAtomic: '69',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144c27422c3f26060a46145d1b05231ef7f723b3d887',
              spent: null
            },
            {
              indexAtomic: '70',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9148495e72695c4bb7d04ac90d1899b3d30c241a3cf87',
              spent: null
            },
            {
              indexAtomic: '71',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9144697ee495b0e6ad435d8b614cd3e602099cdf83d87',
              spent: null
            },
            {
              indexAtomic: '72',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9141e69a1f1c3d9e40b9fb7525ba548347c05c3ed2087',
              spent: null
            },
            {
              indexAtomic: '73',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9146536e84f2c09e8153627aba4fb99405710ce147a87',
              spent: null
            },
            {
              indexAtomic: '74',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914aef5a15b76db13493fcb93e3d31d4847d72bf97c87',
              spent: null
            },
            {
              indexAtomic: '75',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914b934cea9a3230d6b1bd3626f9f4eff74416ff67587',
              spent: null
            },
            {
              indexAtomic: '76',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f5e0186152ed7b60867f8e8a702348cc76371ec087',
              spent: null
            },
            {
              indexAtomic: '77',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914f832cbb66f65a4ee594d6bdb9c712a75e031e1cf87',
              spent: null
            },
            {
              indexAtomic: '78',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a914744e18b8e20eb54a7182ba92ac3361e5e7985d1687',
              spent: null
            },
            {
              indexAtomic: '79',
              address: null,
              valueAtomic: '2000000',
              scriptPubKeyHex: 'a9147fcf6405df275d29b272b99c7395d5c697a5ea5687',
              spent: null
            },
            {
              indexAtomic: '80',
              address: null,
              valueAtomic: '122474434384',
              scriptPubKeyHex: '76a9141df6354ebf997bb69cad25ce0b3927ef36d629dd88ac',
              spent: null
            }
          ]
        },
        shielded: null,
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'dogecoin-core:raw:00d2039119ea4ecb7d026f4c89a84a908de826a3d68adc036f905dc574e0a4a7',
          'dogecoin-core:mempool:00d2039119ea4ecb7d026f4c89a84a908de826a3d68adc036f905dc574e0a4a7'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'dogecoin',
        network: 'mainnet',
        txid: '0291b7485ba29475fc8612e5184d4aace1593a77be7a1350f535bb4cf52b7da7',
        status: 'pending',
        firstSeenAt: '2026-08-29T07:06:18.954Z',
        observedAt: '2026-08-29T08:27:13.782Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '223',
        fee: {
          amountAtomic: '153600',
          rateDecimal: null,
          rateUnit: null
        },
        conflicts: [],
        replacement: null,
        expiry: null,
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: '3a6ddcdeaa8e0c3a7474b1e9a1699c31e43d9a674ca8a04d8a37d9d64326ca87:0',
              address: null,
              valueAtomic: '20000000',
              scriptSigHex: '473044022052d9eff8cba7e5fd10960358e447c59660783c7f90236851f0439dfab7e402cb02206d2e2d5f4117649fdad9bff1a9a8ffd30a3ea21a619aa9fe4f1fdd142f73a37d014104d75c6b53f27ea174087acb315e49f9d23ca4d13faf3d4b83c0277caa3e138df5a271f356bbd59eaeb03fa06bca244066655b1ab7bd26f179aa4240fd6d2d5eff',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: null,
              valueAtomic: '19846400',
              scriptPubKeyHex: '76a914f251dc7a7fa93ae5e87aacebeb0da73837ffe91388ac',
              spent: null
            }
          ]
        },
        shielded: null,
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'dogecoin-core:raw:0291b7485ba29475fc8612e5184d4aace1593a77be7a1350f535bb4cf52b7da7',
          'dogecoin-core:mempool:0291b7485ba29475fc8612e5184d4aace1593a77be7a1350f535bb4cf52b7da7'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'dogecoin',
        network: 'mainnet',
        txid: '02e488a61a6ec16185328eb615f61c07132bfc43678a4643d7448373a521c6c7',
        status: 'pending',
        firstSeenAt: '2026-08-29T06:26:45.080Z',
        observedAt: '2026-08-29T08:27:13.782Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '223',
        fee: {
          amountAtomic: '153600',
          rateDecimal: null,
          rateUnit: null
        },
        conflicts: [],
        replacement: null,
        expiry: null,
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: 'ba1412b2e9c440c90565dfee4351a6a277801c16c2283f151bd3da1adec43b45:1',
              address: null,
              valueAtomic: '20000000',
              scriptSigHex: '47304402203c586eef205018df76b2fd60cdf2acd655bf71cc382c3421a4f3e71d2af41ff3022015507f0b84a24cf7bce31440e9f3d95d42a85ffa6a3f75189c6ab15ccf76d9bc014104dc5dbe584383396cba30667fb93b492a1e44c75a2b0ae751c1ef2235f92894602dbfaed953a5dcdd52fe42b00744aa4005194913b21f2797ffbf5ea258bdec4d',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: null,
              valueAtomic: '19846400',
              scriptPubKeyHex: '76a914f251dc7a7fa93ae5e87aacebeb0da73837ffe91388ac',
              spent: null
            }
          ]
        },
        shielded: null,
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'dogecoin-core:raw:02e488a61a6ec16185328eb615f61c07132bfc43678a4643d7448373a521c6c7',
          'dogecoin-core:mempool:02e488a61a6ec16185328eb615f61c07132bfc43678a4643d7448373a521c6c7'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'dogecoin',
        network: 'mainnet',
        txid: '0341487a72eddc478ee804849750eb60b88263ee422b08397eae991b66946d0b',
        status: 'pending',
        firstSeenAt: '2026-08-29T07:06:48.961Z',
        observedAt: '2026-08-29T08:27:13.782Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '223',
        fee: {
          amountAtomic: '153600',
          rateDecimal: null,
          rateUnit: null
        },
        conflicts: [],
        replacement: null,
        expiry: null,
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: '39581e38a19abcc87781a7b0840ff9026c0d592709d60db30ad371815ec4a0ae:2',
              address: null,
              valueAtomic: '20000000',
              scriptSigHex: '47304402203224a4789a3722558165b00452b34cde1b837755553f879b6323f74b2c25574b02205bb4a3e70da5a7a7d9c1617a9f567f8affab782fff5b0688b7b2ab64348c37ce014104d9d8fed4b18ee5bfd043c7fd2f961c229193cc05640dd3a54b1ea722192d12e4676fdf047f686e6be5ff0e40f96f81561e86be6a27d582b4a0a8d6305d049b11',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: null,
              valueAtomic: '19846400',
              scriptPubKeyHex: '76a914f251dc7a7fa93ae5e87aacebeb0da73837ffe91388ac',
              spent: null
            }
          ]
        },
        shielded: null,
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'dogecoin-core:raw:0341487a72eddc478ee804849750eb60b88263ee422b08397eae991b66946d0b',
          'dogecoin-core:mempool:0341487a72eddc478ee804849750eb60b88263ee422b08397eae991b66946d0b'
        ],
        completeness: 'complete'
      }
    ]
  },
  zcashMempool: {
    snapshot: {
      network: 'mainnet',
      snapshotId: 'zcash-fcdd0365c79832b5d61484b5d0cc834e143ac771',
      sequenceAtomic: '57',
      tip: {
        heightAtomic: '3464548',
        blockHash: '000000000094e3f346dd672170a92ff16ad6e74694c9ffd43d72296e4bda42ab',
        observedAt: '2026-08-29T08:27:13.196Z'
      },
      initialBlockDownload: true,
      completeness: 'complete',
      transactionCountAtomic: '5',
      hydratedCountAtomic: '0',
      observedAt: '2026-08-29T08:27:13.196Z'
    },
    transactions: [
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'zcash',
        network: 'mainnet',
        txid: '4bda6a72c537e3ab42f81495e625d92dc29a2d544405212634176cc720c9d338',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:26:23.192Z',
        observedAt: '2026-08-29T08:27:13.196Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '244',
        fee: {
          amountAtomic: null,
          rateDecimal: null,
          rateUnit: 'zatoshi/logical-action',
          logicalActionsAtomic: '2',
          model: 'ZIP-317-revision-1'
        },
        conflicts: [],
        replacement: null,
        expiry: {
          heightAtomic: '3464648',
          state: 'pending'
        },
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: 'c697245abda6bebf4bb96d9c6230bcb74848d0ee845331ee3cb9784cb03e06ef:1',
              address: null,
              valueAtomic: null,
              scriptSigHex: '473044022070bf646632f52d917f4a19987d2949b763219d432b43cc25a457a4f6239833180220287f4f10c191eab86a0c78b374715c03d454e5314a6c749479e9b2531edd44170121033e842058be42e762effd7daf3b9e6cc44321f904cc8736fa50b90d261fe7b1e9',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: 't1Uo52SqpupL6Z1TPVHWhGSxrsjVgcyMKsM',
              valueAtomic: '100000000',
              scriptPubKeyHex: '76a91477cddbb738117e9116e0527c66d36cf472b8965688ac',
              spent: null
            },
            {
              indexAtomic: '1',
              address: 't1YhRyphDWJ8h6oUwrMJ4NaH7QYJgRsFS9i',
              valueAtomic: '529578076',
              scriptPubKeyHex: '76a914a29d5b9834b8cb63c8516a4094c6a7f946a56dfa88ac',
              spent: null
            }
          ]
        },
        shielded: {
          sproutJoinSplitsAtomic: '0',
          saplingSpendsAtomic: '0',
          saplingOutputsAtomic: '0',
          orchardActionsAtomic: '0',
          ironwoodActionsAtomic: '0',
          valueBalanceAtomic: null,
          saplingValueBalanceAtomic: '0',
          orchardValueBalanceAtomic: '0',
          ironwoodValueBalanceAtomic: null,
          privacyNotice: 'Shielded sender, recipient, address, amount, ownership, and direction are not observable from public transaction data.'
        },
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'zebra:getrawmempool:4bda6a72c537e3ab42f81495e625d92dc29a2d544405212634176cc720c9d338',
          'zebra:getrawtransaction:4bda6a72c537e3ab42f81495e625d92dc29a2d544405212634176cc720c9d338'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'zcash',
        network: 'mainnet',
        txid: '58f5e4e5bc127396c05f27f724c493727a5f64d1e2b1644ab19ca1d87f76a079',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:25:18.187Z',
        observedAt: '2026-08-29T08:27:13.196Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '245',
        fee: {
          amountAtomic: null,
          rateDecimal: null,
          rateUnit: 'zatoshi/logical-action',
          logicalActionsAtomic: '2',
          model: 'ZIP-317-revision-1'
        },
        conflicts: [],
        replacement: null,
        expiry: {
          heightAtomic: '0',
          state: 'pending'
        },
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: '9543e886776f8d053482697b62d7e0c7e1ae8579a2f7d834dfaf83b4a93001ff:0',
              address: null,
              valueAtomic: null,
              scriptSigHex: '483045022100aa573afdbb53a283c5ccabe017ccc9e792d47ce7461b76309425251e87077ddd022041c8cdc81c0b4627c671eeb2356d5174105799379f85407e8f3d6a3182a6462701210214e3b384c0c97fefa02268d20c4d1dc1916aabce7b7947523bed78889244cdc5',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: 't1NLjGNiwrw4dDQkM9immE5aRh6ut1eRnbS',
              valueAtomic: '505000000',
              scriptPubKeyHex: '76a9143101cb3ae364ac29b91f3a2a837b3f6a8f67e79d88ac',
              spent: null
            },
            {
              indexAtomic: '1',
              address: 't1PZswZWuE9cnQMKY7TQFiK9hWhvnjNghh3',
              valueAtomic: '121628907',
              scriptPubKeyHex: '76a9143e7691b7045db5e10b64cea1cec5d0eb98e3ce8b88ac',
              spent: null
            }
          ]
        },
        shielded: {
          sproutJoinSplitsAtomic: '0',
          saplingSpendsAtomic: '0',
          saplingOutputsAtomic: '0',
          orchardActionsAtomic: '0',
          ironwoodActionsAtomic: '0',
          valueBalanceAtomic: null,
          saplingValueBalanceAtomic: '0',
          orchardValueBalanceAtomic: '0',
          ironwoodValueBalanceAtomic: null,
          privacyNotice: 'Shielded sender, recipient, address, amount, ownership, and direction are not observable from public transaction data.'
        },
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'zebra:getrawmempool:58f5e4e5bc127396c05f27f724c493727a5f64d1e2b1644ab19ca1d87f76a079',
          'zebra:getrawtransaction:58f5e4e5bc127396c05f27f724c493727a5f64d1e2b1644ab19ca1d87f76a079'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'zcash',
        network: 'mainnet',
        txid: '982b98c61601fcec1315ff345a3be904017a122a9397ec0deba18dc4aa32450f',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:25:48.189Z',
        observedAt: '2026-08-29T08:27:13.196Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '244',
        fee: {
          amountAtomic: null,
          rateDecimal: null,
          rateUnit: 'zatoshi/logical-action',
          logicalActionsAtomic: '2',
          model: 'ZIP-317-revision-1'
        },
        conflicts: [],
        replacement: null,
        expiry: {
          heightAtomic: '0',
          state: 'pending'
        },
        transparent: {
          inputs: [
            {
              indexAtomic: '0',
              previousOutpoint: '4d77c31aa6c0466263880a634b36bed79f51051c5af9acffad28ceac904dc08f:1',
              address: null,
              valueAtomic: null,
              scriptSigHex: '473044022035c6595c9bae8c49db73d337c25fe01a2e12b0f076a2ee3d6fe292ffafc8184a02205eca36cdd18982060e31cd5d1c32687981bf4ce9d793ba0f4d1192a854339cdf012102106a2dcaaac2ae3b24358a03f4264e05db420c5b090399bc23885fa02fef7716',
              coinbase: false
            }
          ],
          outputs: [
            {
              indexAtomic: '0',
              address: 't1VN3eH8nxqCQFcJ2i5Zv54LdD7XLnKXRDN',
              valueAtomic: '196131846',
              scriptPubKeyHex: '76a9147e0a6e63687b23f0fabbd8127a5df01a7b31ae1a88ac',
              spent: null
            },
            {
              indexAtomic: '1',
              address: 't1Ku2KLyndDPsR32jwnrTMd3yvi9tfFP8ML',
              valueAtomic: '3872726483',
              scriptPubKeyHex: '76a9141634f5ff0b8f6603a17570436d6c12a91f4b1fed88ac',
              spent: null
            }
          ]
        },
        shielded: {
          sproutJoinSplitsAtomic: '0',
          saplingSpendsAtomic: '0',
          saplingOutputsAtomic: '0',
          orchardActionsAtomic: '0',
          ironwoodActionsAtomic: '0',
          valueBalanceAtomic: null,
          saplingValueBalanceAtomic: '0',
          orchardValueBalanceAtomic: '0',
          ironwoodValueBalanceAtomic: null,
          privacyNotice: 'Shielded sender, recipient, address, amount, ownership, and direction are not observable from public transaction data.'
        },
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'zebra:getrawmempool:982b98c61601fcec1315ff345a3be904017a122a9397ec0deba18dc4aa32450f',
          'zebra:getrawtransaction:982b98c61601fcec1315ff345a3be904017a122a9397ec0deba18dc4aa32450f'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'zcash',
        network: 'mainnet',
        txid: 'c0f08743c4e645b1bb7409c64fb376adaeeca8bc9f5bdb7c8f60ef69e85cbb8c',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:26:13.191Z',
        observedAt: '2026-08-29T08:27:13.196Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '15512',
        fee: {
          amountAtomic: null,
          rateDecimal: null,
          rateUnit: 'zatoshi/logical-action',
          logicalActionsAtomic: '5',
          model: 'ZIP-317-revision-1'
        },
        conflicts: [],
        replacement: null,
        expiry: {
          heightAtomic: '3464589',
          state: 'pending'
        },
        transparent: {
          inputs: [],
          outputs: [
            {
              indexAtomic: '0',
              address: 't1WZUWvWzzL7bnTuDkfxnXoeWV5trVTqLqw',
              valueAtomic: '100800000',
              scriptPubKeyHex: '76a9148b2be54997a7cc4885bd0ef844a956b4449dbf8588ac',
              spent: null
            }
          ]
        },
        shielded: {
          sproutJoinSplitsAtomic: '0',
          saplingSpendsAtomic: '0',
          saplingOutputsAtomic: '0',
          orchardActionsAtomic: '0',
          ironwoodActionsAtomic: '4',
          valueBalanceAtomic: null,
          saplingValueBalanceAtomic: '0',
          orchardValueBalanceAtomic: '0',
          ironwoodValueBalanceAtomic: '100825000',
          privacyNotice: 'Shielded sender, recipient, address, amount, ownership, and direction are not observable from public transaction data.'
        },
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'zebra:getrawmempool:c0f08743c4e645b1bb7409c64fb376adaeeca8bc9f5bdb7c8f60ef69e85cbb8c',
          'zebra:getrawtransaction:c0f08743c4e645b1bb7409c64fb376adaeeca8bc9f5bdb7c8f60ef69e85cbb8c'
        ],
        completeness: 'complete'
      },
      {
        schemaVersion: 'universe-transaction-v1',
        chain: 'zcash',
        network: 'mainnet',
        txid: 'dada060cafb1f3e4acf1f7f7c3fb7feba0454b9392eb29cb2c28ef8992581c5f',
        status: 'pending',
        firstSeenAt: '2026-08-29T08:26:58.194Z',
        observedAt: '2026-08-29T08:27:13.196Z',
        confirmedAt: null,
        removedAt: null,
        block: null,
        confirmationsAtomic: '0',
        sizeBytesAtomic: '18340',
        fee: {
          amountAtomic: null,
          rateDecimal: null,
          rateUnit: 'zatoshi/logical-action',
          logicalActionsAtomic: '5',
          model: 'ZIP-317-revision-1'
        },
        conflicts: [],
        replacement: null,
        expiry: {
          heightAtomic: '3464588',
          state: 'pending'
        },
        transparent: {
          inputs: [],
          outputs: [
            {
              indexAtomic: '0',
              address: 't1PLVRnDwxoeMxxTmPDhwXzEny21oJZNmCu',
              valueAtomic: '148000000',
              scriptPubKeyHex: '76a9143bee5e4f9f397189af886895d4940be34e0455a388ac',
              spent: null
            }
          ]
        },
        shielded: {
          sproutJoinSplitsAtomic: '0',
          saplingSpendsAtomic: '0',
          saplingOutputsAtomic: '0',
          orchardActionsAtomic: '2',
          ironwoodActionsAtomic: '2',
          valueBalanceAtomic: null,
          saplingValueBalanceAtomic: '0',
          orchardValueBalanceAtomic: '45945',
          ironwoodValueBalanceAtomic: '147979055',
          privacyNotice: 'Shielded sender, recipient, address, amount, ownership, and direction are not observable from public transaction data.'
        },
        protocolActions: {
          candidates: [],
          confirmed: []
        },
        evidenceIds: [
          'zebra:getrawmempool:dada060cafb1f3e4acf1f7f7c3fb7feba0454b9392eb29cb2c28ef8992581c5f',
          'zebra:getrawtransaction:dada060cafb1f3e4acf1f7f7c3fb7feba0454b9392eb29cb2c28ef8992581c5f'
        ],
        completeness: 'complete'
      }
    ]
  },
  dogecoinProtocols: {
    chain: 'dogecoin',
    network: 'mainnet',
    items: [
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'doginals',
        aliases: [
          'doginal'
        ],
        displayName: 'Doginals',
        shortName: 'Doginals',
        family: 'OTHER',
        chain: 'dogecoin',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-doginals',
        visualToken: 'protocol-doginals',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'ord-dogecoin',
        coverage: 'unknown'
      },
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'drc20',
        aliases: [
          'drc-20'
        ],
        displayName: 'DRC-20',
        shortName: 'DRC-20',
        family: 'OTHER',
        chain: 'dogecoin',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-drc20',
        visualToken: 'protocol-drc20',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'ord-dogecoin',
        coverage: 'unknown'
      },
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'tap_doge',
        aliases: [
          'tap-on-doge',
          'doge-tap',
          'tap-doge'
        ],
        displayName: 'TAP on Doge',
        shortName: 'Doge TAP',
        family: 'OTHER',
        chain: 'dogecoin',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-tap-doge',
        visualToken: 'protocol-tap-doge',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'index-doge-tap',
        coverage: 'unknown'
      },
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'dunes',
        aliases: [],
        displayName: 'Dunes',
        shortName: 'Dunes',
        family: 'OTHER',
        chain: 'dogecoin',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-dunes',
        visualToken: 'protocol-dunes',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'ord-dogecoin',
        coverage: 'unknown'
      }
    ],
    confirmedHistory: {
      configured: false,
      configurationFailure: 'blockbook-unconfigured',
      state: 'unavailable',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastFailureKind: null,
      tip: null,
      initialSync: null,
      mempoolInSync: null,
      release: null
    },
    mempool: {
      configured: true,
      configurationFailure: null,
      running: false,
      lastAttemptAt: '2026-08-29T08:27:13.782Z',
      lastSuccessAt: '2026-08-29T08:27:13.782Z',
      lastFailureKind: null,
      snapshot: {
        chain: 'dogecoin',
        network: 'mainnet',
        snapshotId: 'dogecoin-mainnet-125515f9916eb54b416b2ace409554db',
        sequenceAtomic: '1554',
        tip: {
          heightAtomic: '6351906',
          blockHash: '648c241e0a6602ebae1b6e589a228cd5b3e60d6988423343f6dae74216779576',
          observedAt: '2026-08-29T08:27:13.782Z'
        },
        initialBlockDownload: false,
        observedAt: '2026-08-29T08:27:13.782Z',
        completeness: 'complete'
      }
    },
    protocolAuthority: {
      configured: true,
      state: 'unavailable',
      lastAttemptAt: '2026-08-29T08:27:12.791Z',
      lastSuccessAt: null,
      lastFailureKind: 'transport',
      checkpoint: null,
      capabilities: null,
      authorityId: 'ord-dogecoin'
    },
    dogeTapAuthority: {
      configured: true,
      state: 'unavailable',
      lastAttemptAt: '2026-08-29T08:27:12.792Z',
      lastSuccessAt: null,
      lastFailureKind: 'transport',
      authorityId: 'index-doge-tap',
      sourceId: null,
      coverage: null,
      pendingCoverage: null,
      reorgCoverage: null,
      sourceSequenceAtomic: null,
      initialScanComplete: null,
      quarantinedRecordCountAtomic: null,
      release: null
    }
  },
  zcashProtocols: {
    chain: 'zcash',
    network: 'mainnet',
    items: [
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'zerdinals',
        aliases: [
          'universe-zerdinals'
        ],
        displayName: 'Zerdinals',
        shortName: 'Zerdinals',
        family: 'OTHER',
        chain: 'zcash',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-zerdinals',
        visualToken: 'protocol-zerdinals',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'index-zcash-metaprotocols',
        coverage: 'unknown'
      },
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'zrunes',
        aliases: [],
        displayName: 'ZRunes',
        shortName: 'zRunes',
        family: 'OTHER',
        chain: 'zcash',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-zrunes',
        visualToken: 'protocol-zrunes',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'index-zcash-metaprotocols',
        coverage: 'unknown'
      },
      {
        schemaVersion: 'universe-explorer-protocol-v1',
        id: 'zrc20',
        aliases: [],
        displayName: 'ZRC-20',
        shortName: 'ZRC-20',
        family: 'OTHER',
        chain: 'zcash',
        networks: [
          'mainnet'
        ],
        icon: 'protocol-zrc20',
        visualToken: 'protocol-zrc20',
        implementedReadOperations: [],
        authorizedReadOperations: [],
        releaseStatus: 'BLOCKED',
        indexerAuthority: 'index-zcash-metaprotocols',
        coverage: 'unknown'
      }
    ],
    status: {
      configured: true,
      configurationFailure: null,
      state: 'ready',
      running: false,
      lastAttemptAt: '2026-08-29T08:27:13.783Z',
      lastSuccessAt: '2026-08-29T08:27:15.103Z',
      lastFailureKind: null,
      snapshot: {
        network: 'mainnet',
        snapshotId: 'zcash-fcdd0365c79832b5d61484b5d0cc834e143ac771',
        sequenceAtomic: '57',
        tip: {
          heightAtomic: '3464548',
          blockHash: '000000000094e3f346dd672170a92ff16ad6e74694c9ffd43d72296e4bda42ab',
          observedAt: '2026-08-29T08:27:13.196Z'
        },
        initialBlockDownload: true,
        completeness: 'complete',
        transactionCountAtomic: '5',
        hydratedCountAtomic: '0',
        observedAt: '2026-08-29T08:27:13.196Z'
      },
      confirmedCoverage: 'complete',
      confirmedLagBlocksAtomic: '2'
    }
  }
} as const;
