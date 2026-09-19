# Asset summary UI preparation, 2026-09-19

Scope: a major, consistent redesign of transaction summaries and address holdings. This is preparation, not an implemented redesign or a release. Do not add wallets, signing, trading, indexers or unrelated protocol products.

## Exact source baseline
Mempool source: `d0b49e8d136476658685a6cc9ec1528679db4af7`. This commit contains the eight UI source-comment blocks originally appended in the isolated local feature worktree. That worktree was subsequently removed by concurrent work. Resume this preparation branch, not the removed path.
Backend preparation branch: `bitcoinuniverseio/backend-apis`, `prep/asset-summary-ui-20260919`, commit `91d0c6984db34b659d1663270e90c661432fa3bb`, based on `44b615adfa07118919d3130fe10add35a85e38eb`.
Server text handoff target: `D:\universe\mempool\audits\implementation-prep-20260919-ui\mempool_UI_HANDOFF_2026-09-19`. Verify its actual files; a server ZIP has NOT been created. Remote process execution was blocked, and text-file writing cannot reliably transfer an archive.

## Annotation index and order
UI-WP07: backend `contracts/transaction-asset-summary.ts`, contract parity and fixtures.
UI-WP08: backend `transactions/transaction-asset-summary.service.ts`, CACHE/COVERAGE/DIVISIBILITY/MEDIA/CHECKPOINT markers. Reuse `TransactionFlowService.enricherRegistry()`; coordinate its existing flow cache.
UI-WP01: `transaction-assets/transaction-assets.types.ts`, decoder and exact quantities.
UI-WP02: `transaction-assets/transaction-assets.component.ts`, stable view model, metadata-independent loading and truthful states.
UI-WP03: `transaction-assets/transaction-assets.component.html` and `.scss`, hierarchy, accessible details, bounded numeric columns and container-driven mobile cards.
UI-WP04: `address-assets/address-assets.component.ts`, exact units, full identity, coverage denominator and retry.
UI-WP05: `address-assets/address-assets.component.html` and `.scss`, shared holdings layout and accessible outpoint details.
UI-WP06: `transaction-assets/transaction-assets.component.spec.ts`, regression and real read-only acceptance.
Order: WP07 + WP08, then WP01, WP02, WP03, WP04, WP05, WP06. Do not treat deleting a marker as completion.

## Baseline drift corrections
The original WP01/WP02 prose describes the earlier local source. At d0b49e8, `logo()` already requires `verified === true`, and the effects template already says `(not accepted)`. Preserve both concurrent corrections and verify them; they are NOT unimplemented defects now. Their application tests were not run in this preparation. Counts/coverage validation, missing effect evidence and the redesign remain required.

## Design and verification rules
Use the existing Universe tokens, a single coverage badge, aligned Inputs/Outputs or Held/Positions, explicit approximation only for compact headlines, full exact-value copy in row details, labelled protocol fallbacks, and a <=720px container breakpoint. Do not wrap primary amounts, guess decimals, sum unlike assets, convert atomic strings to floating point, hide gaps, or require hover to read full data. All controls must work with keyboard and touch.
The supplied standalone HTML design has 120 passing viewport/theme/state checks. It is fixture-only evidence, NOT Angular, API, Signet or production acceptance. The backend service's annotation emits identical comment-free JavaScript; repository builds remain untested. Read the complete bundled execution prompt and coverage matrix.
The pinned registry defaults Bitcoin protocols to mainnet-only. A missing Signet advertisement does not prove a protocol cannot support Signet. Resolve actual test-source capabilities without changing production defaults; use a justified supported Testnet only when needed. Do not invent test transactions for this read-only feature.
Full functional acceptance on real supported test-network paths, dependent-flow regression, and completed public Mainnet deployment are the final GO gate. No merge or deployment was performed by this preparation agent.
