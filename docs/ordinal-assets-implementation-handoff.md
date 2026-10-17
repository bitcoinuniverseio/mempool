# Ordinal asset implementation handoff

Preparation date: 2026-10-16. Repository: bitcoinuniverseio/mempool. Baseline: `aef1d00038b7c3b438ad6264e1d6b3f13ccf84e7`. Prepared worktree: `C:\universe\mempool\.worktrees\ordinal-assets-prep-20261016`, branch `audit/ordinal-assets-prep-20261016`.

The complete handoff and execution prompt are saved at `C:\universe\mempool\audits\ordinal-assets-prep-20261016`. Read the extracted `SOURCE-ANNOTATIONS.md`, `WORK-PACKAGES.md`, `REPOSITORIES.json`, `RESEARCH-SOURCES.md`, `COVERAGE-MATRIX.json` and `IMPLEMENTATION-PROMPT.md`. Source comments refer to `protocol-research.json`; use the effective normalized report at `reports/integrated-protocol-research.json`, retaining the original report for audit history.

## Shared implementation decisions

This is a comments-and-documentation preparation. It does not implement the requested feature and grants no functional PASS. The required implementation is complete transaction, block and address asset reads for Ordinals, Rare Sats, Names, Bitmap, BRC20, TAP, DMT, UNAT, DUST20 and BLOCK20. Preserve all 39 published identities and their actual offered capabilities on their own chains. Message-only protocols retain their actual evidence/activity semantics without invented holdings. The existing explorer does not need new signing, minting or trading products for this request.

Use stable asset identities across ordinary ruleset upgrades; bind source revisions and activation profiles in validation evidence. Distinguish protocol ancestry, independent facets, inscription parentage, detected markers, accepted operations and current ownership. One underlying asset may appear under several classifications without multiplying its balance. Quantities are exact strings with explicit unit and precision, and aggregates never combine unrelated assets. Keep current, reserved/transferable and historical balances distinct.

Authoritative read projections must reuse accepted protocol state, history, holder generations and position resolvers. UTXO enumeration alone misses account balances. Reveal scanning alone misses ordinary transfers, historical spent assets and protocol-defined block effects. Read all bounded pages, bind them to one coherent checkpoint/generation and reject mixed or orphaned cursors. Unknown, missing, stale and partial coverage cannot prove an empty inventory. Preserve pending versus confirmed/indexed state and refresh after context or confirmation changes.

Every source, cache, cursor and database namespace binds chain/network/genesis, applicable Signet challenge, block hash/height and source generation. Use owned sources only, bounded shared RPC concurrency and existing indexer owners. Preserve active catch-up/reorg and do not create duplicate ingestion or alternate protocol ledgers. Keep credentials server-side and preserve content-origin isolation, CSP, iframe sandboxing and authorization.

Signet is the default Bitcoin acceptance environment. A justified, named supported Testnet may substitute only for a protocol/dependency that cannot support Signet. A complete real read-only source-to-consumer journey does not need a newly created transaction. Real test transactions and isolated funded test wallets are required only for lifecycle cases that need them. Test-network PASS satisfies the functional gate; Mainnet functional tests, funds and transactions are not required. Production rule/configuration differences still need independent specification/offline/configuration checks.

The exact original and normalized audit reports, all source pins, test extension points and unresolved ruleset questions are in the complete handoff. Do not repeat the broad audit. Inspect only targeted drift, changed semantics and recorded prerequisites. Preserve every existing coverage ID and historical failure; add versioned successors. Implement in dependency order, run affected and dependent tests, merge legitimate release work, then complete the authorized public Mainnet release with artifact/receipt/URL evidence and reversible rollout.

## Local source annotations

