# Trademark audit

Purpose: ensure the public Universe Explorer deployment contains no Mempool
Holdings trademarks, logos, slogans, or presentation implying affiliation.

**Status: COMPLETE.** Enforced continuously by
`scripts/universe/check-branding.mjs`, which runs over the source tree and over
the production bundle in CI. A new occurrence fails the build.

Upstream's own about page enumerates the marks of Mempool Holdings S.A. de C.V.:
The Mempool Open Source Project (r), Mempool Accelerator (r), Mempool
Enterprise (r), Mempool Wallet (tm), mempool.space (r), "Be your own
explorer" (tm), "Explore the full Bitcoin ecosystem" (r), Mempool Goggles (tm),
the mempool Logo, Square Logo, block visualization Logo, Blocks Logo,
transaction Logo, Blocks 3|2 Logo, research Logo, and the mempool.space
Vertical/Horizontal Logos.

## Disposition

| Item | Where it was | What was done |
| --- | --- | --- |
| Upstream logos (PNG, JPEG, SVG) | `frontend/src/resources/`, preview images | Replaced with the Universe wordmark and logo |
| In-app SVG logo components | `svg-images.component.html` | Replaced with Universe marks; the remaining accelerator glyph title is now a plain word |
| "Mempool Goggles" name | block filters, dashboards, transaction details | Feature renamed to Universe Lens; every identifier (`activeGoggles$`, `goggleCycle`, `goggleIndex`) renamed so the mark does not survive minification |
| "Be your own explorer" slogan | about page | About page deleted |
| "Explore the full Bitcoin ecosystem" slogan | search placeholder, about, Liquid index | Replaced with original Universe copy |
| Accelerator branding and checkout UI | ~91 files | Public routes and nav removed; `accelerate-checkout` deleted; the transaction and tracker templates no longer embed it; remaining acceleration display components carry no upstream mark |
| Enterprise references and upsells | about page, API docs, services code | Removed. `EnterpriseService.exclusiveHostName` is empty, so no hostname is treated as an enterprise subdomain, and the upstream redirect on an unknown subdomain is gone |
| Hosted analytics | `EnterpriseService.insertMatomo` | Now a documented no-op. No tracker is loaded on any hostname |
| Trademark policy page | `components/trademark-policy/` | Deleted, along with its Liquid route |
| About page and sponsor graphics | `components/about/` | Deleted, along with its Liquid route |
| Upstream service links | footer, docs, transaction details | Removed |
| Upstream social accounts | global footer | Removed. The version line now links to the Universe fork commit |
| Terms of service and privacy policy | upstream legal text | Rewritten as Universe documents describing this deployment |
| Sponsor index variants | `index.mempool.{bitb,meta,onbtc,river,strategy,xxi}.html` | Deleted; unused by `generate-config` |
| Upstream node fleet scripts | `scripts/get_backend_hash.sh`, `scripts/get_block_tip_height.sh` | Deleted |
| Lightning node group page | `frontend/src/app/lightning/group/` | Deleted with its routes; it existed to advertise upstream's own nodes |
| Upstream domains in defaults | `state.service.ts`, `seo.service.ts`, `config.ts`, proxy configs, sample configs, package homepages | Point at this deployment, or are unset |
| Upstream CDN for build assets | `frontend/sync-assets.js` | The hosted mirror rewrite is removed, and the production build skips asset synchronization entirely |
| Liquid branding | Liquid components and index | Liquid views are not exposed (`BASE_MODULE=mempool`); the Liquid index metadata is rebranded and the peg links resolve locally |
| Package names and titles | `package.json`, index HTML, manifests | User-visible titles are Universe Explorer; internal package names remain for merge hygiene |

## Allowlisted references, and why

The gate permits an upstream reference only in these paths:

| Path | Reason |
| --- | --- |
| `COPYING.md`, `LICENSE` | Licence text, preserved verbatim |
| `UPSTREAM.md`, `upstream-base.json` | Fork provenance record |
| `CONTRIBUTING.md`, `contributors/` | Inherited contribution guide and contributor records |
| `docs/legal/` | This file and the AGPL compliance record |
| `docs/research/` | Competitor research that names the competitor |
| `docs/architecture/`, `docs/operations/UPSTREAM-SYNC.md` | Records which upstream subsystems are modified and how to sync |
| `README.md` | Fork attribution required by the licence |
| `backend/README.md`, `frontend/README.md`, `production/`, `docker/`, `rust/` | Inherited developer and operator notes |
| `frontend/src/locale/` | Upstream translation catalogues; not built by this deployment |
| `frontend/cypress/`, `.github/workflows/` | Inherited end-to-end suite, recorded fixtures, and upstream CI definitions |
| `scripts/universe/check-branding.mjs`, `check-origins.mjs` | The gates list the marks and hosts they ban |
| `audits/` | Dated audit records |

Two attribution sentences are permitted anywhere, including inside a minified
bundle, because publishing them is the point of them:

- the API docs statement that this is an independent instance of the
  AGPL-licensed upstream codebase, not affiliated with or endorsed by the
  upstream site;
- the source page statement that Universe Explorer is free software built on
  the upstream project, with the corresponding source published.

## Localization

The 33 upstream translation catalogues under `frontend/src/locale/` still carry
upstream copy, including its marks. They are **not built**: the production
script `npm run build:universe` omits `--localize`, so only the English build
ships and no catalogue reaches a bundle. They are retained so a future
translation pass starts from the upstream structure rather than from nothing.
Re-enabling locales requires regenerating them from the rebranded sources, and
the branding gate must be pointed at the localized output before that ships.

## Rules applied

- No confusingly similar logos: Universe iconography is designed independently.
- The familiar explorer layout and mechanics of the AGPL codebase are retained;
  that is licensed functionality, not trade dress owned by upstream marketing.
- Upstream LICENSE and COPYING notices are PRESERVED (see AGPL-COMPLIANCE.md).
  Only trademark usage is removed.
- The upstream synchronization procedure re-runs the gate after every sync.

## Verification, 26 August 2026

```
node scripts/universe/check-branding.mjs            # source tree
node scripts/universe/check-branding.mjs frontend/dist   # production bundle
node scripts/universe/check-origins.mjs
node scripts/universe/check-origins.mjs frontend/dist
node scripts/universe/check-text.mjs
```

All five passed against the release build.
