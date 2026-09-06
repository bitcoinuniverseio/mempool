# Protected operations and portfolio acceptance

Status: **FUNCTIONAL NO-GO**. This bounded Q05/Q07 check distinguishes local cryptographic/handler evidence from live private-adapter and portfolio journeys. No private network operation, database mutation, node request, listener, browser, runner or deployment was started by this worker. The integration owner records final revisions and browser evidence.

## Q07: registered private admin adapter

`backend/src/index.ts` registers `adminAdapterRoutes.initRoutes`. Every route below is beneath `/internal/admin/v1` and the same private-address/HMAC guard. The public gateway has no proxy mapping for this prefix. There is no public admin route in this module.

Two source defects were reproduced and repaired:

- The general JSON parser consumed signed POST bytes before the adapter parser's `verify` hook ran. Early, prefix-scoped `adminAdapterJsonParser()` now captures exact bytes and enforces 256 KiB before general parsers. The helper also supports standalone adapter registration.
- An unsigned `x-bu-admin-elevated: 1` header could satisfy the execution gate. The gate now uses guard metadata derived only from `adminAuthorization.elevated: true` in the authenticated JSON body. The canonical HMAC contract is unchanged. Elevated callers must include that body field alongside `input` before signing. The trusted Control Center still owns user permissions, typed confirmation and reauthentication; a service signature alone does not prove those user actions occurred.

| ID | Method and path suffix | Required assertions and remaining prerequisite |
| --- | --- | --- |
| Q07-A01 | GET `/manifest` | Actual service/network/revision and declared capabilities. Needs accessible private adapter and actual service dependencies. |
| Q07-A02 | GET `/snapshot` | Real node/database/cache/process observations and explicit unavailable fields. Needs real private process and controlled dependencies. |
| Q07-A03 | GET `/resources?kind=...&q=...&limit=...` | Independently check each advertised kind: service, dependency, indexer, node, database, run, release; filter, bound, truncation and invalid kind. |
| Q07-A04 | GET `/resources/:kind/:id` | Correct matching resource and 404; same seven kinds. No live detail read passed. |
| Q07-A05 | GET `/search?q=...&limit=...` | Search across service/dependency/indexer/run/release, bounded result and unavailable source. |
| Q07-A06 | GET `/operations` | Correct catalog, current availability, risk and postconditions. Catalog unit checks passed; live capability verification remains open. |
| Q07-A07 | POST `/operations/:operationId/preview` | Every catalog operation separately, input validation and honest preconditions. Parser/signature handling passes locally; no real dependency preview executed. |
| Q07-A08 | POST `/operations/:operationId/execute` | Signed authorization, operation availability, idempotency/locks, actual postcondition and persisted run. Needs controlled audit database and separately authorized safe operation. No real operation executed. |
| Q07-A09 | GET `/runs/:runId` | Persistent readback, unknown run, restart and current terminal stage. Needs disposable database and actual controlled run. |
| Q07-A10 | POST `/runs/:runId/cancel` | Cancellable versus non-cancellable/terminal/unknown run, durable readback. Needs controlled run; no cancellation performed. |
| Q07-A11 | GET `/audit?limit=...&offset=...` | Correct operation, outcome, correlation and pagination after restart. Needs controlled audited operations. |
| Q07-A12 | GET `/events` | Authenticated SSE; actual `explorer.tick` every 10 seconds, stream reconnect and close cleanup. Source has no replay cursor/Last-Event-ID implementation. No live SSE connection passed. |

Each A07/A08 variant remains a separate operation check:

