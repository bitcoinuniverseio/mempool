# Explorer health repair evidence

The health handoff is now bound to the existing application ledger. Its source findings remain historical evidence. Importing the handoff does not establish a current runtime or end-to-end pass.

The implementation candidate started from mempool PR #101 at `d6f9f4677e57c13cf80434f2a9c1009c43b1f304`, preserving the newer request-cache, truthful-failure, bootstrap, mining and visual-fixture repairs. The handoff inspected the older PR head `2ce46d53f414b52f189983515d2dd6d019a2d831`. Neither revision identifies the serving deployment.

## Preserved identities and evidence

`explorer-health-handoff-2026-09-06.json` preserves the extracted supplement byte-for-byte, SHA-256 `98ed8c95130a94dd30d8d998f4f3a4f84c2b6bfe4aefa084817783600f4805b7`. Its 40 health scenarios comprise 8 historical source-inspection failures, 14 historical blocked runtime checks and 18 untested checks. The generator imports them with their original IDs and retains their previous status, reason and source references under `priorAssertion`.

All 1,546 existing ledger IDs remain. The 40 added health scenarios are a supplemental verification group. They are not a new operation denominator. The existing overlay's 15 blocked rows remain blocked; historical passes are not inherited as new acceptance.

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

## Remaining denominator limits

The inherited inventory contains overlapping source groups: 351 navigation identities, 39 protocol identities, 37 original named operations, 304 UI candidates, 546 API candidates, 302 components, 1,569 controls and 344 handler bindings. These numbers cannot be summed into operation coverage.

The older 243-row handoff still lacks its original `known_coverage.json`, `source_ledger.json`, `audit_report.md`, `protocol_inventory.md`, `anima-dispatch-evidence.json` and `gateway-anima-regression.test.mjs`. Those files are not in the four-file health handoff. The missing ledger's IDs and results must not be reconstructed from its count.

The existing generator also records eight outbound HTTP calls that were included among API registration candidates. They remain preserved and identified as outbound calls; they are not silently counted as mounted public routes. Conditional mounting, generic dispatch selectors, query/event/role variants and exact UI-to-API dependencies still require semantic reconciliation. The private resource route accepts a broader shared contract than the seven resource kinds advertised by Explorer; that validation behavior remains required without inventing new products.

`operationDenominatorReconciled` therefore remains `false`, `operationDenominator` remains `null`, and no functional GO is established by the supplement import.

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
