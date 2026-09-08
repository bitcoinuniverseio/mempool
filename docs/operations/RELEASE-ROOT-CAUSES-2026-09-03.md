# Explorer release root-cause ledger, 2026-09-03

This ledger records the release blockers found while moving the Explorer from
its audited NO-GO state toward a production release. It separates source
correction from release proof. A source row is not a GO claim. CI, artifact,
deployment, and live-browser evidence must still name the final commit.

## Starting revision and work ownership

The remediation started in the isolated worktree
`mempool/.worktrees/explorer-go-standalone-20260903` on commit
`a74e911911ea96797821224ac7df05e6d0a2db49`. The original checkout and all
pre-existing uncommitted work were left untouched. The directly required
Portfolio API overlay work started in the isolated `backend-apis` worktree
`backend-apis/.worktrees/explorer-go-overlay-20260903` on commit
`0161fa9f298adfcf5e8bab353119950e1160aaec`.

## Ledger

### 1. Backend release compilation included test-only source

- **Observable failure:** the backend production TypeScript build failed at the
  vertical release head with missing Jest globals in eleven source files.
- **Reproduction:** `tsc -p backend/tsconfig.build.json` compiled files ending
  in `.spec.ts`, while that build excludes the repository's `.test.ts`
  convention.
- **User impact:** no trustworthy backend artifact could be produced for the
  release, regardless of frontend test results.
- **Root cause:** eleven new vertical suites used `.spec.ts`, so the production
  build treated tests as application source. Commit `5545c839e` renamed them,
  but no invariant prevented the same error from returning.
- **Affected routes and states:** every Explorer route, because the backend
  artifact could not compile.
- **Affected repositories and contracts:** `mempool`; no wire contract change.
- **Correction:** keep backend suites on `.test.ts` and run
  `backend/scripts/check-build-source.mjs` before every backend build.
- **Regression protection:** `check-build-source.test.mjs` proves clean trees
  pass and nested `.spec.ts` files fail with their path.
- **Disposition:** source corrected. Exact release CI and artifact proof remain
  part of the final release evidence.

### 2. Browser QA route lists could drift from Angular

- **Observable failure:** production routes existed without visual, adaptive,
  keyboard, or deep-link scenarios, while each browser script maintained a
  different hand-written list.
- **Reproduction:** compare Angular route declarations and navigation targets
  with the old arrays in the browser entry points. New product and Portfolio
  children were absent.
- **User impact:** an untested route could ship with overflow, a permanent
  loader, a missing fixture, or a cold-load failure while the selected subset
  stayed green.
- **Root cause:** route ownership and QA ownership were separate files with no
  parity invariant.
- **Affected routes and states:** all production-reachable Angular routes,
  including lazy children, aliases, redirects, parameter paths, and local
  Portfolio routes.
- **Affected repositories and contracts:** `mempool`; browser QA contract.
- **Correction:** one shared route registry now records every route class,
  deterministic valid and invalid identifiers, and an inclusion or written
  exclusion for every QA class. All browser entry points select from it.
- **Regression protection:** `route-scenarios.test.mjs` compares the registry
  with Angular declarations and static navigation, rejects stale routes,
  rejects missing parameter fixtures, and requires exact request fixtures.
- **Current measurement:** 243 route classes, 317 scenarios, 122 visual, 122
  adaptive, 49 keyboard, 164 live API, and 230 acceptance selections.
- **Disposition:** source corrected. The final built-browser matrix must still
  pass on the release commit.

### 3. Product verticals presented invented data as current state

- **Observable failure:** Ark, Data Studio, Fractal, Layer 2, Liquid, Network,
  Stratum V2, Taproot Assets, UTXO, Wildkin, and Zcash services returned fixed
  records when no first-party authority supplied them.
- **Reproduction:** call the vertical service methods without an authority.
  They previously returned named operators, assets, proofs, nodes, balances,
  and protocol events instead of failing.
- **User impact:** readers could mistake examples for indexed blockchain state
  or a protocol proof for a verified result.
- **Root cause:** prototype fixtures were left inside production providers, and
  UI success states did not distinguish data provenance.
- **Affected routes and states:** the eleven product families above, including
  list, detail, proof, empty, and provider-failure states.
- **Affected repositories and contracts:** `mempool`; the existing vertical API
  routes now use a structured unavailable envelope.
- **Correction:** production providers fail closed with HTTP 503 and code
  `first-party-data-unavailable`. Pages render explicit unavailable states and
  never replace failure with examples. Proof presence is described only as
  availability, not validation.
- **Regression protection:** service suites prove no fixture record is
  returned, proof endpoints fail closed, browser fixtures match exact paths,
  and unmatched requests fail the run.
