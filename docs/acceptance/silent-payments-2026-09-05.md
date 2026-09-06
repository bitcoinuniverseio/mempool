# Silent Payments scoped acceptance, 2026-09-05

Baseline: mempool `4e9701186b7b6bc55aa8f02079dd92fa5facddad`. Tested local working changes on 2026-09-05 UTC. Integration owner records the final commit and browser evidence separately. No deployment, runner, CI, separate browser tab, localhost service or production database mutation was performed by this worker.

## Repairs and contract

- Removed all constructor-seeded blocks, random chain identifiers, fabricated counts, made-up S3 links and unevidenced wallet support assertions.
- D05 uses Bech32m checksum/case/padding validation and OpenSSL secp256k1 point validation. BIP352 v0 requires exactly 66 bytes; compatible v1-30 addresses decode the first 66 bytes with explicit compatibility metadata; v31 is rejected. `tsp` means the test-network family. Execution context distinguishes Signet/testnet/testnet4/regtest.
- The existing address form also accepts one BIP321 `sp` instruction, including a mixed-case scheme/key, percent-encoded parameters and an optional valid on-chain fallback of the same network family. It rejects malformed escaping, duplicate singleton parameters, invalid amounts, unsupported required parameters and ambiguous multiple SP instructions. Input is limited to 4096 URI characters and 1023 address characters. Other payment methods in a URI are outside this address inspector's scope.
- D06 parses the full PSBT magic, CompactSize lengths, maps, duplicate keys, required fields and version restrictions. It recognizes standard BIP375/BIP376 field identifiers. Ordinary valid PSBTs report both families absent. Inspection explicitly reports `cryptographically_verified:false`; it does not verify signatures, DLEQ proofs or derived output scripts, sign, or broadcast.
- Ordinary PSBTv2 fields now pass through the installed bitcoinjs-lib BIP174/BIP371 decoders as well. An internal transaction adapter supplies v2 input/output counts to that parser; an uncomputed BIP375 output uses an empty script solely inside this adapter. That internal transaction is never returned or exported. Malformed derivation keys/paths, Taproot derivations, DER signature encodings and preimage-hash key lengths are rejected independently of SP field detection.
- All routes preserve their original paths and require both `chain=bitcoin&network=signet` when context is supplied. Omitting both retains bitcoin/mainnet. Partial context, bad heights and malformed POST inputs receive 400. Unconfigured/unavailable sources receive 503; missing indexed blocks receive 404.
- GET coverage includes `status`, nullable counts, and real `recent_manifests`. `total_sp_outputs_detected` and `ecosystem_adoption_count` remain null because candidate scanning data is not proof of private payments or current wallet adoption.
- Bundle schema 1 contains transaction-specific eligible input public keys, **all** transaction outpoints for input-hash selection, and Taproot candidate outputs with decimal-string satoshis. It does not contain receiver secrets. Manifest `bundle_hash` is SHA-256 of the exact UTF-8 JSON bytes served by the owned bundle route.

## Q04 source defect and repair

The original scanner never requested a bundle or performed curve computation. It incremented 18 candidates per timer tick and inserted the Bitcoin genesis transaction ID with an invented 125000-satoshi match. Its scan public-key input could not perform BIP352 receiver scanning.

The existing page now validates a client-only private scan capability and spend public key, fetches actual network-scoped manifests/bundles, verifies byte integrity and chain continuity, computes BIP352 receiver ECDH/tweaks, scans the base key and labels (always including change label 0), and displays only computed matches. It checks the final checkpoint again before success. It clears the scan capability after success/failure/cancellation/network change/destroy and uses no local storage, URL, telemetry, or API parameter for it. No spending key or seed is requested. Matches are received outputs, not a current unspent balance.

The UI restricts each range to 144 indexed blocks and label discovery to 0-100. It rejects malformed keys before requesting chain data. Cancellation and network changes unsubscribe pending reads and discard partial/stale results. Manifest and bundle validation compare the returned height with the requested height before scanning. Address/PSBT forms unsubscribe superseded requests; coverage pages clear/refetch on a network change. Navigation preserves the selected network.

## Persistence and recovery

New additive schema declarations live in `backend/src/api/intelligence/silent-payments/silent-payments-ingestion.ts` and initialize through the existing configured MySQL connection. They create:

| Table | Key and purpose |
| --- | --- |
| `intelligence_silent_payment_blocks` | Primary `(chain, network, height)`, unique `(chain, network, block_hash)`. One transaction stores manifest, exact bundle bytes and the checkpoint together. |
| `intelligence_silent_payment_support` | Primary `(wallet_id, wallet_version, evidence_hash)`. Versioned public evidence records; no preloaded claims. |

The service registers once with the existing shared `blocks.setNewBlockCallback`. It verifies configured network, Core-reported chain, source genesis agreement and active block hashes, then ingests completed block transactions. It does not create another Bitcoin polling worker. Missing prevouts or incomplete block transaction lists stop checkpoint advancement.