- AN-ROOT-01 / WP-OPS / `scripts/universe/gateway.mjs` / IMPLEMENTATION-HANDOFF [WP-OPS]
- AN-ROOT-02 / WP-VERIFY / `scripts/universe/required-application-roster.mjs` / IMPLEMENTATION-HANDOFF [WP-VERIFY]
- AN-ROOT-03 / WP-RELEASE / `scripts/universe/release.sh` / IMPLEMENTATION-HANDOFF [WP-RELEASE]
- AN-VERIFY-SOURCE-PROOF / WP-VERIFY / `scripts/universe/required-application-roster.mjs` / IMPLEMENTATION-HANDOFF [WP-VERIFY]
- AN-DECODE-ORD-TAGS / WP-DECODE / `backend/src/api/intelligence/protocols/inscription-envelope.ts` / IMPLEMENTATION-HANDOFF [WP-DECODE]
- AN-DECODE-ORD-ID / WP-DECODE / `backend/src/api/intelligence/protocols/inscription-envelope.ts` / IMPLEMENTATION-HANDOFF [WP-DECODE]
- AN-DECODE-BRC-GRAMMAR / WP-DECODE / `backend/src/api/intelligence/protocols/inscription-envelope.ts` / IMPLEMENTATION-HANDOFF [WP-DECODE]
- AN-DECODE-ORD-CLASSIFICATION / WP-DECODE / `backend/src/api/intelligence/protocols/protocol-registry.service.ts` / IMPLEMENTATION-HANDOFF [WP-DECODE]
- AN-DECODE-ALL-OBSERVATIONS / WP-DECODE / `backend/src/api/intelligence/protocols/protocol-registry.service.ts` / IMPLEMENTATION-HANDOFF [WP-DECODE]
- ANN-FE-TX-CONTRACT / WP-FE-TX / `frontend/src/app/universe/transaction-assets/transaction-assets.types.ts` / IMPLEMENTATION-HANDOFF [WP-FE-TX]
- ANN-FE-TX-VIEW / WP-FE-TX / `frontend/src/app/universe/transaction-assets/transaction-assets.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-TX]
- ANN-FE-TX-API / WP-FE-TX / `frontend/src/app/universe/universe-api.service.ts` / IMPLEMENTATION-HANDOFF [WP-FE-TX]
- ANN-FE-FLOW-REFRESH / WP-FE-FLOW / `frontend/src/app/universe/asset-flow/asset-flow.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-FLOW]
- ANN-FE-FLOW-IDENTITY / WP-FE-FLOW / `frontend/src/app/universe/asset-flow/asset-flow.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-FLOW]
- ANN-FE-BLOCK-COMPONENT / WP-FE-BLOCK / `frontend/src/app/universe/block-protocols/block-protocols.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-BLOCK]
- ANN-FE-BLOCK-API / WP-FE-BLOCK / `frontend/src/app/universe/universe-api.service.ts` / IMPLEMENTATION-HANDOFF [WP-FE-BLOCK]
- ANN-FE-ADDR-COMPONENT / WP-FE-ADDR / `frontend/src/app/universe/address-assets/address-assets.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-ADDR]
- ANN-FE-ADDR-REDUCER / WP-FE-ADDR / `frontend/src/app/universe/address-assets/address-assets.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-ADDR]
- ANN-FE-ADDR-API / WP-FE-ADDR / `frontend/src/app/universe/universe-api.service.ts` / IMPLEMENTATION-HANDOFF [WP-FE-ADDR]
- ANN-FE-REG-CONTRACT / WP-FE-REG / `frontend/src/app/universe/universe.types.ts` / IMPLEMENTATION-HANDOFF [WP-FE-REG]
- ANN-FE-REG-DIRECTORY / WP-FE-REG / `frontend/src/app/universe/protocol-directory/protocol-directory.component.ts` / IMPLEMENTATION-HANDOFF [WP-FE-REG]
- ANN-FE-TX-EMBED / WP-FE-FLOW / `frontend/src/app/components/transaction/transaction.component.html` / IMPLEMENTATION-HANDOFF [WP-FE-FLOW]
- ANN-FE-BLOCK-EMBED / WP-FE-BLOCK / `frontend/src/app/components/block/block.component.html` / IMPLEMENTATION-HANDOFF [WP-FE-BLOCK]
- ANN-FE-ADDR-EMBED / WP-FE-ADDR / `frontend/src/app/components/address/address.component.html` / IMPLEMENTATION-HANDOFF [WP-FE-ADDR]
- ANN-FE-FIXTURE-SAT / WP-FE-FLOW / `scripts/universe/visual-qa/asset-fixtures.mjs` / IMPLEMENTATION-HANDOFF [WP-FE-FLOW]

## Local work packages

### WP-DECODE

```json
{
  "id": "WP-DECODE",
  "repository": "bitcoinuniverseio/mempool",
  "dependsOn": [
    "WP-BE-CONTRACT"
  ],
  "annotationIds": [
    "AN-DECODE-ORD-TAGS",
    "AN-DECODE-ORD-ID",
    "AN-DECODE-BRC-GRAMMAR",
    "AN-DECODE-ORD-CLASSIFICATION",
    "AN-DECODE-ALL-OBSERVATIONS"
  ],
  "sourceIds": [
    "SPEC-ORD",
    "SPEC-ORD-POINTER",
    "SPEC-ORD-PARENT",
    "SPEC-BRC-INDEX",
    "SPEC-BRC-OPI"
  ],
  "status": "FAIL",
  "implementation": "Correct pinned Ord tag, unsigned ID, parser/classification and BRC marker semantics. Return all observations without promoting them to authoritative balances.",
  "acceptance": "Reference differential vectors plus existing decoder regressions, exact IDs and explicit partial observations; authority-needed state stays unresolved until verified.",
  "commands": [
    "npm test -- --runInBand src/api/intelligence/protocols/protocols.test.ts",
    "npm run tsc"
  ],
  "commandWorkingDirectory": "backend",
  "report": "protocol-research.json"
}
```

