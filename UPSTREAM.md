# Upstream base

This repository is the Bitcoin Universe fork of the Mempool Open Source Project.

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/mempool/mempool |
| Upstream release | v3.3.1 |
| Upstream tag object | ce1f34a221fa0e1fc914947d5c0e0fe5b942ff11 |
| Upstream base commit | 9332d9db97bcc7beed079acc8f79aa21c9b12a3b |
| Upstream master at fork time | 63b89613b912063332cb0461dabeb209166c283e (2026-08-25) |
| Fork date | 2026-08-26 |
| Fork repository | https://github.com/bitcoinuniverseio/mempool |
| Integration branch | develop |
| Protected branch | main |

## Base selection rationale

v3.3.1 is the latest stable upstream release (published 2026-04-21). v3.4.0 exists
only as an alpha prerelease. GitHub lists no published security advisories for the
upstream repository at fork time. The `master` branch carries ~4 months of
unreleased work; it was not selected because the release gate requires a base that
passes the complete upstream test suite as a known-stable reference point.

## Remote configuration

- `origin`  = https://github.com/bitcoinuniverseio/mempool.git (Bitcoin Universe fork)
- `upstream` = https://github.com/mempool/mempool.git (push disabled locally)

The complete upstream Git history and all upstream tags are preserved in this fork.

## Modified subsystems

Universe modifications are tracked here as they land. See `docs/architecture/` for
the overlay architecture and `docs/operations/UPSTREAM-SYNC.md` for the
synchronization procedure.

| Subsystem | Nature of modification |
| --- | --- |
| `frontend/src/app/universe/` | Added. Universe protocol UI: protocol directory, asset flow section, protocol badge, source and licenses page. No upstream file is involved. |
| `frontend/src/app/master-page.module.ts` | Two lazy routes added (`/protocols`, `/source`); upstream routes untouched. |
| `frontend/src/app/components/transaction/` | The asset flow section is embedded on the transaction page. |
| Branding | Mempool Holdings trademarks replaced across templates, SEO, and the web manifest. See `docs/legal/TRADEMARK-AUDIT.md`. |
| `frontend/package.json`, `frontend/vitest.config.ts` | Unit test runner added. Upstream ships no working test target: `angular.json` has no `test` architect entry, so the upstream `ng test` script could never run. |
| `.github/workflows/universe-ci.yml`, `upstream-sync.yml` | Added. Upstream workflows are unchanged. |
| `scripts/universe/` | Added. Protocol coverage documentation generator and its CI check. |
| `.nvmrc` | Pinned to the Universe toolchain version (24.19.0). |
| `backend/src/index.ts`, `backend/src/config.ts` | `MEMPOOL.HTTP_HOST` added, defaulting to loopback. Upstream binds every interface. |
| `backend/src/api/backend-info.ts` | Publishes the node's own sync state so the explorer can say when its data is behind the chain. |
| `frontend/src/app/services/enterprise.service.ts` | Hosted analytics reduced to a no-op; the upstream redirect on an unknown subdomain removed; no hostname treated as an enterprise subdomain. |
| `frontend/src/app/services/state.service.ts`, `seo.service.ts` | Cross-network links, the services API, and the canonical domain point at this deployment or are unset. |
| `frontend/sync-assets.js`, `frontend/package.json` | `build:universe` omits localization and asset synchronization; the hosted CDN rewrite is removed. |
| Deleted upstream surfaces | `components/about/`, `components/trademark-policy/`, `components/accelerate-checkout/`, `lightning/group/`, the sponsor index variants, and the upstream node fleet scripts. |
| Rewritten upstream surfaces | `components/privacy-policy/`, `components/terms-of-service/`, `docs/api-docs/`. |
| Renamed identifiers | `activeGoggles$`, `goggleCycle`, `goggleIndex` are now `activeLens$`, `lensCycle`, `lensIndex`, so the trademark does not survive minification. |
| Accessibility | Accessible names added to the icon-only navigation, the search submit button, and the blockchain toggles. |
| `scripts/universe/` | Gateway, protocol coverage generator, and the branding, origin, and text gates. |

## Known upstream conflicts

| Area | Risk |
| --- | --- |
| `frontend/src/app/master-page.module.ts` | Upstream edits its route table regularly. The two Universe routes sit at the end of the child route array to keep the conflict small and mechanical. |
| Branding templates | Any upstream change to a rebranded template conflicts by construction. `docs/legal/TRADEMARK-AUDIT.md` lists every touched file so a merge can be resolved deliberately. |
| `frontend/package.json` | The `test` script diverges from upstream. Upstream's value is inert, so upstream's version can be discarded on conflict. |
| Punctuation | Every em dash was removed repository wide, including from inherited READMEs, and `scripts/universe/check-text.mjs` keeps them out. Expect one-character conflicts in those files on sync. |
| Branding edits across upstream components | The trademark work touches many upstream templates. `docs/legal/TRADEMARK-AUDIT.md` lists every one, and the branding gate fails the build if a sync reintroduces a mark. |

The two upstream spec files under `frontend/src/app/lightning/` import from a
path that does not exist in this tree and reference a missing `src/test.ts`.
They are left untouched so they keep merging cleanly; the Universe unit suite
does not include them.
