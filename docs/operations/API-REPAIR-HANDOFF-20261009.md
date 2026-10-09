# Mempool API repair handoff, 9 October 2026

## Implementation qualification status

Implementation is in progress. The preparation account below remains historical;
it does not describe the current candidate. No public Mainnet release or complete
functional acceptance has been performed. The acceptance denominator remains
632 rows, 39 protocols and 123 declared protocol operations.

The candidate preserves the original cancellation repair and concurrent PWA
update fix. It adds scoped fee and live-source proofs, truthful freshness states,
Core network alias normalization in the paired overlay, bounded RPC profiles,
and a configuration-hash cache epoch for frontend bootstrap. The paired overlay
candidate is `bde3982349d69a4330a67de7bc0939492f8a52f6`.

The private Signet API qualification at
`f77c1f1cc42878eff87f4f8d5c6a775abcd897ba` uses the existing owned Core and
Electrs processes. Explicitly configured native Electrum HTTP address reads now
support the existing V1–V4 reconstruction sources, retaining identity,
checkpoint, mempool, history, size and cancellation guards. Ordinary native/API
reconstruction and cancellation passed for all four versions. Browser V1, V2
and V3 completed with exact zero outputs and balance. V4 exposed a frontend
strict-fallback metadata validation mismatch. Candidate
`279a6c0c953e11df64acd2f0db3b846786d49b39` validates the exact 512-byte
metadata reservation with native response replay and negative controls. Browser
V4 subsequently completed with zero outputs and balance under native strict
fallback and cancelled successfully. Its display now distinguishes the observed
global mempool count from retained transaction proofs and metadata.
Large-address bounded history and cancellation were exercised; full reconstruction
and independent output comparison remain unqualified. A bounded large V4 run
processed 2,800 of 13,545 transactions before the existing confirmed-history
deadline returned 504; it cancelled successfully without changing source limits.

Directory and detail labels now keep historical registry declarations separate
from functional coverage. The current registry contract has no per-protocol
accepted counts and evidence bound to network and revision, so functional
coverage remains unverified even for a ready authority or source-contract PASS.
The roster and operation declarations remain unchanged. A qualified acceptance
summary contract is still required before these labels can report completion.

Public confirmed transaction decoding and the nonbroadcast rejection of an
already-known transaction were exercised through the Signet UI. They do not
establish positive funded transaction acceptance. The documented audit wallet
is unloaded, its first public address is empty, and funding across other wallet
addresses has not been measured.

TAP candidate `6f5d2945e26c0e23fa5d0ae60267eb9b16a853d7` now returns stale
readiness before the quarantine count query. Initial metadata reads can still
stall, and fresh readiness retains the count; earlier descriptions of count-free
readiness were incorrect. DMT candidate
`0128c8e2b05d7a0c9318bf385dc41a74f74d06dd` retains bounded worker publication
and keyset reads. Neither candidate has been adopted into a native producer;
TAP's active database work and DMT's insufficient durable I/O headroom remain
qualification prerequisites.

Current receipts are stored separately at
`C:\universe\mempool\audits\implementation-20261009-api`.
Read `CONTINUATION-HANDOFF.json`, `IMPLEMENTATION-RECORD.json` and operation
receipts there for exact revisions and limitations. Native readiness/history,
remaining operation acceptance, integration and public deployment remain required.

## Historical preparation account

This is an applied source annotation handoff, not an implemented or released repair.
The preparation baseline is mempool `81ab0f1523155e1f678812864fc1cdcb9acaa9d8`.
The paired overlay baseline is backend-apis `a3361bdb0d9f06587dca7ae3b8065783f3b2d3f8`.
Executable source, dependency versions, runtime configuration and indexer state
remain unchanged in this stage.

The complete evidence, patches, exact prepared revisions, operation inventories,
verification receipts and implementation prompt are saved on the authorized SERVER:
`C:\universe\mempool\audits\implementation-prep-20261009-api`.
Use its `README.md`, `BASELINES.json`, `SOURCE-ANNOTATIONS.json` and
`IMPLEMENTATION-PROMPT.txt` together. The actual root instructions file
`C:\AGENTS.md` was absent. `C:\universe\AGENTS.md` was available and read.

## Verified causes and work packages