| Operation | Risk | Current accepted scope |
| --- | --- | --- |
| `explorer.capabilities.refresh` | SAFE | Catalog/guard only; real refresh unresolved. |
| `explorer.dependencies.recheck` | SAFE | Catalog/guard only; real dependencies unresolved. |
| `explorer.address-index.probe` | SAFE | Catalog/guard only; real address/UTXO read unresolved. |
| `explorer.release.verify` | SAFE | Catalog/guard only; actual service revision pairing unresolved. |
| `explorer.smoke.run` | SAFE | Catalog/guard only; real subsystem readback unresolved. |
| `explorer.runs.reconcile` | SAFE | Catalog/guard only; controlled expired-run recovery unresolved. |
| `explorer.pools.refresh` | GUARDED | Catalog/guard only; actual metadata mutation not performed. |
| `explorer.prices.refresh` | GUARDED | Catalog/guard only; actual update not performed. |
| `explorer.indexer.task.run` with `blocksPrices` | GUARDED | Allowlist tested; actual indexing task not performed. |
| `explorer.indexer.task.run` with `coinStatsIndex` | GUARDED | Allowlist tested; actual indexing task not performed. |
| `explorer.indexer.reindex` | HIGH_RISK | Signed-elevation gate repaired; no reindex authorized or performed. |
| `explorer.service.restart` | HIGH_RISK | Disabled unless deployment control is explicitly configured; no restart authorized/performed. |
| `explorer.release.rollback` | IRREVERSIBLE | Disabled unless deployment control is explicitly configured; no rollback authorized/performed. |

Evidence Q07-LOCAL-01: existing `backend/src/__tests__/admin-adapter.test.ts` ran with `node node_modules/jest/bin/jest.js src/__tests__/admin-adapter.test.ts --runInBand --coverage=false`: 32 passed, including seven new parser/guard/elevation regressions. A subsequently added body-limit regression passed independently (`-t 'admin body limit'`); the file now contains 33 tests. The tests run actual Express middleware functions over in-process streams and never listen or invoke a privileged operation. They cover private/public address classification, missing keys, supported contract versions, exact body/query/signature binding, timestamp freshness, nonce replay, uniform rejection, catalog risk/input/task limits, startup parser order, exact whitespace, signed elevation and tampering. They do not establish real Control Center login/session/CSRF/reauthentication, live gateway isolation or durable run/SSE behavior. Scoped index/admin ESLint passed with zero errors.

### Q07 caller compatibility

The actual caller is Inscribe's `backend/src/control-center/operations.service.ts`.
Its original dispatcher sent elevation only through `x-bu-admin-elevated`, which
the repaired Explorer guard ignores. Local Inscribe commit
`ede24741e5e0c15f01507d57278f0f76d5df9053` on
`codex/explorer-admin-signed-elevation-20260905`, in
`D:\universe\inscribe\.tmp\explorer-admin-signed-elevation`, adds
`adminAuthorization: { elevated: true }` beside `input` for Explorer `HIGH_RISK`
and `IRREVERSIBLE` execution after permission and elevation checks. The existing
adapter client signs those exact JSON bytes with the unchanged method/path/query/
body-digest contract. Lower-risk Explorer calls do not assert elevation; an
assertion nested in user input cannot become the outer authorization field.
Core retains its existing header contract. The local commit also updates the
Inscribe operator and developer documentation.

Evidence Q07-CALLER-LOCAL-01: Node `24.19.0`, three targeted Jest suites, **14/14
passed**, including seven new sender checks. The tests exercise the actual
operations dispatcher and adapter signer with a captured, refused fetch; they
verify the exact outbound body digest and HMAC, both elevated risk levels,
lower-risk input isolation, Core compatibility, and no run write or execution
dispatch after denied permission or elevation. Command from the isolated
`backend` directory:

```powershell
node node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand src/control-center/operations.service.spec.ts src/control-center/control-center.controller.spec.ts src/control-center/control-center.config.spec.ts
node node_modules/eslint/bin/eslint.js src/control-center/operations.service.ts src/control-center/operations.service.spec.ts
git diff --check
```

