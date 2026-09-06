# Supplied-proof verifier evidence

This archive accepts two actual candidate verifier APIs and their two provided-proof consumers within narrow local scopes. It does not establish whole-application readiness or a reconciled operation denominator. All four original operation IDs remain in the current overlay.

- OTS: `API-8f2d0a9754f2` and `UI-1afe77615c32`. The supplied public detached proof and expected digest are checked through actual owned Mainnet header reads. Calendar stamping/upgrading, additional networks and unmeasured runtime outage/reorganization scopes remain separate.
- MuSig2: `API-4edb832dd83d` and `UI-a270e89bb4c9`. Ordered public untweaked BIP327 data is aggregated and verified through each partial and final signature. Signing, participant authentication, durable sessions and vendor trust remain outside this scope.

`review.json` is the manifest: it hashes 109 exact archived inputs, observations, scripts, screenshots and logs, with a separate hash for `validation.json`. Public input provenance is in `public-inputs/`. The captured Bitcoin header fixture supports unit tests only; actual runtime verification used the owned reader described in the allowlisted `owned-reader-binding.json`. No full runtime configuration or credential material is archived.

The phases are preserved separately:

| Phase | Actual source binding | Result |
| --- | --- | --- |
| Direct/gateway HTTP | Monolith `0a8e15750` | 13 actual assertions in each run, including explicit positive and negative verdicts |
| Initial consumer | Frontend and monolith `0a8e15750` | Eight DOM/response assertions passed; initial screenshots show theme defects and are not visual passes |
| Intermediate theme | Frontend `a974f79f3`, monolith `0a8e15750` | Three passes / five failures, preserved under `theme-before/` |
| Final provided-proof theme | Frontend `4e9c2749b`, monolith `0a8e15750` | Eight positive result/contrast/geometry checks passed, light/dark at 390/1440; four representative screenshots manually reviewed by the root agent |

The API scripts do not intercept responses. The archived scripts retain their original machine paths and installed Chrome dependency; they are evidence of the recorded runs, not portable launchers. `theme-final/contrast-probe.mjs` contains the exact probe source from frontend revision 4e9. A later merge/build requires its own binding and measurements; it cannot inherit a new runtime pass from this archive.

Full engine validation: 79 backend suites / 809 passing tests / four explicit live Esplora skips, 100 frontend files / 1,577 passing tests, both builds passed. Full lint returned zero errors (1,428 backend / 2,611 frontend warnings). Gateway regressions passed 29 and diagnostic probe checks passed 21. Subset counts overlap the full suite and must not be added to it. See `validation.json` for exact checkpoint boundaries.

Integration follow-up: frontend `bbca7f46873d35c5f6146cbb33b3e4cab09f926f` passed its production build, 100 frontend files/1,577 tests and eight independent positive provided-proof theme/width checks with the same actual monolith `0a8e15750`. Exact reports/screenshots/scripts and merge review are in `integration-followup/`; Git ancestry verifies inclusion of incoming PR101 revision `ff2a108247a47a214db471850078ef8fcd98bf88`. All previous 88 artifact hashes and historical assertions are unchanged. The four scoped local passes remain four; full mobile and application readiness remain unestablished.