Replay is serialized and idempotent. A replay of an earlier shared block preserves newer checkpoints that still belong to the active source chain. Reorg recovery compares the actual source tip and hashes, removes displaced suffixes, then replays from the surviving ancestor. Backfill and reorg work are bounded to 144 blocks per shared callback; further work resumes on later shared callbacks. Fresh installations begin at the first completed shared block; coverage does not imply historical scanning before the first stored checkpoint. No synthetic historical records are backfilled. Legacy synthetic state existed only in memory and is not migrated into authoritative rows.

The block row is the source of truth. APIs validate its stored byte hash and current block identity before serving it. Existing tables are preserved; these additions do not change or relabel legacy generic checkpoints. Rollback should disable this consumer and preserve the new rows for replay. Never drop populated tables or guess historical network identity. No live migration was executed during this task.

Support records must contain wallet ID, name, tested/documented capability booleans, exact wallet version, evidence URL, observation time and status. The reader rejects non-boolean capability values, absent names/versions and malformed or credential-bearing evidence URLs. No current support assertion is inferred from the old catalog. There is no public mutation endpoint for these records. Actual versioned wallet evidence is still an external prerequisite for SP-04.

## Evidence ledger

These are scoped operation checks, not full-product or real-network passes. All IDs below refer to the baseline plus this patch; no test secret, wallet seed, or private viewing material is retained in evidence.

| ID | Operation / entry point | Environment, authority and dependency | Steps / actual result | Status |
| --- | --- | --- | --- | --- |
| SP-PARSER-001 / SP-05 | Address form service and registered POST `validate-address` handler | Local Node, official BIP352 address and independently specified public keys; no chain dependency | Correct public keys returned. Punctuation counterexample, checksum, mixed case, curve, padding, wrong family and reserved version rejected. | PASS, local parser/handler scope; actual browser/API acceptance recorded by integration owner |
| SP-PARSER-002 / SP-06 | PSBT form service and registered POST `validate-psbt` handler | Local Node, bitcoinjs-lib ordinary PSBT and official BIP375 vectors | All 20 valid official structural vectors pass; all 6 official malformed-structure vectors rejected. Both original false-positive payloads and truncation, duplicates, length overflow, Base64 and malformed known fields rejected. | PASS, local parser/handler scope |
| SP-PARSER-003 / SP-06 | BIP376 draft-field inspection | Local Node; draft BIP376 field definitions | Spend derivation and 32-byte tweak fields detected only in structurally valid v2 maps; malformed values rejected; crypto verification remains false. | PASS, draft structural scope; official BIP376 vectors are not published |
| SP-STORE-001 / SP-01,02,03 | Shared callback to manifest/bundle readback | Local controlled transactional DB mock and controlled first-party source fixtures | One callback registration, deterministic bundle, idempotent replay and new service instance readback pass. | PASS, controlled tests; real MySQL/Signet BLOCKED |
| SP-STORE-002 / SP-01,02,03 | Restart/retry/reorg/integrity | Same controlled dependencies, no production fault injection | Interrupted write leaves no row; retry writes complete row; displaced suffix replaced from common ancestor; corrupted bytes and wrong-chain reads rejected; missing/stale/unavailable separated. | PASS, controlled tests; live lifecycle BLOCKED |
| SP-SCAN-001 / Q04 | Existing scanner component and pure browser computation | Local Vitest, ephemeral generated test identities, OpenSSL sender ECDH cross-check | Actual receiver algorithm finds independently constructed base/change-label outputs; another receiver returns no matches; corruption/cancellation/wrong-network rejected. | PASS, controlled local computation; Signet match BLOCKED |
| SP-SCAN-002 / Q04 | Scanner API consumer | Local actual component with observed API method arguments | Only height and public bundle requests observed. Scan capability cleared on completion. Network switch cancels late API data. | PASS, component privacy check; deployed browser traffic not claimed |
| SP-PARSER-004 / SP-05 | Existing BIP321 address form and registered POST handler | Local component test and actual registered handler, official public address | Reproduced valid `bitcoin:?sp=...` rejection; complete URI now reaches the handler and decodes its SP keys. Nine malformed/unsupported URI cases reject. | PASS, local form/handler scope; browser verification belongs to integration owner |
| SP-PARSER-005 / SP-06 | Ordinary fields inside a PSBTv2 container | Local actual parser and installed bitcoinjs-lib field decoders | Reproduced malformed BIP32 key accepted as valid; malformed derivation, Taproot derivation, signature bytes and preimage key now reject; all official BIP375 structural vectors still pass. | PASS, local parser scope |
| SP-STORE-003 / SP-01,02,03 | Replay of older shared block | Controlled source/storage used above | Heights 12 and 13 persisted; replaying height 12 retains both rows and height 13 checkpoint without another write. | PASS, controlled test; MySQL/Signet lifecycle remains BLOCKED |
| SP-SUPPORT-001 / SP-04 | Persisted support record validation | Controlled public-evidence fixture through actual service reader | String-valued capability flags, missing names and malformed evidence URLs reject. Complete versioned records preserve explicit false capabilities. | PASS, local contract test; actual wallet evidence remains BLOCKED |
| SP-MYSQL-001 / SP-01,02,03 | Disposable local MySQL persistence preflight | Existing Windows MySQL84 service, local port 3306 | Service/listener exists. No approved local credential source is configured for this checkout, so no SQL connection, schema creation or data mutation was attempted. | BLOCKED, local authentication/access prerequisite; distinct from missing real Signet input |
| SP-SCAN-003 / Q04 | Requested checkpoint and cancellation | Actual component/API consumer and local bundle verifier | Different returned height rejects; cancelling pending manifest read unsubscribes it, requests no bundle, clears key/results and leaves completion false. | PASS, local consumer checks |
| SP-01,02,03 / Q04 live | Coverage to manifest to bundle to received-output readback | Requires configured owned Signet Core and matching shared transaction source with prevouts, approved MySQL, shared completed-block event and controlled receiver | No real Signet block ingestion, persisted MySQL readback, confirmed match, or real browser scanner journey established by this worker. | BLOCKED, exact infrastructure prerequisites above |
| SP-04 live | Support registry | Requires stored versioned wallet support evidence | Old synthetic claims removed; empty evidence store does not mean wallets lack support. | BLOCKED, missing versioned capability evidence |

