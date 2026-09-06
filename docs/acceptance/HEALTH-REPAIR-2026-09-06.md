# Explorer health repair evidence

The health handoff is now bound to the existing application ledger. Its source findings remain historical evidence. Importing the handoff does not establish a current runtime or end-to-end pass.

The final production-code candidate is mempool `c65ab3fb00117e8515b22d40d5a3e2aa62d38f6f`; repository revision `453a3ecaf02c4fd46a7a06a59f171d40e8d3c281` adds only workflow and documentation changes. Final checks passed 76 backend suites / 730 tests, with four explicit live Esplora skips, and 97 frontend files / 1,543 tests. The backend build passed. Exact log summaries and hashes are in `health-runtime-2026-09-06/validation.json`. These checks do not establish whole-application readiness.

The implementation candidate started from mempool PR #101 at `d6f9f4677e57c13cf80434f2a9c1009c43b1f304`. Its isolated final frontend worktree preserves the later legitimate baseline `445702835144f1998dc3ed1f79e2ef77ed6871af`, including the request-cache, truthful-failure, bootstrap, mining and visual-fixture repairs. The handoff inspected the older PR head `2ce46d53f414b52f189983515d2dd6d019a2d831`. A source revision alone does not identify serving assets. The corresponding backend-apis candidate is `8b2aea3afd4b2f26e2ee5f1275171a937515cbc2`; runtime evidence must bind these actual candidates separately.

## Preserved identities and evidence

`explorer-health-handoff-2026-09-06.json` preserves the extracted supplement byte-for-byte, SHA-256 `98ed8c95130a94dd30d8d998f4f3a4f84c2b6bfe4aefa084817783600f4805b7`. Its 40 health scenarios comprise 8 historical source-inspection failures, 14 historical blocked runtime checks and 18 untested checks. The generator imports them with their original IDs and retains their previous status, reason and source references under `priorAssertion`.

All 1,546 existing ledger IDs remain. The 40 added health scenarios are a supplemental verification group. They are not a new operation denominator. The existing overlay's 15 blocked rows remain blocked; historical passes are not inherited as new acceptance. A bounded current-source pass also discovers the previously unrecorded `GET /api/v1/intelligence/bootstrap/chainstates`. This receives an additive `API-CURRENT-` ID and its current source references; it does not replace any prior route ID or change the pinned historical count of 546 API candidates.

All 39 protocol identities, authorities and declared operation sets match the current registry. Each of the 119 handoff operation names binds to the existing operation ID: for example, `PRO-01.registry` binds to `PRO-01/registry`. The original period-form ID is retained in `handoffBinding.coverageId`; the original slash-form ledger ID, exact descriptor method, route, authority path and current source hash remain intact. There are no 119 duplicate operation rows.

The Dogecoin and Zcash historical-read scenarios also carry the established API method and path, browser route, public-reader role, pagination query and required confirmed-history source. Network declarations remain distinct from the network actually verified. Selecting Bitcoin Signet cannot certify Dogecoin, Zcash or Fractal.

## Required health checks

The original IDs remain the execution checklist:

- H-01 and H-09: node synchronization and service readiness remain separately visible; configuration, transport, incomplete scan and protocol qualification have distinct explanations.
- H-02: requests and responses preserve the selected supported chain/network, including an in-flight Bitcoin network switch.
- H-03, H-04 and H-08: missing measurements remain unknown; node, confirmed and protocol observations keep their own authorities, timestamps and checkpoints; stale observations cannot regain freshness by being re-labelled.
- H-05: configured Bitcoin sources remain visible when their first request fails before any checkpoint exists.
- H-06: a required offered Dunes operation cannot be unavailable while aggregate offered readiness is true.
- H-07: valid confirmed Zcash history survives a missing mempool snapshot.
- R-01: bind the actual frontend assets, gateway and overlay revisions.
- R-02: identify and read every failed Bitcoin authority through its actual route.
- R-03 and R-04-TX, R-04-ADDRESS, R-04-UNSPENT, R-04-SPENT: compare real Dogecoin block, transaction, paginated address, unspent and spent outpoint results through owned authority, API and consumer.
- R-05 and R-06-BLOCK, R-06-TX, R-06-ADDRESS, R-06-OUTPOINT: distinguish Zcash node synchronization, scan completeness and tri-state protocol qualification, and verify the four confirmed-history reads.
- R-07: execute every protocol descriptor independently. A registry response certifies no data read.
- R-08: reconcile the complete required operation set without dropping IDs, conditional routes or unresolved dependencies.
- T-01 through T-05: test healthy-node/service-failure separation, absent confirmed sources, both false and unknown Zcash qualification, and confirmed history without mempool.
- T-06 through T-10: test absent/ahead reference heights, hash conflicts and controlled reorganization, first-request source failure, Dunes failure, stale success, timeout and genuine recovery.
- T-11 through T-15: test network changes and reload, object absence versus dependency failure and malformed success, a valid empty mempool, responsive keyboard-accessible diagnostics, pagination, batching, retry and bounded subscriptions.
- T-16: exercise unauthorized rejection and authorized durable side effects only in an approved isolated scope.
- T-17: establish real verification/relay results and preserve unavailable-versus-empty semantics.