- **Disposition:** source corrected. Live authority and failure-state checks
  remain part of deployment proof.

### 4. Local tools reported success without protocol verification

- **Observable failure:** Payment, RGB, Script, Lightning Offers, Liquid
  unblinding, and Zcash viewing-key surfaces could turn shape checks or timers
  into successful-looking results.
- **Reproduction:** submit a plausible-shaped value to each local form. The old
  result appeared after a timer or reported validity without performing the
  claimed protocol operation.
- **User impact:** a malformed or unverified payment, proof, offer, script, or
  private-data result could be trusted because the interface said it passed.
- **Root cause:** presentation prototypes conflated parsing with semantic
  validation and exposed actions whose implementation did not exist.
- **Affected routes and states:** payment URI and name resolution, RGB, Script,
  Lightning Offers, Liquid unblinding, and Zcash viewing-key routes.
- **Affected repositories and contracts:** `mempool`; no backend contract was
  invented to hide the gap.
- **Correction:** local parsers state their narrow result and all unsupported
  verification paths fail closed. Liquid and Zcash pages accept no sensitive
  key material while their local cryptographic implementation is unavailable.
- **Regression protection:** `truthful-workspaces.spec.ts` proves that shaped
  input never becomes verification success and that unsupported private-key
  pages expose no input, action, or stored secret state.
- **Disposition:** source corrected. Browser checks still verify the final
  rendered wording and absence of impossible actions.

### 5. Shared product layout allowed narrow-screen loss of content

- **Observable failure:** product tabs, dense tables, controls, and long
  identifiers could widen or clip the document at phone widths. Some controls
  were below the mobile input and touch floors.
- **Reproduction:** open product routes at 320 CSS pixels with maximum-length
  identifiers and inspect document width, ancestor clipping, painted target
  boxes, and computed input font size.
- **User impact:** required columns, identifiers, copy controls, and navigation
  became unreadable or unreachable on phones and at high zoom.
- **Root cause:** shared flex and grid children retained intrinsic minimums,
  wide tables lacked declared local scroll regions, identifiers used ad hoc
  slicing, and common controls did not enforce the mobile floors.
- **Affected routes and states:** every route using `product-page.scss`, plus
  representative Portfolio saved-account pages and shared navigation.
- **Affected repositories and contracts:** `mempool`; visual and interaction
  contract.
- **Correction:** shared shells permit reflow, dense tables use named local
  scrollers, controls use the tested mobile floors, tabs remain reachable, and
  one identifier component preserves the full accessible value and copy action.
- **Regression protection:** adaptive QA measures document overflow, clipped
  ancestors, offscreen focus targets, scroll affordances, 16px editable text,
  44px repeated controls, fixed-layer overlap, safe areas, and long values.
- **Disposition:** source corrected. The final multi-engine viewport matrix is
  required before release.

### 6. Portfolio could mix partial data with complete-looking results

- **Observable failure:** multi-account aggregation, charts, reports, shares,
  and route guards could show a complete-looking value or the wrong local
  portfolio state when one account failed, values were hidden, or a saved id
  was unknown.
- **Reproduction:** fail one account response, hide values, cold-load a saved
  child route, request an unknown local id, and compare report rows with the
  address that supplied them.
- **User impact:** a partial balance could look complete, hidden values could
  remain in chart objects, and a report could imply portfolio-wide coverage
  when it represented one address.
- **Root cause:** components inferred readiness independently, reused display
  objects across privacy states, and lacked a deterministic encrypted-vault
  browser lifecycle for saved routes.
- **Affected routes and states:** Portfolio home, overview, holdings, activity,
  performance, Time Machine, UTXOs, insights, sources, reports, settings,
  share, lock, cold load, and unknown-id recovery.
- **Affected repositories and contracts:** `mempool` and `backend-apis`
  Portfolio API v2.
- **Correction:** aggregation fails closed, partial provenance stays visible,
  hidden charts receive no values, reports name their source address, sharing
  is explicitly unavailable, and QA creates and unlocks a real encrypted local
  vault for saved-route coverage.
- **Regression protection:** Portfolio truthfulness, failure, lifecycle, vault,
  adaptive, and browser-registry suites cover these transitions.
- **Disposition:** source corrected. Final browser and contract runs remain
  required.

### 7. Vault replacement and passphrase rotation were not atomic

- **Observable failure:** an IndexedDB error during backup import or passphrase
  rotation could leave only part of the encrypted vault replaced.
- **Reproduction:** inject an abort or request failure between record writes.
  The old implementation mutated storage and in-memory key state in separate
  phases.
- **User impact:** a local encrypted portfolio could become unreadable or hold
  records encrypted under different keys.
- **Root cause:** multi-record replacement was implemented as independent
  writes instead of one transaction, and key state changed before durable
  commit.