Commands executed locally:

```powershell
# backend directory
node node_modules/jest/bin/jest.js --runInBand --coverage=false src/api/intelligence/silent-payments
# 74 tests passed across 2 suites in the follow-up review
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json --pretty false
# passed
# frontend directory
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json --pretty false
node node_modules/vitest/vitest.mjs run src/app/universe/silent-payments/silent-payments-scanner.spec.ts
# 8 tests passed in the follow-up review
```

New files: `silent-payments-parsers.ts`, `silent-payments-ingestion.ts`, `silent-payments-runtime.test.ts`, `bip375-public-vectors.json`, `silent-payments-scanner.ts`, `silent-payments-scanner.spec.ts`, `silent-payments-samples.ts`, and this acceptance document. The original `silent-payments.test.ts` was replaced with meaningful regressions. The BIP375 fixture keeps only descriptions and public PSBTs, with source content SHA-256; supplementary material was excluded.

Specification provenance: [BIP321](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki), [BIP352](https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki), [BIP352 official vectors](https://github.com/bitcoin/bips/blob/master/bip-0352/send_and_receive_test_vectors.json), [BIP375 v0.1.1](https://github.com/bitcoin/bips/blob/master/bip-0375.mediawiki), [BIP375 official vectors](https://github.com/bitcoin/bips/blob/master/bip-0375/bip375_test_vectors.json), [BIP376 draft](https://github.com/bitcoin/bips/blob/master/bip-0376.mediawiki), read 2026-09-05. BIP376 still marks its test-vector section TODO, so locally constructed draft encodings are not labeled official vectors.

FUNCTIONAL NO-GO remains for real Silent Payments ingestion/scanning until the named owned dependencies and controlled Signet journey are verified. Parser outputs require no blockchain spend to pass their narrower scope.

Local MySQL follow-up: `D:\universe\mempool\.runtime\acceptance-mempool-config.json` disables the database and contains no connection credentials. No local `backend/mempool-config.json` exists. The checked-in backend test config targets its Docker fixture on port 33306; it is not evidence of credentials for the existing port-3306 service. No `DB_*`, `MYSQL_*` or `TEST_MYSQL_*` connection variables, user MySQL login file, or standard client credential configuration was found. MySQL84's `C:\ProgramData\MySQL\MySQL Server 8.4\my.ini` contains no client authentication configuration. The existing integration setup/teardown starts Docker and truncates tables, so it was not run against the shared service. An approved local credential loader with permission to create and drop a uniquely named disposable database is required for actual SQL lifecycle acceptance. Existing databases, users, credentials and services were unchanged.

Initial worker verification: scoped backend ESLint completed with 0 errors and 43 non-blocking warnings (mostly inferred return types, test `any` values and non-null assertions); no lint rule was disabled. Required async error propagation is annotated at the caught service/route boundaries and Jest-owned callback boundaries. Follow-up scoped backend verification passed 74 tests. Frontend scanner/form tests passed 8/8 and frontend/backend TypeScript checks passed. Scoped backend ESLint has no errors; `git diff --check` passed for this scope. The five existing Silent Payments components use the shared `--u-text-muted` theme token for muted helper text and placeholders; the integration owner performs the final contrast/browser recheck.
