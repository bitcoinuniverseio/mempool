# Mainnet preparation, 2026-09-23

## Decision and evidence limits

**NO-GO. Preparation is partial; implementation, full functional acceptance and public release are not complete.** No production configuration, runtime logic, permissions, database, live transaction or deployed artifact was changed by this preparation.

The isolated GitHub branch is `audit/mainnet-prep-20260923-1745`, based on `079dc0d79755bc986bfae3288ffe0e479da3e1f6` (develop). At inspection main was `b2009ac8e2e6a8f594659cc526edd74eea1c534a`; it added a merge commit with no source-tree differences. The source-annotation revision before this index is `f364046c91facde0dd339ac129b17378c58f412f`. Its three commits add 119 comment lines with no deletions. This index is a new non-executable document.

The SERVER checkout is `D:\universe\mempool\mempool`, whose HEAD file names main. Uncommitted changes, actual Git worktree registration and current service/process state were not established: three Remote Desktop Commander terminal attempts, including read-only Git and Node version commands, were blocked by safety checks. Do not bypass those restrictions or alter the shared checkout. The GitHub branch is real; a prepared SERVER Git worktree is not claimed.

The created SERVER handoff directory is `D:\universe\mempool\audits\implementation-prep-20260923-1745\mempool_HANDOFF_2026-09-23`. Directory creation alone does not prove a prompt or ZIP was saved; consult the final handoff delivery receipt. Workspace AGENTS.md was read but is not redistributed because it contains credentials. Treat secrets as credentials, never as report content.

## Implementation status, 2026-09-23 evening