### WP-FE-ADDR

```json
{
  "id": "WP-FE-ADDR",
  "depends_on": [
    "WP-BE-CONTRACT",
    "WP-BE-INDEX",
    "WP-BE-ADDR",
    "WP-FE-REG"
  ],
  "coverage_ids": [
    "C-FE-ADDR-ALL",
    "C-FE-ADDR-PAGES",
    "C-FE-ADDR-ZERO",
    "C-FE-ADDR-EXACT",
    "C-FE-ADDR-STATE"
  ],
  "scope": "Complete address portfolio via owned address holdings summary, including protocol ledger state and current ownership, exact identity/units, stable pagination and truthful empty/partial evidence.",
  "tests": "From frontend/: npm test -- src/app/universe/address-assets/address-assets.component.spec.ts src/app/universe/universe-api.service.spec.ts src/app/universe/asset-consumers.spec.ts src/app/universe/asset-consumers-router.spec.ts src/app/components/address/address-context.spec.ts",
  "status": "NOT TESTED",
  "preparation_status": "ANNOTATIONS PREPARED FOR APPLICATION",
  "annotation_ids": [
    "ANN-FE-ADDR-COMPONENT",
    "ANN-FE-ADDR-REDUCER",
    "ANN-FE-ADDR-API",
    "ANN-FE-ADDR-EMBED"
  ],
  "functional_acceptance": "Every coverage ID must execute against the real owned application/API/authority on Signet or a documented supported Testnet; record scope, snapshot/checkpoint, authoritative readback, exact UI values, refresh/navigation recovery and the accepted source revision. Unit tests and visual fixtures are component evidence only.",
  "rollback": "Keep producer/consumer contract compatibility; preserve indexed state, source identity and unrelated functionality. Roll back only the failed matched artifacts. Do not hide required protocols or replace unavailable/unknown quantities with zero.",
  "identity_contract": "Follow WP-BE-CONTRACT: chain/network, protocol, native asset/deployment identity and stable namespace for incompatible ledgers. Mutable ruleset and source revisions remain evidence; ordinary upgrades cannot duplicate assets or reset balances.",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-INDEX",
    "WP-BE-ADDR",
    "WP-FE-REG"
  ],
  "coverageIds": [
    "C-FE-ADDR-ALL",
    "C-FE-ADDR-PAGES",
    "C-FE-ADDR-ZERO",
    "C-FE-ADDR-EXACT",
    "C-FE-ADDR-STATE"
  ],
  "repository": "bitcoinuniverseio/mempool",
  "report": "frontend-audit.json"
}
```

### WP-FE-BLOCK

```json
{
  "id": "WP-FE-BLOCK",
  "depends_on": [
    "WP-BE-CONTRACT",
    "WP-BE-BLOCK",
    "WP-FE-REG"
  ],
  "coverage_ids": [
    "C-FE-BLOCK-ALL",
    "C-FE-BLOCK-PAGES",
    "C-FE-BLOCK-REORG"
  ],
  "scope": "Reuse and reconcile saved block candidate, add block-hash-bound complete asset/action inventory with stable pagination and scoped aggregation.",
  "tests": "PROPOSED until saved candidate is integrated: from frontend/ npm test -- src/app/universe/block-assets src/app/universe/universe-api.service.spec.ts src/app/universe/asset-consumers.spec.ts",
  "status": "NOT TESTED",
  "preparation_status": "ANNOTATIONS PREPARED FOR APPLICATION",
  "annotation_ids": [
    "ANN-FE-BLOCK-COMPONENT",
    "ANN-FE-BLOCK-API",
    "ANN-FE-BLOCK-EMBED"
  ],
  "functional_acceptance": "Every coverage ID must execute against the real owned application/API/authority on Signet or a documented supported Testnet; record scope, snapshot/checkpoint, authoritative readback, exact UI values, refresh/navigation recovery and the accepted source revision. Unit tests and visual fixtures are component evidence only.",
  "rollback": "Keep producer/consumer contract compatibility; preserve indexed state, source identity and unrelated functionality. Roll back only the failed matched artifacts. Do not hide required protocols or replace unavailable/unknown quantities with zero.",
  "identity_contract": "Follow WP-BE-CONTRACT: chain/network, protocol, native asset/deployment identity and stable namespace for incompatible ledgers. Mutable ruleset and source revisions remain evidence; ordinary upgrades cannot duplicate assets or reset balances.",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-BLOCK",
    "WP-FE-REG"
  ],
  "coverageIds": [
    "C-FE-BLOCK-ALL",
    "C-FE-BLOCK-PAGES",
    "C-FE-BLOCK-REORG"
  ],
  "repository": "bitcoinuniverseio/mempool",
  "report": "frontend-audit.json"
}
```

