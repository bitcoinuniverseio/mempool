# Maintained operation matrix

The [JSON matrix](operation-matrix-2026-09-06.json) imports both existing inventories and every named Markdown table row under `docs/acceptance`. Original IDs remain intact, including all Q05-P01 through Q05-P36 and Q07-A01 through Q07-A12 rows. Historical assertions stay separate from the current acceptance status.

The matrix remains **FUNCTIONAL NO-GO**, with `operationDenominatorReconciled: false` and `operationDenominator: null`. Its source groups overlap. Their sizes and the number of matrix records are not the application operation denominator or a coverage percentage.

The expansion adds 119 distinct protocol read descriptors across all 39 identities, the seven advertised admin resource kinds as 14 list/detail operations, 26 catalog preview/execute variants including both indexing task arguments, two snapshot point types and four delta point combinations. Mainnet declarations are preserved as source declarations and never become inferred support or an additional mainnet acceptance gate.

The generator resolves literal route expressions and the recorded API prefix default without running application code. It links identical methods/routes and exact recorded entry/component source identities. It records mounting conditions from the registration source. Unresolved expressions, generic selectors, abbreviated routes and remaining authorization/query/event variants remain explicit reconciliation work. Eight candidates from the API inventory are outbound Axios calls, not route registrations; their original IDs remain present with that source classification.

The shared admin contract accepts more resource kind names than the seven advertised by Explorer. The matrix retains the seven actual advertised operations and records the broader guard acceptance as a behavior to check; it does not manufacture other admin products.

The named handoff bundle was not found by exact-filename searches under the attachment directory or this project's `audits` and `.tmp` directories. The matrix records the missing six filenames and search roots. The described 243 rows are not recreated or substituted for the larger inventories.

## Reproduction

Run from the repository root:

```powershell
node --test scripts/universe/acceptance-matrix.test.mjs
node scripts/universe/acceptance-matrix.mjs
node scripts/universe/acceptance-matrix.mjs --check
```

Generation performs source reads and writes only the matrix artifact. It starts no service, browser, database, workflow or network probe. Current source rows begin as `NOT TESTED` with no evidence. Required service names in the protocol rows describe dependencies, not observations that those services are down.

Every imported row has its original JSON pointer or Markdown line and a SHA-256 source lineage. All controls and handlers from the source inventory remain available under `sourceCandidates`. Component and implementation source hashes identify the bytes examined. `--check` rejects lost/duplicate IDs, dangling links, invalid lineage, unsupported passes and a stale artifact. Concurrent source changes require regeneration after the integration owner finishes those edits.

Current execution evidence belongs in a separate, explicitly supplied JSON overlay:

```json
{
  "schemaVersion": "universe-operation-evidence-v1",
  "rows": [
    {
      "id": "SW-03",
      "status": "BLOCKED",
      "scope": "Authenticated provider directory",
      "blockers": ["PRE-04"],
      "actual": "Authenticated provider registry contract is unavailable in the selected candidate.",
      "evidence": [{ "artifact": "docs/acceptance/swaps-2026-09-06.md" }]
    }
  ]
}
```

Use `--evidence <repo-relative-path.json>` for both generation and `--check`. This example is an overlay shape, not automatically applied evidence. Valid statuses are `NOT TESTED`, `BLOCKED`, `FAIL`, `NOT APPLICABLE`, `PASS LOCAL`, `PASS SIGNET` and `PASS NETWORK`. A pass needs explicit scope and concrete evidence. Network passes additionally need actual network, fixture identity, result and a distinct `journeyId`; repeated references to one real journey are counted once. The tool validates the evidence structure, while the integration owner must verify the evidence itself.

Local generator tests verify real inventory import, all named P/A IDs, descriptor/network separation, every required expansion, compact/range ID handling, and rejection of lost IDs, duplicates, corrupted source hashes and source-only promotion. They do not execute any product operation.