Implemented on `implement/mainnet-20260923` (PR #136) from the prepared revision `161b7bdd0`. Unit, integration-style and archive tests pass as listed in the PR. **None of this is functional acceptance, and nothing was released.**

| ID | Disposition | Functional status |
|---|---|---|
| M23-NET | IMPLEMENTED. Typed unavailable result, owning-contract keys and networks, every caller updated; the source marker is replaced by rationale | Unit and consumer tests PASS; supported-network journey NOT TESTED |
| M23-HEALTH | IMPLEMENTED in `capabilities.mining.ts` (lag bound `MEMPOOL.MINING_MAX_BEHIND_TIP`, fresh same-network Core reading, `unknown` state). The live outage cause is verified and repaired (below); an outstanding note replaces the marker | Unit and report tests PASS; Signet API-to-UI NOT TESTED |
| M23-PACK | IMPLEMENTED. `--stage-acceptance`, `docs` in the archive, `qualify-artifact.mjs` before upload; the marker is replaced by rationale | Real-archive tests PASS; a real workflow run needs a qualified envelope, which does not exist |
| M23-BASE | DONE. Worktree `D:\universe\mempool\.worktrees\mainnet-execution-20260923`, Node 24.19.0, npm 11.17.0; running backend 537235052, overlay fcdc2e2f | n/a |
| M23-AUTHORITY | NOT STARTED in owning repositories | BLOCKED: the production overlay reports every Bitcoin protocol unavailable on Signet and Testnet and every Dogecoin and Zcash protocol unavailable on Testnet |
| M23-COVERAGE | Matrix regenerated for changed sources; still `operationDenominatorReconciled: false` | NOT TESTED |
| M23-ACCEPT | NOT EXECUTED | BLOCKED on M23-AUTHORITY |
| M23-RELEASE | NOT EXECUTED; `gate_qualified_acceptance` correctly refuses without a qualified envelope | BLOCKED |

**F-M23-04 cause, verified and repaired.** Fulcrum (`universe-fulcrum`, 127.0.0.1:50001), the explorer's electrum address index, stopped cleanly at 2026-09-22T13:05Z. The Bitcoin Core migration to the OVH node stopped `bitcoin.service`, and Fulcrum and its dependents went down in the same cascade. Nothing restarted them. `bitcoin.service` is now the RPC bridge to the migrated node, so starting Fulcrum was safe. It was restarted at 2026-09-23T20:55Z, caught up 175 blocks, and `addressLookup` reports ready at 968318. The explorer checkpoint stayed at 968172, the migration's frozen height, because the block loop was waiting on the dead index.

## Source annotation index

| ID | Actual source anchor | Dependencies | Preparation | Functional status |
|---|---|---|---|---|
| M23-NET | frontend/src/app/universe/chain-network.ts, parse, IMPLEMENTATION-HANDOFF [M23-NET] | M23-BASE | ANNOTATED | FAIL F-M23-02; no repair |
| M23-PACK | .github/workflows/universe-release-artifact.yml, Pack step, IMPLEMENTATION-HANDOFF [M23-PACK] | M23-BASE; existing qualified acceptance work | ANNOTATED | FAIL F-M23-01; no repair |
| M23-HEALTH | backend/src/api/capabilities.routes.ts, capabilities.$report consumer, IMPLEMENTATION-HANDOFF [M23-HEALTH] | M23-BASE, M23-NET | ANNOTATED at API integration point | FAIL F-M23-03/F-M23-04; owning mining helper still needs file-local annotation and implementation |
| M23-BASE | Isolated worktree and running identities | none | BLOCKED on SERVER terminal | NOT TESTED |
| M23-AUTHORITY | backend-apis chain health and named indexers | M23-BASE, M23-NET | NOT ANNOTATED in owning repositories | Operational failures below; individual journeys NOT TESTED |
| M23-COVERAGE | scripts/universe/acceptance-matrix.mjs and owning API registry | M23-BASE | Existing source reviewed; new work not annotated | NOT TESTED; denominator unreconciled |
| M23-ACCEPT | Actual services, UI and protocol operations | all relevant repairs | NOT IMPLEMENTED | NOT TESTED |
| M23-RELEASE | release.sh, accepted artifacts, routing and public endpoints | all acceptance gates | NOT EXECUTED | BLOCKED |

## Confirmed defects and operational observations

1. **F-M23-01, release packaging.** The pinned workflow stages `docs/protocols/PROTOCOL-COVERAGE.json` and `docs/acceptance/qualified-release-evidence.json`, then runs `tar -czf "$out" -C "$stage" backend frontend scripts production RELEASE-MANIFEST.json`. Neither document enters the archive. `scripts/universe/release.sh:gate_qualified_acceptance` requires a manifest and candidate-contained evidence before cutover. Repair the member list and complete rooted evidence closure, then qualify the extracted actual artifact without access to the checkout. Missing evidence, wrong hashes, traversal, escaping symlinks and stale candidate identities must fail. Extend `release-gates.test.mjs` beyond string-presence assertions.

2. **F-M23-02, network isolation.** `parse` drops malformed JSON and unsupported explicit network entries; `chainNetwork` then uses mainnet. The current unit tests intentionally expect this. In the isolated Linux sandbox, actual TypeScript source transpilation reproduced Dogecoin signet and malformed JSON falling back to mainnet. No API request or transaction was sent. Preserve genuinely absent production defaults, but reject explicit invalid contexts through a typed unavailable state, suppress wrong-network requests, clear stale context and update all parser consumers together.

3. **F-M23-03, mining readiness.** In pinned `backend/src/api/capabilities.ts:$miningReport`, `indexed = total > 0 && poolCount > 0` decides readiness; highest indexed height and data age do not participate. Compare a completed indexed checkpoint to a fresh same-network node checkpoint. Do not equate time since the last mined block with collector health; represent missing/stale reference information separately.

4. **F-M23-04, Bitcoin operational degradation.** First-party public operational GET observations on 2026-09-23, not mainnet functional tests:
   - `/api/v1/backend-info`: release `537235052`, node blocks/headers 968299, initialBlockDownload false, completed explorer checkpoint 968172, a 127-block difference. GitHub resolves that reported prefix to `537235052b9f2d2908aa70c41c4e66c79fcd5e4a` (September 19), not the inspected main revision.
   - `/api/v1/capabilities`, generated 17:39:41.778Z: addressLookup unavailable, configured address index did not answer, backendKind electrum. Statistics degraded with 80936 seconds lag. Mining ready despite indexed tip 968172 and 82474 seconds reported age.
   - The outage/ingestion root causes are unresolved. Inspect authorized service identity, index reachability, cookie/configuration freshness, Core/cache/SQL checkpoints and collector logs before selecting a repair. Do not blindly restart active indexers or reorg processing.

5. **F-M23-05, authority availability.** `/api/v1/chains`, observed 17:39:53.152Z, reported ready=false for Bitcoin, Dogecoin and Zcash, with overlay release `fcdc2e2f3bd226bead63cdf0b81fad1ef1ad45bd`. Bitcoin included ten unconfigured authorities and numerous stale/lagged authorities; ready/qualified did not always mean complete historical coverage. Dogecoin block/address history authorities were unavailable; doginals/drc20/dunes were 1380833 blocks behind the node. Zcash zerdinals/zrunes/zrc20 were partial and unqualified. These are operational failures, not proof that each individual transaction journey was executed. Preserve indexing progress, bound load and resolve each authority's own prerequisite.

6. **F-M23-06, Zcash synchronization inconsistency.** The same response published synced=true and initialBlockDownload=true. Root cause is unresolved. Zcash 6.12.2 RPC documents `initial_block_download_complete`, whose meaning is opposite to Bitcoin's `initialblockdownload`. Inspect the actual deployed node implementation and normalization before changing semantics; do not assume field parity between node families.

## Coverage and research boundaries

The pinned protocol roster at `docs/protocols/PROTOCOL-COVERAGE.json` identifies 39 protocols, registry 1.1.0, owner backend-apis revision `7ec4602e7a5dcd6495268ae64698280657cc9c73`. Its seven historical readable declarations are not current test passes. Its read descriptors do not cover the whole application. CAT20/Fractal is the 39th identity outside the three-chain response; absence there is not independently established as a defect.

The existing `acceptance-matrix.mjs` intentionally records `operationDenominatorReconciled: false` and `FUNCTIONAL NO-GO`. Reconcile its actual source candidates rather than changing those fields to claim completion. Retain all offered APIs, public UI, admin authorization, workers, node/indexer paths, portfolio and observatory/tool capabilities. Do not invent minting, trading or key custody merely because a protocol supports them; do not exclude an actually offered integration because an older README lacks it.

Primary sources reviewed include Bitcoin Core 31.0 getblockchaininfo RPC, BIP 325 Signet, Zcash 6.12.2 getblockchaininfo RPC, Esplora API and Ord API documentation, plus pinned repository contracts. Complete protocol-by-protocol governing specification/version research and operation traceability were not achieved. Missing pins, exact authority prerequisites and unexecuted checks remain explicit work, not completed research.

## Validation and next sequence

Exact UTF-8 snapshots of all three baseline and annotated files were checked against six Git blob hashes. TypeScript 5.8.3 transpilation produced identical comment-stripped JavaScript before/after. Parsed workflow YAML structures were equal. An isolated tar-member reproduction confirmed missing docs. The preparation patch applied to disposable copies and reproduced the annotated bytes. Environment: Linux sandbox, Node v22.16.0, not the SERVER-pinned Node 24.19.0. These results prove preparation/reproduction properties only, not a full build, lint, project typecheck, Signet pass or release.

Continue M23-BASE, network isolation and authoritative state repair, then per-authority/protocol requirements, persistence/recovery, API/UI integration, complete operation reconciliation and real acceptance, then packaging and gated release. Preserve existing work and first-party-only data infrastructure. Full Signet PASS is functional acceptance where supported; use an explicitly justified supported testnet otherwise. No mainnet funds or test transactions. Test-network/mainnet differences need offline/configuration evidence. Public release follows only after every applicable operation passes and every repair/dependency regression is evidenced. No release is claimed here.