Deterministic regression evidence belongs beside the corresponding health scenario. A completed real consumer journey must carry its own exact reference, verified network, candidate revisions, time and evidence. A local unit test is not a network pass.

## Reviewed candidate runtime

`health-runtime-2026-09-06/review.json` indexes the exact archived scripts, original JSON observations, screenshots and failed browser attempts. Seven actual gateway-served frontend asset hashes match the local build. The frontend and gateway files are unchanged between `64d9ebccd6deb1da07c14fbb3fe77596af1f3646` and the final `c65` source candidate. The tested overlay identifies `8b2aea3afd4b2f26e2ee5f1275171a937515cbc2`. Base Bitcoin requests still went to the older owned public backend `4c93322bb`; the later local transaction-height and metadata-checkpoint fixes were not serving that upstream.

The reviewed block page displayed the exact block hash at height 965545 with 4,012 transactions before and after reload. The address check established the exact identity and its 164-transaction summary, with full pagination and monetary-total correctness still unaccepted. Bitcoin Signet labels and response context survived reload while Dogecoin and Zcash remained explicitly Mainnet; no Signet authority journey passed. The transaction journey remains blocked: its containing block identifies height 965545, while old public and proxied transaction responses reported inconsistent heights 965334 and 965332. The local source regression repair does not erase these failed observations.

Four 390/844 light/dark health geometry measurements and their screenshots were reviewed. Loaded Bitcoin node synchronization remained separately visible from unavailable history and protocol services; diagnostics expanded and Escape closed them. A real local overlay stop caused gateway 502, cleared old UI health to unknown and exposed retry. Restart of that same local candidate plus explicit retry repopulated the response; the underlying authorities still reported unknown/unavailable. No production process was stopped or restarted for that check.

Earlier browser attempts are preserved. Their transaction success label matched an early loading/status banner and is rejected. CSP wait-helper failures, incomplete initial content and forced browser closure are also retained. The original HTTP harness recorded 13 successful checks and two failures: one incorrect synced=true expectation and one real transaction-height discrepancy. This is not a blanket HTTP or browser pass. The isolated HTTPS/WSS harness separately passed 11 transport/trust cases using a synthetic upstream.

The candidate's single registry response contains all 39 exact identity/descriptor records from the current manifest. Those 39 registry rows have a narrowly scoped `PASS LOCAL` for contract publication. The actual configured-source inventory identifies each required protocol authority as unconfigured, so all 80 separate data descriptor rows remain `BLOCKED`; no data-route calls were invented. All 1,587 matrix IDs comprise the preserved 1,546 rows, 40 health scenarios and one additive current route. Current totals are 42 scoped local passes, 149 blocked and 1,396 untested, with zero real-network E2E passes and no reconciled operation denominator. Local pass counts are not application coverage.

Prepared configuration for an indexed checkpoint must set `chainReference: false`. An index checkpoint must not become the base-chain reference when a distinct node observation is absent or stale. The archived launcher preserves the configuration that was actually measured; this preparation requirement is not retroactively inserted into its evidence. A later backend-apis repair for stale explicit-node-observation fallback needs its own source tests and runtime evidence, and does not change the recorded `8b2` runtime identity.

`prior-execution-evidence-2026-09-06T0705.json` preserves the prior overlay exactly. Current rows retain its applicable assertions separately from the new evidence. Backend-apis PR #178 merged to develop at `237005add5a8294dad86cf3fa9aa0cd3b3ec5f8b` after CI passed 423 unit suites / 4,572 tests and four integration-framework suites / 27 tests. Framework integration results are separate from owned-source network acceptance; the tested runtime overlay still has its original `8b2` revision.

