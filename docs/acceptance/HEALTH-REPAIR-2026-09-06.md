# Explorer health repair evidence

The health handoff is now bound to the existing application ledger. Its source findings remain historical evidence. Importing the handoff does not establish a current runtime or end-to-end pass.

Later mobile source and backend reference corrections are recorded separately in `mobile-source-repair-2026-09-06.json` and `mobile-repair-2026-09-06/README.md`. They preserve the earlier actual serving revisions and do not add operation or mobile acceptance passes.

The initial health repair production-code checkpoint is mempool `c65ab3fb00117e8515b22d40d5a3e2aa62d38f6f`; repository revision `453a3ecaf02c4fd46a7a06a59f171d40e8d3c281` adds only workflow and documentation changes. Final checks passed 76 backend suites / 730 tests, with four explicit live Esplora skips, and 97 frontend files / 1,543 tests. The backend build passed. Exact log summaries and hashes are in `health-runtime-2026-09-06/validation.json`. These checks do not establish whole-application readiness.

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

The candidate's single registry response contains all 39 exact identity/descriptor records from the current manifest. Those 39 registry rows have a narrowly scoped `PASS LOCAL` for contract publication. The actual configured-source inventory identifies each required protocol authority as unconfigured, so all 80 separate data descriptor rows remain `BLOCKED`; no data-route calls were invented. All 1,587 matrix IDs comprise the preserved 1,546 rows, 40 health scenarios and one additive current route. That health checkpoint recorded 42 scoped local passes, 149 blocked and 1,396 untested. The later supplied-proof engine evidence below adds two API and two consumer local passes: the current overlay therefore contains 46 scoped local passes and 145 blocked rows, leaving 1,396 untested rows when applied to the preserved 1,587-row matrix. There are zero full real-network E2E passes and no reconciled operation denominator. Local pass counts are not application coverage. Regeneration must use the current evidence overlay after the final source merge.

Prepared configuration for an indexed checkpoint must set `chainReference: false`. An index checkpoint must not become the base-chain reference when a distinct node observation is absent or stale. The archived launcher preserves the configuration that was actually measured; this preparation requirement is not retroactively inserted into its evidence. A later backend-apis repair for stale explicit-node-observation fallback needs its own source tests and runtime evidence, and does not change the recorded `8b2` runtime identity.

`prior-execution-evidence-2026-09-06T0705.json` preserves the prior overlay exactly. Current rows retain its applicable assertions separately from the new evidence. Backend-apis PR #178 merged to develop at `237005add5a8294dad86cf3fa9aa0cd3b3ec5f8b` after CI passed 423 unit suites / 4,572 tests and four integration-framework suites / 27 tests. Framework integration results are separate from owned-source network acceptance; the tested runtime overlay still has its original `8b2` revision.

## Remaining denominator limits

The inherited inventory contains overlapping source groups: 351 navigation identities, 39 protocol identities, 37 original named operations, 304 UI candidates, 546 API candidates, 302 components, 1,569 controls and 344 handler bindings. These numbers cannot be summed into operation coverage.

The older 243-row handoff still lacks its original `known_coverage.json`, `source_ledger.json`, `audit_report.md`, `protocol_inventory.md`, `anima-dispatch-evidence.json` and `gateway-anima-regression.test.mjs`. Those files are not in the four-file health handoff. The missing ledger's IDs and results must not be reconstructed from its count.

The existing generator also records eight outbound HTTP calls that were included among API registration candidates. They remain preserved and identified as outbound calls; they are not silently counted as mounted public routes. Conditional mounting, generic dispatch selectors, query/event/role variants and exact UI-to-API dependencies still require semantic reconciliation. The private resource route accepts a broader shared contract than the seven resource kinds advertised by Explorer; that validation behavior remains required without inventing new products.

`operationDenominatorReconciled` therefore remains `false`, `operationDenominator` remains `null`, and no functional GO is established by the supplement import.

## WP07 verification integrity and missing implementations

`wp07-repair-2026-09-06.json` records the exact changed-source hashes at mempool commit `64d9ebccd6deb1da07c14fbb3fe77596af1f3646`, public test vector, focused regression outcomes and full backend validation. Later unrelated candidate fixes require their own validation and runtime binding. `wp07-execution-evidence-2026-09-06.json` is the separately mergeable operation overlay. That initial overlay kept its affected operations `BLOCKED`: repairing a false verdict alone did not supply the missing engine, authority or real consumer journey. The later engine archive below accepts only two supplied-input verifier APIs and their two consumers; unrelated operations remain blocked. A prior overlay assertion remains available under `previousExecutionAssertions` when a row has new evidence.