Scoped ESLint and whitespace checks passed; the isolated worktree is clean after
commit. The active Inscribe checkout was preserved. The sender commit has not
been merged, pushed or deployed. Pair it with the repaired Explorer revision
before a future authorized release. These tests establish sender compatibility,
not an actual private-network request, user reauthentication, persisted adapter
run or privileged operation. Those Q07 acceptance prerequisites remain open.

## Q05: portfolio boundaries and required operations

The actual `PortfolioV2ApiService` calls the overlay at `/api/v2/universe/portfolio`. `UniversePortfolioModule` registers its controller and is imported by `AppModule`; the gateway forwards the v2 prefix. These are intentionally public address-derived GET operations. They need no user-account/session/owner guard to read already-public addresses. Share revocation has the distinct owner-capability contract below. Local names, account definitions and preferences instead live in the encrypted browser vault. No spending-wallet connection or private-key upload is offered by this path.

| ID | Actual offered operation | Existing local evidence / remaining acceptance |
| --- | --- | --- |
| Q05-P01 | Create from one public address | Onboarding/store source; actual encrypted save, refresh and two-vault isolation remain required. |
| Q05-P02 | Connect Bitcoin xpub/ypub/zpub | Existing derivation and secret-detection tests; actual public-address discovery/data readback remains required. |
| Q05-P03 | Connect public descriptor | Existing descriptor checksum/derivation tests; actual local account save and first-party reads remain required. |
| Q05-P04 | Import address list, CSV | Existing `workspace-import.spec.ts`; real form/import persistence remains required. |
| Q05-P05 | Import address list, JSON | Existing importer tests; actual form/import persistence remains required. |
| Q05-P06 | Create manual-only portfolio | Local store path; truthful separation from authoritative holdings and reload remain required. |
| Q05-P07 | Open public address without saving | Ephemeral component/public data route; no record persistence and actual source readback remain required. |
| Q05-P08 | Rename local portfolio | Encrypted store mutation; two-vault isolation and reload remain required. |
| Q05-P09 | Duplicate portfolio settings | Source explicitly duplicates settings, not accounts; actual save/readback remains required. |
| Q05-P10 | Archive | Local mutation; reload and active-portfolio handling remain required. |
| Q05-P11 | Restore archive | Local mutation; reload and active-portfolio handling remain required. |
| Q05-P12 | Delete local portfolio | Local two-step action; controlled disposable data only, durable deletion/isolation remain required. |
| Q05-P13 | Create/unlock/lock encrypted vault | Actual browser crypto/storage; wrong passphrase and second isolated identity must not reveal first vault's names/accounts. No backend login is implied. |
| Q05-P14 | Change vault passphrase | Existing vault method; old/new passphrase and reload proof remain required. |
| Q05-P15 | Export encrypted backup | Existing vault/settings action; actual exported artifact and independent import proof remain required. |
| Q05-P16 | Validate/import encrypted backup | Existing vault/settings action; failed validation must preserve prior data, accepted import must survive refresh. |
| Q05-P17 | GET `/networks` | v2 service/contract tests cover roster and capabilities; actual configured authority support remains required. |
| Q05-P18 | GET `/:chain/:network/:address/summary` | Existing service tests cover aggregate states and unknown networks; real scoped data required. |
| Q05-P19 | GET `.../holdings?cursor=&limit=` | Existing service tests cover exact holdings, custody rows and pagination; real data/network isolation required. |
| Q05-P20 | GET `.../activity?cursor=` | Existing service tests cover unavailable/unsupported; actual events and cursor readback required. |
| Q05-P21 | GET `.../performance` | Existing FIFO/valuation engines; actual authority/history/price completeness and UI output required. |
| Q05-P22 | GET `.../snapshot?timestamp=...` or `?height=...` | Existing snapshot guards/engine tests; each historical-point variant needs actual supported data. |
| Q05-P23 | GET `.../delta?fromTimestamp=&fromHeight=&toTimestamp=&toHeight=` | Existing delta engine; actual valid point pairs/partial coverage required. |
| Q05-P24 | GET `.../utxos?cursor=&limit=` | Existing tests cover evidence, unsupported chain and source failure; actual output status required. |
| Q05-P25 | GET `.../counterparties?cursor=&limit=` | Existing deterministic folding tests; actual raw-address aggregation required. |
| Q05-P26 | GET `.../coverage` | Existing coverage source/contract tests; actual sources must remain distinguishable from unavailable data. |
| Q05-P27 | Insights | Existing local insight helpers; UI facts from actual loaded evidence required. |
| Q05-P28 | Report preview and print/PDF | Existing report builder consumes loaded state locally; actual redaction/print artifact proof required. |
| Q05-P29 | Local report CSV download | Existing report action; actual exported rows/redaction proof required. |
| Q05-P30 | GET `.../export?format=assets-csv` | Existing export serialization tests; actual downloaded authoritative holdings required. |
| Q05-P31 | GET `.../export?format=activity-csv` | Existing serialization tests; actual downloaded activity and pagination limits required. |
| Q05-P32 | GET `.../export?format=utxos-csv` | Existing serialization tests; actual downloaded UTXOs required. |
| Q05-P33 | GET `.../export?format=evidence-json` | Existing serialization tests; actual checkpoint/source-bearing artifact required. |
| Q05-P34 | Open `/portfolio/share/:shareId#key=...` | Missing GET handler repaired. Local viewer checks cover AES-GCM decryption, malformed plaintext, fragment privacy, revoked/upstream error states and stale responses. The backend now returns bounded encrypted envelopes with expiry/revocation checks. PASS LOCAL HANDLER; actual MySQL and owner/recipient browser readback remain BLOCKED. |
| Q05-P35 | Create encrypted share | Missing report owner flow and POST handler repaired. Real WebCrypto encrypts a limited snapshot; the owner vault saves the pending request before upload and reuses it after an uncertain response. An additive migration supplies ciphertext/nonce/expiry storage. PASS LOCAL HANDLER; actual migration, constraints, restart and browser creation remain BLOCKED. |
| Q05-P36 | Revoke encrypted share | Missing owner action and DELETE handler repaired. The browser keeps the opaque owner capability in its encrypted vault; the server stores its hash and checks it for revocation. Local capability/retry tests pass with a persistence double. Actual wrong-owner rejection and durable revocation through MySQL/browser remain BLOCKED. |

