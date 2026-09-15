# UTXO Intelligence: owned checkpoints and reversible projection

## What exists

Both UTXO endpoint families share the owned Core coinstatsindex checkpoint reader. The intelligence endpoints additionally support a complete bounded outpoint projection from genesis, independent Bitcoin Core-compatible MuHash3072, exact satoshi totals, script/age/value cohorts, spend-cost scenarios and reversible block transitions. Fabricated cohorts, summary-string hashes labeled hash_serialized_2, constant-based rollback and reconciled-by-default claims have been removed.

A node checkpoint is an observation, not independent reconciliation. Reconciliation is true only when network, canonical block hash, height, output count, exact value and the independently computed MuHash all match. hash_serialized_2 stays null because this implementation computes MuHash, not that separate legacy commitment. No arbitrary six-block finality claim is made.

## Operator configuration

Checkpoint reads need an already synced coinstatsindex on the configured owned Core node. Routes call getindexinfo before gettxoutsetinfo('muhash', exact_block_hash, true), verify configured genesis, and recheck the canonical hash. They never start expensive full-set scans as a fallback. A missing index is a typed 503. Observations are cached for 30 seconds, shared across requests, and have a 10 second caller timeout. The node's configured RPC timeout also applies.

Full cohort/reconciliation reads additionally require an explicit `UNIVERSE_UTXO_PROJECTION_PATH`. This enables an on-demand local projection using existing Core RPC. Choose a dedicated durable file path and back it up. No background indexer, deployment or production configuration is started by this change. Cluster workers use stable worker-specific suffixes; the primary creates no projection. Each projection has a process-safe lifetime writer lock with safe dead-process recovery, network/schema validation, checksummed gzip snapshot, atomic file replacement, file synchronization and directory synchronization where supported. Competing live writers fail closed.

Projection limits are 100,000 current coins, 288 undo blocks, 300,000 retained undo operations, 4 MiB raw blocks, 250 blocks per synchronization call and a 10 second work budget checked between block reads. RPC work already underway is bounded by the node RPC timeout. The shared atomic snapshot writer bounds serialized body size at 64 MiB. Exceeding a bound produces an explicit unavailable/catching-up response; no truncated cohort is labeled complete. These limits make this a useful small-chain projection, not a mainnet-scale storage engine. Mainnet-scale indexing remains an acceptance requirement.

## Projection, undo and restart

Every raw block is checked against its requested hash, expected predecessor and transaction Merkle root. Every input spends an existing projected outpoint, and every spendable output is inserted with exact value, script, creation height, coinbase status and block timestamp. The genesis subsidy is excluded. OP_RETURN and scripts larger than 10,000 bytes are excluded consistently with Core's provably unspendable handling. Historical mainnet BIP30 coinbase overwrite heights are handled as reversible state removals; this is an observation projection, not a second consensus validator.

Ordered create/spend operations preserve intra-block spends and exact rollback. A canonical mismatch reverses retained undo operations until the common ancestor, then applies the new branch. Every reversed commitment must match the stored previous MuHash. Reorgs deeper than retained history fail closed and require rebuilding into a new checkpoint path. Restart validates every coin, all undo operations and each reverse commitment; derived transition metrics are recomputed instead of trusting serialized summary fields. Mutations are published to disk before successful synchronization returns.

Satoshi amounts use exact conversion from decimal RPC values. Block transition flows use BigInt internally and return decimal strings if they exceed JavaScript's safe integer range. Current UTXO values cannot exceed the Bitcoin supply bound and remain exact safe integers. Coin-age destruction includes an exact sat-second string; the coin-days display is a derived floating approximation.

## Cohort and cost semantics

Each script, age and value partition includes every reconciled projected coin exactly once. Percentages are shares of value held in UTXOs, not issued or circulating supply. Age uses non-negative differences between creation block timestamp and checkpoint block timestamp. Full histories are not inferred from a single checkpoint.

Spend-cost scenarios use explicit input-size assumptions: P2PK 114, P2PKH 148, P2WPKH 68 and Taproot key-path 58 vB. P2SH, P2WSH and other hidden spending paths remain unknown. Transaction/output overhead is excluded, and no consensus-dust, permanent-unspendability or complete-wallet-fee claim is made. Results identify the count of outputs whose spending cost is unknown.

## Legacy endpoints and user interface

/api/v1/utxo-set/checkpoints returns actual node MuHash observations. Distribution adapts actual reconciled cohorts. Protocol-bearing counts still require owned protocol indexes at the same checkpoint; script classification alone cannot infer inscription, token or protocol ownership. Utreexo roots and inclusion verification still require a real accumulator bridge. A MuHash is never substituted for an Utreexo root.

The UI keeps independently available checkpoints visible while naming unavailable cohort, protocol and Utreexo sources. Both UTXO surfaces select the current network, refresh every 30 seconds, cancel stale requests and distinguish node observations from independent reconciliation. The intelligence view displays all three cohort partitions and exact transition quantities.

## Validation and remaining acceptance

Local tests cover the published Core MuHash vector, exact decimal conversion, real outpoint transitions, atomic invalid-block rejection, restart, corrupt/wrong-network state, undo commitments, cohort partitions, reconciliation failure, source gating, canonical changes, legacy adapters and honest UI availability/network behavior.

A separate disposable Bitcoin Core 29 regtest node provided real proof: a mined wallet spend at height 102; independent MuHash, count and exact value match; restart preserving the match; invalidation to 101 with exact rollback; an alternate branch to 103 with a new matching commitment; all cohort totals; candidate HTTP routes for both endpoint families; typed 400 malformed limits and503 missing protocol/Utreexo sources. The task-created node was stopped afterward. Existing other regtest fixtures and production processes were preserved.

Owned Signet currently lacks a synced coinstatsindex, so its checkpoint endpoint honestly returns utxo-coinstatsindex-unavailable. Full GO remains open for mainnet-scale durable projection, real Signet/mainnet source coverage, protocol-bearing overlays, actual Utreexo roots/proofs, additional spending-path cost models and full browser/export journeys.

Primary implementation references: [Core 29 coinstats serialization](https://github.com/bitcoin/bitcoin/blob/v29.0/src/kernel/coinstats.cpp), [Core MuHash reference and vector](https://github.com/bitcoin/bitcoin/blob/v29.0/test/functional/test_framework/crypto/muhash.py), [gettxoutsetinfo RPC](https://bitcoincore.org/en/doc/24.0.0/rpc/blockchain/gettxoutsetinfo/).