## Remaining denominator limits

The inherited inventory contains overlapping source groups: 351 navigation identities, 39 protocol identities, 37 original named operations, 304 UI candidates, 546 API candidates, 302 components, 1,569 controls and 344 handler bindings. These numbers cannot be summed into operation coverage.

The older 243-row handoff still lacks its original `known_coverage.json`, `source_ledger.json`, `audit_report.md`, `protocol_inventory.md`, `anima-dispatch-evidence.json` and `gateway-anima-regression.test.mjs`. Those files are not in the four-file health handoff. The missing ledger's IDs and results must not be reconstructed from its count.

The existing generator also records eight outbound HTTP calls that were included among API registration candidates. They remain preserved and identified as outbound calls; they are not silently counted as mounted public routes. Conditional mounting, generic dispatch selectors, query/event/role variants and exact UI-to-API dependencies still require semantic reconciliation. The private resource route accepts a broader shared contract than the seven resource kinds advertised by Explorer; that validation behavior remains required without inventing new products.

`operationDenominatorReconciled` therefore remains `false`, `operationDenominator` remains `null`, and no functional GO is established by the supplement import.

## WP07 verification integrity and missing implementations

`wp07-repair-2026-09-06.json` records the exact changed-source hashes at mempool commit `64d9ebccd6deb1da07c14fbb3fe77596af1f3646`, public test vector, focused regression outcomes and full backend validation. Later unrelated candidate fixes require their own validation and runtime binding. `wp07-execution-evidence-2026-09-06.json` is the separately mergeable operation overlay. Its affected operations remain `BLOCKED`: repairing a false verdict does not supply its missing engine, authority or real consumer journey. A prior overlay assertion remains available under `previousExecutionAssertions` when a row has new evidence.

Bootstrap no longer returns seeded node observations, invented signed snapshots, caller-checksum verification success or imaginary in-memory operator jobs. OpenTimestamps no longer returns fabricated calendar health, stamped receipts, upgraded proofs or confirmed Bitcoin attestations. These existing routes retain explicit unavailable outcomes naming their missing integrations. Invalid structural input remains distinct from an unavailable verifier.