- **Affected routes and states:** Portfolio settings import, passphrase change,
  unlock, and recovery.
- **Affected repositories and contracts:** `mempool`; local vault schema only.
- **Correction:** metadata and record replacement commit in one IndexedDB
  read-write transaction. In-memory state changes only after commit, and
  plaintext buffers are cleared in every exit path.
- **Regression protection:** `vault.service.spec.ts` injects transaction aborts
  and synchronous and asynchronous request failures for import and rotation.
- **Disposition:** source corrected. Browser lifecycle coverage remains part of
  the release gate.

### 8. Portfolio v2 was mounted at a non-public path

- **Observable failure:** the overlay returned 404 from
  `/api/v2/universe/portfolio/networks` while the unintended path
  `/v2/universe/portfolio/networks` returned 200.
- **Reproduction:** start the compiled `backend-apis` overlay and request both
  paths.
- **User impact:** the released Portfolio frontend could not load its required
  network contract through the Explorer gateway.
- **Root cause:** the controller relied on a Nest 11 global-prefix exclusion
  shape that did not produce the public path expected by the frontend.
- **Affected routes and states:** every Portfolio v2 endpoint and every saved
  or ephemeral Portfolio data load.
- **Affected repositories and contracts:** `backend-apis` and `mempool`;
  Portfolio contract version 2.
- **Correction:** the v2 controller declares its public API prefix explicitly,
  and shared overlay configuration excludes only that family from the v1
  prefix.
- **Regression protection:** compiled runtime and integration tests require
  public v2 200, v1 200, the expected schema and contract version, and the old
  direct path 404.
- **Disposition:** source corrected. The paired artifact and live gateway must
  report the exact overlay commit before release.

### 9. Release artifacts and overlay cutover did not prove byte or traffic identity

- **Observable failure:** abbreviated release directories, host-side dependency
  rebuilding, incomplete fallback checks, and a stop-then-start overlay
  promotion allowed mixed or unavailable production states.
- **Reproduction:** inspect the prior artifact and release scripts. They could
  reuse or rebuild host dependencies, did not bind every artifact to a full
  commit, and restarted the only overlay listener after stopping its candidate.
- **User impact:** tested source did not necessarily identify the installed
  dependency bytes, rollback could select an incomplete tree, and requests or
  sockets could fail during promotion.
- **Root cause:** artifact construction, install validation, and traffic
  switching were separate best-effort procedures rather than one checked
  release protocol.
- **Affected routes and states:** the whole public origin during install,
  cutover, verification, and rollback.
- **Affected repositories and contracts:** `mempool` and `backend-apis` release
  workflows, gateway, service units, scripts, and operations documentation.
- **Correction:** artifacts use full 40-character commits, carry exact pruned
  production dependencies, verify checksums before private extraction, and
  validate release markers and fallback trees. Overlay preflight is passive and
  read-only. The gateway reads an atomically replaced loopback route file so a
  proven candidate can receive new traffic while existing connections drain.
- **Regression protection:** shell unit tests exercise checksum refusal,
  incomplete trees, rollback failure, route-file validation, candidate mode,
  and every failure point around the live-link move.
- **Disposition:** implementation is under final review. No production cutover
  occurs until its exact tests and a paired rollback rehearsal pass.

### 10. Backend information imports started unmanaged background work

- **Observable failure:** the backend Jest run finished its assertions but
  reported recurring timers and real HTTP client requests still open.
- **Reproduction:** run all backend suites with `--detectOpenHandles`. Imports
  of `backend-info.ts` scheduled two refresh loops and immediately opened
  Bitcoin RPC requests in test processes.
- **User impact:** shutdown and test completion depended on external request
  timing, masking lifecycle faults and adding release instability.
- **Root cause:** a module-level singleton performed production scheduling as an
  import side effect, and its interval handles remained referenced.
- **Affected routes and states:** backend startup, shutdown, diagnostics, and
  every test importing the dependency graph.
- **Affected repositories and contracts:** `mempool`; backend diagnostics only.
- **Correction:** production timers detach from the event loop, while the test
  singleton starts no timers or RPC requests. Explicit construction still
  tests the production scheduling path.
- **Regression protection:** `backend-info.test.ts` checks both interval
  detachment and zero singleton background work in test mode.
- **Disposition:** focused handle detection now reports only the native Rust
  addon's non-blocking cleanup resource. A final normal full suite is still
  required on the release tree.

### 11. Atomic blockchain amounts were coerced through floating point

- **Observable failure:** several vertical templates used `Number(value)` and
  division or multiplication by 100,000,000 for string amounts.
- **Reproduction:** render `9007199254740993` atomic units or the equivalent BTC
  decimal. JavaScript numeric coercion changes the integer above its safe range.