Bootstrap no longer returns seeded node observations, invented signed snapshots, caller-checksum verification success or imaginary in-memory operator jobs. The first OpenTimestamps repair removed fabricated calendar health, stamped receipts, upgraded proofs and confirmed Bitcoin attestations. Calendar, stamp and upgrade routes still name their unavailable integrations. The later detached-proof parser and owned-header verifier now implement the supplied-proof verification route, with explicit pending, invalid and unavailable outcomes.

MuSig2 no longer derives an aggregate key by hashing participant strings, certifies a final signature by its length, or accepts a vendor manifest merely because it contains signature text. The initial repair used the pinned `tiny-secp256k1` dependency for a real final BIP340 signature check over a supplied public key and message hash. Its partial result did not claim participant aggregation, nonces or partial signatures were verified. The later BIP327 engine computes untweaked participant and nonce aggregation, verifies every supplied partial, computes the final signature and verifies BIP340 over the supplied message hash. The provided transcript is a bounded public-data verification scope; it does not create signing rounds or authenticate participants. The relevant primary specifications are [BIP340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki), [BIP327](https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki) and the [pinned library API](https://github.com/bitcoinjs/tiny-secp256k1).

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
| OpenTimestamps stamp, upgrade and calendar/batch/anchor observations | Owned calendar submission/upgrade clients and durable directory/observation sources; these operations remain unavailable | Actual approved calendar submission/upgrade response, readback and consumer result; supplied-proof verification is implemented and separately measured below |
| Additional OTS verification networks and failure scopes | The implemented verifier needs a configured owned reader for each selected network; actual verification evidence here is Mainnet only | Separate owned-source journeys for other networks and runtime outage/reorganization cases; local regression results alone do not certify those journeys |
| MuSig2 scopes beyond the supplied untweaked public transcript | Tweak support is explicitly rejected; secret signing, nonce generation, participant authentication, transaction-sighash derivation and cross-session nonce-reuse assurance are outside this public-data verifier | Separately implemented and measured scopes before any expanded claim; untweaked key/nonce/partial/final verification is implemented and measured below |
| MuSig2 session display, product conformance and vendor manifests | Durable session reader with verified transitions, trusted product/vendor directory, version-specific conformance runs and vendor signed-payload contract | Exact session readback, actual versioned vector results and signature validation against an authenticated vendor key |
| RGB consignment validation | Compatible RGB validation engine and owned Bitcoin commitment/seal-state authority; current component exposes no connected validator | Actual consignment decoding, schema/transition validation, commitment and single-use-seal checks, including invalid/conflicting cases |

Current registration and route inspection resolves the WP07 handlers as public requests with no per-handler authorization guard; deployment gateway policy is separate. The operator prerequisite above is therefore required before any executor is connected. The 39-identity protocol registry and its 119 descriptors do not implement these separate advertised tools.

At the initial WP07 checkpoint, the full backend result was 74 passing suites, 705 passing tests and four skipped tests. Those four cases are the live Esplora address summary, history, UTXO and multi-page cursor checks gated by `UNIVERSE_ESPLORA_CONTRACT_URL`; they were not exercised. The pinned Jest configuration also excludes `__integration_tests__` from this command. Full backend lint returned zero errors and 1,387 warnings; source type checking passed. Focused frontend service/receipt checks passed six tests and the rendered session regression passed one test. These are local implementation evidence, with no real WP07 network or complete application acceptance inferred. Remaining positive-response contracts outside the separately accepted scopes, unconnected engines and end-to-end failure/recovery cases remain unaccepted.

## Supplied-proof engine runtime and readable consumers

`engine-runtime-2026-09-06/review.json` indexes exact public inputs, scripts, API observations, screenshots and validation logs. The actual monolith was `0a8e1575039218709d45f5957290253454b3a0d4`. Direct and gateway runs each passed 13 HTTP assertions, including explicit result fields and negative controls. The eight initial consumer assertions bound frontend `0a8e15750` to that monolith; those screenshots retained visible contrast defects and are not visual passes.

The final supplied-proof checks bound frontend `4e9c2749b5ede261a55cd1388fac1e66469eaefd` to the same actual monolith `0a8e15750`. Both tools passed light and dark checks at widths 390 and 1,440: eight actual API/result assertions, no sampled text contrast failures and no horizontal document overflow. Four representative screenshots were manually reviewed by the executing root agent. The intermediate `a974f79f3` phase remains preserved as three passes and five failures, with its exact low-contrast findings. These observations do not automatically propagate to later merged or rebuilt source.

| Preserved API / consumer IDs | Accepted local scope | Remaining limits |
| --- | --- | --- |
| `API-8f2d0a9754f2` / `UI-1afe77615c32` | The public hello-world detached proof and expected SHA-256 digest verify against actual owned Mainnet reads from `https://explorer.bitcoinuniverse.io/api`. The API and consumer display block 358391, hash `000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319`, and time `2015-05-28T15:41:18.000Z`. Observed negative controls cover digest mismatch, invalid commitment, pending/unknown attestations, wrong network and malformed proof; browser controls cover stale-verdict clearing and reload/resubmission. | No calendar submission or upgrade, no independent full-chain validation, and no accepted journey for additional networks or all runtime outage/reorg cases. Proof URLs are not fetched. |
| `API-4edb832dd83d` / `UI-a270e89bb4c9` | A provided untweaked official BIP327 transcript produces the exact independently pinned final signature after key/nonce aggregation and every partial check. Actual negative controls reject a corrupt partial and unsupported tweaks; key-only requests remain explicitly partial. The consumer displays the exact signature and clears old verdicts when input changes. | No secret signing, nonce generation, authenticated participants, transaction-sighash derivation, cross-session nonce-reuse assurance, durable signing-session service or vendor trust. |

A subsequent independent integration follow-up served frontend `bbca7f46873d35c5f6146cbb33b3e4cab09f926f` with the same actual monolith `0a8e15750`. Its production build and 100 frontend files / 1,577 tests passed, followed by all eight exact provided-proof positive theme/width checks. `integration-followup/` preserves these new reports, screenshots, script and reviewed merge evidence; incoming PR #101 revision `ff2a108247a47a214db471850078ef8fcd98bf88` is a verified ancestor. Earlier source0a negative controls and source4e9 visual results retain their original identities. No operation pass is added by the repeat.

These four rows are `PASS LOCAL` only within their recorded scopes. `T-17`, durable session display, stamp/upgrade and unrelated Bootstrap, private-relay, receipt-trust and RGB operations remain blocked by their concrete prerequisites. Earlier assertions remain in each row's `previousExecutionAssertions`; no original ID was removed.

The engine checkpoint passed 79 backend suites / 809 tests with four explicit live Esplora skips, and 100 frontend files / 1,577 tests. Both builds passed. Full lint reported zero errors with 1,428 backend warnings and 2,611 frontend warnings. Gateway regressions passed 29 tests; the local diagnostic probe passed 21 checks. The 72-test MuSig2 and 53-test OTS subsets overlap shared integrity tests and are not additional tests to add to the full total. These validation results do not certify full application or full-site mobile readiness. Exact logs, source boundaries and hashes are in the archive.

## Integration trigger evidence

The final source follow-up is `a96c96fbbe8aa115fc69619578e4f5fb2e64452d`. The merged PR #101 narrow-layout rule initially compressed a transaction link inside a scrolling table to 28.41px wide and 477.8px tall. The follow-up preserves the intact identifier inside the existing named scroll region. Its production build and all five targeted mobile checks passed. `mobile-integration-2026-09-06/review.json` preserves the prior 80-case attempt at `bbca7f468`: 75 passes, two measured layout failures and three browser exits before measurement. The five final checks cover the two repairs and the three previously unmeasured cases. This is scoped fixture-backed layout evidence, with no claim of a single complete full-site mobile run. Earlier proof-consumer results retain their exact frontend and monolith bindings.

Backend-apis companion PR #179 also merged to develop at `7bf6ffc16d48f4f0c11e122d02385138f9b5de2e`, after 423 unit suites / 4,574 tests and four integration-framework suites / 27 tests passed. Its source revision `b9ddc216c1fd4dd0a478f2fc44f929d4195dbe9b` prevents stale explicit node observations from being silently replaced by fresh-looking index references. Final mempool integration is tracked by [PR #102](https://github.com/bitcoinuniverseio/mempool/pull/102); its required checks and latest preserved PR #101 head must be rechecked before merge. The archived local results do not assert that future CI has passed.

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