| Work package | Cause or remaining prerequisite | Concrete change |
| --- | --- | --- |
| API-01 | Optional address verification can orphan rejected Core promises and cause fatal EABORTED. | Integrate the existing local cancellation repair `87859cf9f69e4166bdd783a4472c6674a2ef24c3`, preserving stable checkpoint checks and shared RPC limits. |
| API-02 | Several effective overlay origins refuse connections or identify another native role. | Reconcile exact owner, transport, port, protocol, network and authentication before changing a descriptor. Keep browser calls on the same origin. |
| API-03 | Core's `chainSync.chain="main"` is rejected by the overlay's chain claim parser; feeds and collections are separate contracts. | Normalize documented Core network aliases in the right field with conflicting-claim rejection; preserve feed cursors, atomic decimal values, source proofs and readiness. |
| API-04 | Public Signet routes are unconfigured; the Universe live stream currently accepts mainnet only. | Qualify separate existing test-network infrastructure and coordinate REST, stream producer, subscriptions and cache scope. |
| API-05 | Bootstrap/WebSocket caches publish fees without readiness; clients retain a bare replay and can show it during REST503, disconnect and network changes. | Add the shared `universe-fee-estimate-v1` envelope and truthful client freshness/recovery states across dashboard and clock. |
| API-06 | Old topology/parser documentation and prior preparation markers are not current deployment or acceptance evidence. | Execute the full operation matrix, synchronize documentation, integrate accepted changes and complete the public release with rollback evidence. |

Source comments use `IMPLEMENTATION-HANDOFF [API-01]` through
`[API-06]`, with local submarkers. Existing earlier WP markers are historical
instructions and must be reconciled against the current source before reuse.

## Current observations

At 03:42 UTC, the public homepage, backend info and Bitcoin tip routes returned200.
The backend reported revision81ab0f152 and modeelectrum. Fee recommendations
returned503; init-data still contained cached fees with empty loading indicators.
The browser rendered those fees without a stale marker. These are independent
observations, not a declaration that the whole app loads successfully.

All three aggregate chain status documents reported not ready. Bitcoin had a
malformed base-chain observation despite a valid Core mainnet checkpoint.
Dogecoin's node and pending data were available while confirmed/address history
was unavailable. Zcash base data was available but protocol qualification and
history were incomplete. Those states must remain separate in the UI.

The registry still contains39 protocols and123 declared operations, with no
new functional acceptance claimed. The displayed Bitcoin roster had4 of31
readable now. This does not prove every read path, complete history or freshness.

## Native route distinctions

All ports below are private on the named owner, never browser destinations.
Verify the effective restricted forwarding and identity before a cutover.

| Service | Observed role | Qualification |
| --- | --- | --- |
| Explorer | INDEXERS-1 gateway8099, backend8996, overlay3400 | Partial public loading; fee/readiness failures remain. |
| Bitcoin Core | INDEXERS-2 shared owner; clients use their private28332 route | Synced mainnet checkpoint observed. |
| Electrs | INDEXERS-3 shared owner3001/50002; INDEXERS-2 client forward3023/50014 | Mainnet read available; Signet role was failed. |
| Ord0.29 | INDEXERS-2 native8382; INDEXERS-3 shared8383/18383 and status8384; INDEXERS-1 client8380 | Height968232 against tip970578; native flags and catch-up still matter. |
| TAP | INDEXERS-1 native3012, configured Explorer3230 refused | Existing writer active; native read timed out. |
| ChainBloom | INDEXERS-3 native3012 | Explorer's INDEXERS-1:3012 instead reaches TAP. |
| ARC20 | INDEXERS-3 token reader3043 | Explorer's INDEXERS-1:13015 is unified NFT/realms; token reader still not ready. |
| Mezcal | INDEXERS-1 reader3248 to3250 | Current authenticated feed responds; coverage is partial. |
| DMT | INDEXERS-3 producer3044, separate reader3045 | Collections200 does not satisfy token feed503; existing Explorer3247 targets the producer. |
| Drops/OP_DROP | INDEXERS-3 reader3010 | Feeds respond with partial coverage; custody readiness is a separate503. |
| Names/Bitmap | INDEXERS-3 3221/3220 | Existing readiness/history failures; do not relax guards. |

See `indexer-endpoint-matrix.json` and the raw evidence for all remaining
configured and discovered roles, including stopped/stored services. No new
indexer, writer, credential, listener or trust exception was created.

## Verification and acceptance

Preparation checks compare non-comment syntax trees, parse changed files,
run gateway/acceptance/context tests and hold the pinned registry. These checks
do not implement the repairs. Reuse the preserved cancellation candidate's
evidence only while its exact files and prerequisites remain unchanged.

Implementation requires real application Signet journeys, justified Testnet
only where a protocol cannot support Signet, and controlled fault tests.
Read-only explorer features need authoritative API-to-UI proof, refresh and
recovery; no artificial wallet, mint or trade workflow is added. Existing
broadcast/transaction tools retain their applicable Signet tests.

Do not mark operation rows PASS from HTTP200, a health endpoint, source review,
a screenshot or unit tests alone. After every required operation passes, merge
the legitimate accepted release work and deploy through the existing owned
production process. Verify public URLs, revisions and exposure; no mainnet
functional test transaction is required. Keep rollback artifacts and producer
state intact. Update `C:\INDEXERS.md` whenever indexer or routing state changes.
