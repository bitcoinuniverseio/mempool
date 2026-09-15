# Local Zcash note scanner (UI-F10)

Replaces prefix detection and fabricated 1000-block/zero-balance results with actual viewing-key parsing and Sapling/Orchard trial decryption. Pinned official libraries: `zcash_keys 0.14.0`, `zcash_primitives 0.28.0`, `zcash_protocol 0.9.0`, `sapling-crypto 0.7.0`, `orchard 0.14.0`, `zcash_note_encryption 0.4.1`. Cargo.lock pins transitive dependencies. No zk proving parameters are needed for decryption.

## Supported operations

- UFVK and UIVK checksum, contents and mainnet/testnet network parsing using ZIP316's actual decoder. Full viewing keys scan internal and external scopes. UIVKs scan their encoded incoming scope.
- Sapling extended full viewing keys with encoded network validation; explicit raw Sapling 32-byte and Orchard 64-byte incoming-key formats with actual scalar/key validation. Raw keys do not encode a network; the selected network supplies the protocol schedule. Addresses and spending keys are not viewing keys.
- Owned raw-block intervals: `Block::read` parses the actual transactions and coinbase height. Header hash, prior hash linkage, transaction Merkle root and consensus branch are checked locally; full note ciphertexts use authenticated decryption. The owned node supplies validated active-chain data. The scanner is not a second full consensus/Equihash/SNARK validator.
- Offline compact artifacts: actual compact note trial decryption validates encrypted note commitments and recipients. An offline artifact proves neither block inclusion nor monetary consensus validity. Public test vectors intentionally include large unsigned 64-bit test amounts; they have no live value. Amounts remain exact decimal strings.
- Resume sends only the prior block hash and next interval to the source. A changed prior checkpoint returns a reorg error and clears the result; stale edit/network/sample/destruction results are discarded. Results cover each interval separately and are not accumulated as a wallet balance.

## Privacy and bounds

Viewing keys and decrypted recipients never enter an HTTP request, log, local/session storage, IndexedDB or download. The masked input retains the viewing key in browser memory until Clear Key or page destruction. Each local worker instantiates fresh WASM, has no host imports, wipes all WASM memory and its encoded request in `finally`, then terminates. JavaScript strings are garbage-collected rather than provably overwritten; the product does not claim a zero-leakage certification. No memo contents are displayed or transmitted.

The worker has a 30-second deadline and 128 MiB WASM memory ceiling; requests are at most10 MB and results2 MB. At most10 blocks/4096 shielded outputs are processed. Request smaller intervals when bounds are exceeded. The browser streams public responses with an8.1 MB cap.

The only new network operation is GET `/api/v1/zcash/privacy/blocks?network=mainnet&start=HEIGHT&end=HEIGHT&previous=OPTIONAL_HASH`. It has no key/body field and rejects other query parameters. Source requests use only `getblockchaininfo`, `getblockhash` and `getblock(hash,0)` against an operator-configured owned Zcash RPC origin. `initial_block_download_complete`, network, height availability and before/after tip must agree. There are two concurrent source slots,15-second interval deadline,5-second RPC timeout,8 MB encoded interval cap,2 MB individual raw-block cap, and no redirects/proxy discovery.

Operator settings: `UNIVERSE_ZCASH_RPC_ORIGIN`; authentication via `UNIVERSE_ZCASH_RPC_COOKIE_FILE` or `UNIVERSE_ZCASH_RPC_USER`/`UNIVERSE_ZCASH_RPC_PASSWORD`. Never place credentials in the browser or URLs. The adapter targets the documented zcashd RPC contract; sources with a different sync-status contract fail explicitly. No source was configured or verified during this task. No live process or production configuration changed.

## Evidence and reproduction

`reference-revisions.json` records the official test-vector revision. The two upstream JSON files contain published synthetic test material only, including known test secrets; they contain no user keys. `fixtures.json` keeps only the incoming keys, public ciphertext fields and expected exact amounts needed by tests. `generate-fixtures.cjs` preserves unsafe-size JSON integers as source strings. The block fixture is the published mainnet415000 vector from the pinned official parser crate.

Build: `node tools/zcash-scanner/build.mjs` from the candidate, with cargo on PATH. On Windows this sets process-local LLVM paths only. The generated WASM is copied to `frontend/src/resources/zcash-scanner/universe_zcash_scanner.wasm` (640383 bytes in this build).

Validation:

-5 native Rust tests: all20 independently generated Python compact vectors, exact values; full20 authenticated ciphertext/memo vectors; wrong key, altered ciphertext and authentication tag; UFVK network/checksum; official raw-block hash/height/Merkle/predecessor.
-10 frontend tests: actual WASM20-vector proof, memory wipe/no imports, mutation/wrong key, real raw-block binding, public request boundary, offline no-source operation, cancellation and resume/reorg state.
-18 backend tests: public range contract, wrong network/sync/height, bounds, changed tip, resume reorg and absent source; existing privacy route contract updated to include the fourth public blocks route.
-Angular `ngc --noEmit -p tsconfig.app.json` passed, as did frontend/backend TypeScript checks. Production browser integration is a separate parent gate.

## Explicit remaining acceptance

Full live-history acquisition and resumable wallet history, Sapling note positions, nullifier/spend tracking, unspent balance, witness construction, transparent/Sprout scanning, and future protocol versions outside the pinned schedule remain unsupported/unverified. `balance_zatoshis` is always null, `history_complete` false and `spend_status` not_scanned. The original full GO denominator remains open. Received notes from selected data must never be relabeled as spendable funds or a complete wallet balance.

Primary references: [ZIP316](https://zips.z.cash/zip-0316), [official RPC getblock](https://zcash.github.io/rpc/getblock.html), [official RPC getblockchaininfo](https://zcash.github.io/rpc/getblockchaininfo.html), [official independent test vectors](https://github.com/zcash/zcash-test-vectors).