### WP-FE-FLOW

```json
{
  "id": "WP-FE-FLOW",
  "depends_on": [
    "WP-BE-CONTRACT",
    "WP-BE-TX",
    "WP-FE-TX"
  ],
  "coverage_ids": [
    "C-FE-FLOW-IDENTITY",
    "C-FE-FLOW-EXACT",
    "C-FE-FLOW-LIFECYCLE",
    "C-FE-FLOW-RARITY"
  ],
  "scope": "Correct detailed flow identity, exact unit presentation, per-side truthfulness, status/network refresh and protocol-consistent visual fixtures.",
  "tests": "From frontend/: npm test -- src/app/universe/asset-flow/asset-flow.component.spec.ts src/app/universe/asset-consumers.spec.ts src/app/universe/asset-consumers-router.spec.ts; from repository root: node --test scripts/universe/visual-qa/fixture-contract.test.mjs",
  "status": "NOT TESTED",
  "preparation_status": "ANNOTATIONS PREPARED FOR APPLICATION",
  "annotation_ids": [
    "ANN-FE-FLOW-REFRESH",
    "ANN-FE-FLOW-IDENTITY",
    "ANN-FE-TX-EMBED",
    "ANN-FE-FIXTURE-SAT"
  ],
  "functional_acceptance": "Every coverage ID must execute against the real owned application/API/authority on Signet or a documented supported Testnet; record scope, snapshot/checkpoint, authoritative readback, exact UI values, refresh/navigation recovery and the accepted source revision. Unit tests and visual fixtures are component evidence only.",
  "rollback": "Keep producer/consumer contract compatibility; preserve indexed state, source identity and unrelated functionality. Roll back only the failed matched artifacts. Do not hide required protocols or replace unavailable/unknown quantities with zero.",
  "identity_contract": "Follow WP-BE-CONTRACT: chain/network, protocol, native asset/deployment identity and stable namespace for incompatible ledgers. Mutable ruleset and source revisions remain evidence; ordinary upgrades cannot duplicate assets or reset balances.",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-TX",
    "WP-FE-TX"
  ],
  "coverageIds": [
    "C-FE-FLOW-IDENTITY",
    "C-FE-FLOW-EXACT",
    "C-FE-FLOW-LIFECYCLE",
    "C-FE-FLOW-RARITY"
  ],
  "repository": "bitcoinuniverseio/mempool",
  "report": "frontend-audit.json"
}
```

### WP-FE-REG

```json
{
  "id": "WP-FE-REG",
  "depends_on": [
    "WP-BE-CONTRACT",
    "WP-BE-REG",
    "WP-BE-INDEX"
  ],
  "coverage_ids": [
    "C-FE-REG-HIERARCHY",
    "C-FE-REG-COVERAGE",
    "C-FE-REG-DISCOVERY"
  ],
  "scope": "Explicit protocol/subprotocol classification, discoverability, per-operation truthful readiness, preserving existing registry capabilities.",
  "tests": "From frontend/: npm test -- src/app/universe/universe-protocol-contract.spec.ts src/app/universe/protocol-directory/protocol-directory.component.spec.ts src/app/universe/protocol-detail/protocol-detail.component.spec.ts src/app/universe/protocol-availability.spec.ts",
  "status": "NOT TESTED",
  "preparation_status": "ANNOTATIONS PREPARED FOR APPLICATION",
  "annotation_ids": [
    "ANN-FE-REG-CONTRACT",
    "ANN-FE-REG-DIRECTORY"
  ],
  "functional_acceptance": "Every coverage ID must execute against the real owned application/API/authority on Signet or a documented supported Testnet; record scope, snapshot/checkpoint, authoritative readback, exact UI values, refresh/navigation recovery and the accepted source revision. Unit tests and visual fixtures are component evidence only.",
  "rollback": "Keep producer/consumer contract compatibility; preserve indexed state, source identity and unrelated functionality. Roll back only the failed matched artifacts. Do not hide required protocols or replace unavailable/unknown quantities with zero.",
  "identity_contract": "Follow WP-BE-CONTRACT: chain/network, protocol, native asset/deployment identity and stable namespace for incompatible ledgers. Mutable ruleset and source revisions remain evidence; ordinary upgrades cannot duplicate assets or reset balances.",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-REG",
    "WP-BE-INDEX"
  ],
  "coverageIds": [
    "C-FE-REG-HIERARCHY",
    "C-FE-REG-COVERAGE",
    "C-FE-REG-DISCOVERY"
  ],
  "repository": "bitcoinuniverseio/mempool",
  "report": "frontend-audit.json"
}
```