The 2026-09-06 [portfolio sharing implementation and evidence](portfolio-sharing-2026-09-05.md) explicitly supersedes the original missing-implementation findings for P34-P36. It records 41 passing focused frontend tests, 14 backend HTTP handler tests, one module boot test, application/backend TypeScript passes and validated additive migration assets. The encrypted report flow and backend GET/POST/DELETE handlers now exist. The migration has not run, and sharing defaults disabled until `UNIVERSE_PORTFOLIO_SHARE_ENABLED=true` and working storage are configured. No approved local MySQL credential loader was found; actual database and browser lifecycle acceptance remain blocked.

The existing backend v2 tests cover public data composition, typed source failures, per-network capability declarations, cursors, exact arithmetic, history/delta and export contracts. New share handler tests cover capability rejection and encrypted-envelope lifecycle using controlled persistence, while frontend tests cover route/vault identity and stale response disposal. These are local regression checks; they do not prove two real vault identities across browser reload or database restart. Backend startup/network reads still need the configured overlay database and matching owned source authorities.

Required two-identity proof remains: independent controlled vaults A/B, B cannot open or mutate A's local definitions by ID, wrong vault passphrase is rejected, reload preserves A's selected account network, share recipient without the owner capability cannot revoke, owner revocation persists and subsequent GET refuses access, and fragment keys/private account material never enter HTTP bodies or telemetry. These checks must follow the actual implemented sharing contract; public address reads must not be mislabeled unauthorized simply because another viewer can read them.
