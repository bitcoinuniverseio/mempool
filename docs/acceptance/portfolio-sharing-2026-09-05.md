# Portfolio sharing and local identity acceptance

Local implementation checks completed on 2026-09-06 UTC using Node 24.19.0 and npm 11.17.0. This record covers Q05 sharing, report calculations, and the concrete portfolio route identity defects found while connecting sharing. It does not certify every portfolio operation.

## Behavior

- The report creates an AES-GCM encrypted snapshot containing only asset names, percentage strings, and the snapshot timestamp. Addresses, absolute values, portfolio IDs, and accounts are excluded from the uploaded plaintext projection.
- The browser generates independent 256-bit share IDs, owner capabilities, and decryption keys. The decryption key appears only in the recipient URL fragment. The owner capability is sent when creating or revoking the share. Both secrets are saved through the existing encrypted vault.
- The browser saves the pending encrypted request before uploading it. A lost or invalid response leaves a retryable record with the same ID, ciphertext, owner capability, nonce, and TTL. Retrying does not extend the server expiry.
- Links expire after 1, 7, or 30 days in the UI. Owners can revoke them. Revocation prevents later downloads; it cannot remove copies recipients already downloaded.
- The report preview now includes the exported value column. Percentage division uses decimal scaling and BigInt, including values beyond JavaScript's exact integer range. Percentages truncate to two decimal places. Share controls and recipient links are excluded from print.
- Reports read the actual parent route ID. Switching the route clears recipient links and ignores old asynchronous link responses.
- The portfolio shell selects only the local vault record matching the URL. Unknown or locked portfolios clear selection and hide child content. The home probes existing vault state after reload and carries a requested portfolio through the unlock path.
- Route changes reset the shared data service. Old account responses cannot repopulate cleared or newer data. Native asset keys come from the response, with a chain/network-specific fallback. Address deduplication includes chain and network, so the same testnet and Signet address is not merged.
- The real browser pass found that vault creation could not start: the build emitted a worker URL pointing at the local TypeScript source because the Angular worker configuration was missing. The build now includes `tsconfig.worker.json`. Worker failures reject pending requests, unresponsive requests time out, and onboarding shows progress and a retryable error. Key derivation never silently substitutes an algorithm after the persisted KDF has been selected.
- A later browser pass created an actual Argon2id vault and encrypted records, then found a blank overview caused by its missing chart dependency. The portfolio route now provides the existing ECharts loader. The shell includes Reports, Sources, and Time machine links. The route test now asserts valid child content and activates the actual overview with the real chart directive's dependency injection; canvas rendering remains browser evidence.

## Local evidence

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Frontend share owner service | 11 tests passed | Real WebCrypto; HTTP and vault persistence use test doubles |
| Exact report calculations and controls | 15 tests passed | Angular component DOM and local services; no live data feed |
| Shell route identity, missing ID, lock, vault probe, actual overview activation | 4 tests passed | Real Angular router and local store; vault persistence is a test double; chart canvas rendering is checked separately |
| Data response cancellation and testnet/Signet separation | 3 tests passed | Real loading and aggregation logic; controlled API observations |
| Existing aggregation regressions | 9 tests passed | Deterministic aggregation cases |
| Vault worker errors, timeout, response correlation, KDF identity | 6 tests passed | Worker protocol tests; actual bundled worker and IndexedDB are verified separately by the browser pass |
| Vault onboarding progress, failure, duplicate suppression, retry | 1 test passed | Angular component DOM with controlled storage outcome |
| Backend encrypted share HTTP handler | 14 tests passed | Real Nest/Express routing; controlled persistence interface |
| Complete backend portfolio module boot | 1 test passed | Injectable graph boots without enabling storage |
| Frontend TypeScript application sources | Passed | `tsconfig.app.json`, not the empty solution configuration |
| Backend TypeScript sources | Passed | `tsconfig.json` |
| Targeted lint | No errors | Existing frontend warning-level style rules remain |
| Migration asset validation | Passed | 38 forward and 19 rollback files; validates assets, not database execution |
| Actual local browser vault/report lifecycle | 8 checks passed | Real bundled Argon2id worker, WebCrypto and IndexedDB; no live holdings or server share persistence |

Reproduce the focused frontend checks from `frontend`:

```powershell
node node_modules/vitest/vitest.mjs run src/app/universe/portfolio/share/portfolio-share.service.spec.ts src/app/universe/portfolio/reports/report-builder.component.spec.ts src/app/universe/portfolio/shell/portfolio-shell.component.spec.ts src/app/universe/portfolio/data/portfolio-data.service.spec.ts src/app/universe/portfolio/shared/aggregation.spec.ts src/app/universe/portfolio/stores/vault.service.spec.ts src/app/universe/portfolio/onboarding/onboarding.component.spec.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json
```

Reproduce backend checks from the sibling `backend-apis` checkout:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/universe-portfolio/share/portfolio-share.spec.ts src/universe-portfolio/universe-portfolio.module.spec.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/eslint/bin/eslint.js src/universe-portfolio/share/*.ts src/universe-portfolio/universe-portfolio.module.ts src/universe-explorer-overlay.ts
node scripts/verify-migration-assets.cjs
```

## Remaining acceptance

Actual database persistence is BLOCKED. The host has MySQL84 listening on port 3306, but the bounded credential lookup found no approved local credential loader. No credentials were guessed or changed. The new migration has not been executed. The feature stays disabled unless `UNIVERSE_PORTFOLIO_SHARE_ENABLED=true` is explicitly configured with working storage.

Required next evidence is a disposable approved local database: apply the additive migration, create shares under two test-owned capabilities, read/decrypt independently, restart the local service and reload, reject another owner's revocation, then verify expiry and revocation from the real browser. The current HTTP tests do not prove durability, database constraints, a gateway proxy, or an end-to-end owner/recipient journey.

The final frontend build and full suite passed: 1209 tests across 86 files. [Browser evidence](browser-portfolio-2026-09-05.json) records actual encrypted vault creation, overview/report rendering, locked reload, wrong-passphrase rejection, successful unlock, requested identity restoration, unknown identity refusal and unavailable share handling. The eight browser checks include three report theme/viewport cases. These accept the recorded local scope; live holdings and server sharing remain blocked. Other Q05 account, connection, holding, activity, performance, time-machine, UTXO, insight, source and export variants remain separate requirements. No deployment, CI, runner or push was performed.