- **User impact:** large balances and supplies could display a different amount
  from the authoritative string.
- **Root cause:** presentation code treated arbitrary-size atomic integers as
  floating-point display values.
- **Affected routes and states:** Ark, Liquid, Layer 2, Zcash privacy, UTXO, and
  Payment Studio amount displays.
- **Affected repositories and contracts:** `mempool`; no wire contract change.
- **Correction:** exact string formatters insert decimal and grouping separators
  without numeric coercion. Malformed values fail closed to `Unavailable`.
- **Regression protection:** `exact-product-amounts.spec.ts` covers values above
  the safe integer limit, malformed values, BTC-to-satoshi conversion, and
  template scans for numeric coercion.
- **Disposition:** source corrected and focused production build verified.

### 12. Address history multiplied cold Bitcoin RPC work

- **Observable failure:** the scheduled production smoke timed out while reading
  `/api/address/1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3/txs` even though address
  summary and unspent-output reads remained healthy.
- **Reproduction:** five concurrent public reads returned no bytes within 30
  seconds. A direct backend read took 28.347 seconds and returned 45,795 bytes;
  the warm repeat took 3.618 seconds. The same backend returned the address
  summary in 0.004 seconds and unspent outputs in 0.031 seconds. During the
  stalled enrichment the process held 18 separate Core RPC sockets and had not
  restarted.
- **User impact:** an otherwise valid address page could remain loading and the
  gateway could reach its 30-second upstream limit under concurrent traffic.
- **Root cause:** the JSON-RPC client set `agent: false`, opening a fresh socket
  for every transaction and prevout. Overlapping reads of the same transaction
  were not coalesced, confirmed results were not retained briefly, and prevouts
  were enriched serially inside each transaction.
- **Affected routes and states:** Bitcoin address history, transaction detail,
  and any backend path that enriches Core transactions with prevouts.
- **Affected repositories and contracts:** `mempool`; no public response schema
  changes.
- **Correction:** Core reads now use one bounded persistent HTTP pool, an
  application-level limit that reserves at least one priority socket,
  overlapping request coalescing, bounded admission, a five-second queue-wait
  deadline, and a 20-second active raw-read deadline. The aggregate primary
  budget is eight sockets across cluster workers. An active secondary client on
  the same node takes one socket from that budget. Unsafe process or socket
  settings fail during startup. Confirmed entries use a 512-entry, 30-second
  cache tied to the local tip height and hash, and both confirmed and mempool
  prevouts load concurrently behind the same bound.
- **Regression protection:** focused tests prove eight burst reads reuse at
  most two configured test sockets, duplicate transaction reads issue one RPC,
  cached callers receive independent objects, same-height tip replacement
  invalidates cached results, negative confirmations remain unconfirmed,
  admission and wait time are bounded, partial responses release their slot,
  UTF-8 bodies remain correctly framed on a reused connection, and prevout work
  never exceeds the configured concurrency.
- **Disposition:** source compilation and 20 focused assertions pass. Candidate
  and public measurements remain required before GO.

### 13. Chain smoke selected a hidden supporting heading before the page name

- **Observable failure:** the live Dogecoin and Zcash route smoke found `Block
  timeline` as the first heading instead of the named chain dashboard.
- **Reproduction:** inspect the production document order at release
  `1fe24431bed9847cdc3bceefeb340a323477c496`; the visually hidden timeline
  heading precedes the visible page heading.
- **User impact:** assistive navigation and the release smoke encounter a
  supporting section before the page identity, and the smoke cannot prove it
  reached the requested chain.
- **Root cause:** a prior layout move put the timeline section first in source
  order without preserving the page heading as the first heading.
- **Affected routes and states:** Dogecoin and Zcash dashboard roots in ready,
  degraded, and unavailable states.
- **Affected repositories and contracts:** `mempool`; document structure only.
- **Correction:** the visible chain `h1` is placed before the status rail,
  timeline, and degraded explanation while blocks remain the first dashboard
  data panel.
- **Regression protection:** the component test and live chain smoke require
  the requested chain name to precede supporting headings.
- **Disposition:** the correction exists on the remote
  `fix/dogecoin-blocks-first-20260903` line and must be merged during final
  branch reconciliation, then proven in production.

## Release proof still required

Before GO, the final commit must pass clean installs, all build and test layers,
the complete Chromium, WebKit, Firefox, adaptive, keyboard, accessibility, and
live-origin matrices, immutable artifact checks, paired deployment, exact SHA
checks, rollback checks, and external cold-load smoke tests. Real iOS Safari and
real Android Chrome evidence must come from a connected physical device or a
credible device farm; desktop emulation is not recorded as that evidence.