### WP-FE-TX

```json
{
  "id": "WP-FE-TX",
  "depends_on": [
    "WP-BE-CONTRACT",
    "WP-BE-TX",
    "WP-FE-REG"
  ],
  "coverage_ids": [
    "C-FE-TX-DISCRIMINATE",
    "C-FE-TX-EXACT",
    "C-FE-TX-STATE"
  ],
  "scope": "Every transaction asset is reachable under protocol/subprotocol, with exact input/output/effect quantities, complete scope decoding, no duplicate ownership counts.",
  "tests": "From frontend/: npm test -- src/app/universe/transaction-assets/transaction-assets.types.spec.ts src/app/universe/transaction-assets/transaction-assets.component.spec.ts src/app/universe/universe-api.service.spec.ts",
  "status": "NOT TESTED",
  "preparation_status": "ANNOTATIONS PREPARED FOR APPLICATION",
  "annotation_ids": [
    "ANN-FE-TX-CONTRACT",
    "ANN-FE-TX-VIEW",
    "ANN-FE-TX-API"
  ],
  "functional_acceptance": "Every coverage ID must execute against the real owned application/API/authority on Signet or a documented supported Testnet; record scope, snapshot/checkpoint, authoritative readback, exact UI values, refresh/navigation recovery and the accepted source revision. Unit tests and visual fixtures are component evidence only.",
  "rollback": "Keep producer/consumer contract compatibility; preserve indexed state, source identity and unrelated functionality. Roll back only the failed matched artifacts. Do not hide required protocols or replace unavailable/unknown quantities with zero.",
  "identity_contract": "Follow WP-BE-CONTRACT: chain/network, protocol, native asset/deployment identity and stable namespace for incompatible ledgers. Mutable ruleset and source revisions remain evidence; ordinary upgrades cannot duplicate assets or reset balances.",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-TX",
    "WP-FE-REG"
  ],
  "coverageIds": [
    "C-FE-TX-DISCRIMINATE",
    "C-FE-TX-EXACT",
    "C-FE-TX-STATE"
  ],
  "repository": "bitcoinuniverseio/mempool",
  "report": "frontend-audit.json"
}
```

### WP-OPS

```json
{
  "id": "WP-OPS",
  "dependsOn": [
    "WP-BE-CONTRACT",
    "WP-BE-REG"
  ],
  "status": "BLOCKED",
  "implementation": "Configure and qualify an isolated owned Signet read stack; retain current routing isolation.",
  "acceptance": "Real selected-network read path through public consumer; no cross-network rows; recovery and refresh.",
  "coverageIds": [],
  "repository": null,
  "report": "root-audit.json"
}
```

### WP-RELEASE

```json
{
  "id": "WP-RELEASE",
  "dependsOn": [
    "WP-VERIFY",
    "WP-OPS"
  ],
  "status": "NOT TESTED",
  "implementation": "Reconcile relevant candidates, qualify artifacts and configuration, integrate and publicly release with reversible socket/route handoff.",
  "acceptance": "Functional GO plus public Mainnet operational receipts; no mainnet functional tests required.",
  "coverageIds": [],
  "repository": null,
  "report": "root-audit.json"
}
```

### WP-VERIFY

```json
{
  "id": "WP-VERIFY",
  "dependsOn": [
    "WP-BE-ADDR",
    "WP-BE-BLOCK",
    "WP-BE-CONTRACT",
    "WP-BE-COVERAGE",
    "WP-BE-INDEX",
    "WP-BE-REG",
    "WP-BE-TX",
    "WP-DECODE",
    "WP-FE-ADDR",
    "WP-FE-BLOCK",
    "WP-FE-FLOW",
    "WP-FE-REG",
    "WP-FE-TX",
    "WP-OPS"
  ],
  "status": "NOT TESTED",
  "implementation": "Extend versioned operation roster and execute new and dependent flows without shrinking historical denominator.",
  "acceptance": "Every required operation independently PASS with exact source/spec/environment/evidence; no unresolved required defects.",
  "coverageIds": [],
  "repository": null,
  "report": "root-audit.json"
}
```