MuSig2 no longer derives an aggregate key by hashing participant strings, certifies a final signature by its length, or accepts a vendor manifest merely because it contains signature text. The pinned `tiny-secp256k1` dependency now executes a real final BIP340 signature check over the supplied 32-byte public key and message hash. The public BIP340 vector verifies; a zero signature and a different message fail. That partial result never claims that the participant aggregation, nonces, partial signatures or full session were verified. The relevant primary specifications are [BIP340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki), [BIP327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki) and the [pinned library API](https://github.com/bitcoinjs/tiny-secp256k1).

The browser now sends its MuSig2 form to the mounted public-session verification route. An arbitrary session URL shows unavailable progress and parameters rather than invented signing-round completion. Accelerator receipt validation rejects 64-character nonhex transaction IDs, and the receipt UI requires an explicit positive signature verdict and matching receipt, provider and transaction identity before showing success. These checks do not supply receipt trust.

The remaining implementation prerequisites are concrete:

| Offered operation | Missing implementation or authority | Required completion evidence |
| --- | --- | --- |
| Private submission, tracking and abort | Owned Tor/I2P relay client and configuration path, durable queue and cancellation worker; the current service contains no connected relay implementation | Approved isolated transaction observed through enqueue, relay, readback, failure/retry and authorized cancellation; no live-fund substitute |
| Transaction diagnosis and ordering | Owned mempool/policy reader, first-seen relay sensors and template recorder | Exact transaction/block reference with the same real policy and ordering observations in source, API and consumer |
| Accelerator provider reads and receipt verification | Trusted provider-key directory, exact signed-payload encoding and supported signature algorithm | Known authentic receipt plus tampered signature, identity, transaction and replay cases; paid-service assertions need independent evidence |
| Bootstrap nodes, chainstates and planning | Measured owned-node capability/chainstate and capacity readers; compatible trusted snapshot catalogue | Network/version-specific observations and a feasible plan derived from those measurements |
| AssumeUTXO snapshot and manifest verification | Trusted signed catalogue and producer keys, actual snapshot bytes, pinned Core commitments, durable verification records | Actual bytes and all commitments checked against an identified supported Core/network pair, with mismatches rejected |
| Bootstrap operator jobs and polling | Private authorization guard, authorized node executor and durable job store | Unauthorized rejection first, then approved isolated execution and durable readback; current public handlers return unavailable and must not gain an executor without authorization |
| OpenTimestamps stamp, verify and upgrade | Actual owned-calendar client, `.ots` parser and operation/attestation verifier, owned Bitcoin header reader | Valid pending and anchored proofs, digest/operation/header mismatches, actual calendar submission/upgrade response and consumer result |
| MuSig2 public-session verification | BIP327 participant aggregation, nonce and partial-signature engine, including tweak handling where offered | Official valid/invalid BIP327 vectors and real complete public session evidence; final BIP340 validity alone remains insufficient |
| MuSig2 session display, product conformance and vendor manifests | Durable session reader with verified transitions, trusted product/vendor directory, version-specific conformance runs and vendor signed-payload contract | Exact session readback, actual versioned vector results and signature validation against an authenticated vendor key |
| RGB consignment validation | Compatible RGB validation engine and owned Bitcoin commitment/seal-state authority; current component exposes no connected validator | Actual consignment decoding, schema/transition validation, commitment and single-use-seal checks, including invalid/conflicting cases |

Current registration and route inspection resolves the WP07 handlers as public requests with no per-handler authorization guard; deployment gateway policy is separate. The operator prerequisite above is therefore required before any executor is connected. The 39-identity protocol registry and its 119 descriptors do not implement these separate advertised tools.

The full backend result was 74 passing suites, 705 passing tests and four skipped tests. Those four cases are the live Esplora address summary, history, UTXO and multi-page cursor checks gated by `UNIVERSE_ESPLORA_CONTRACT_URL`; they were not exercised. The pinned Jest configuration also excludes `__integration_tests__` from this command. Full backend lint returned zero errors and 1,387 warnings; source type checking passed. Focused frontend service/receipt checks passed six tests and the rendered session regression passed one test. These are local implementation evidence, with no real WP07 network or complete application acceptance inferred. Remaining positive-response contracts outside the scoped receipt repair, protocol engines and end-to-end failure/recovery cases remain unaccepted.

## Integration trigger evidence

Read-only GitHub API inspection on 6 September 2026 checked the current `develop` and `main` workflow inventories and relevant workflow files in both repositories:

- In mempool, `universe-ci.yml` runs on pushes and pull requests to `develop` and `main`. `universe-release-artifact.yml` is dispatch-only. `universe-production-smoke.yml` is dispatch/schedule only. `docker.yml` runs on version tags or pull requests targeting `master`; its Docker restart is a runner build step, not a develop/main merge trigger.
- In backend-apis, the only workflows are `ci.yml`, which runs on pull requests and pushes to `main` and `develop`, and `universe-explorer-overlay-release.yml`, which builds an artifact only on dispatch. These workflow blobs are identical between the two branches. No production deployment or restart command occurs in either workflow.

At inspection, backend-apis remained at develop `5081b7f0e2a597703f755076292817eed4c0eccc` and main `b91cffe226af59e66dbae5229d1739fb2f4ee563`. PR #101 was open against develop and blocked by required checks. Run `34030635773`, job `101479413940`, failed when Firefox could not measure `tx@phone-landscape`: navigation exceeded 45 seconds while waiting for DOM content. This is an uncompleted measurement, not a demonstrated layout defect or an absent Firefox engine. Historical CI is not validation of this candidate.

The inspected ordinary PR/merge paths start CI and do not deploy production through these repository workflows. Refresh exact remote revisions and required checks before integration. No deployment, restart, production data mutation or live-fund action was performed by this ledger work.

## Reproduce the ledger checks

Use the existing pinned dependencies. These source-only checks start no application or browser:

```text
node --test scripts/universe/acceptance-matrix.test.mjs
node scripts/universe/acceptance-matrix.mjs --evidence docs/acceptance/current-execution-evidence.json
node scripts/universe/acceptance-matrix.mjs --check --evidence docs/acceptance/current-execution-evidence.json
git diff --check
```

Regenerate only after source and execution-evidence edits are complete. The generator hashes the actual sources and evidence; a subsequent source edit makes the stored artifact stale. An overlay may record `candidateRevisions`, `verificationTime`, `repairState` and `verificationKind` beside each measured row, while its actual acceptance scope and evidence remain mandatory for a pass.
