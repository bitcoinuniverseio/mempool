# Trademark audit

Purpose: ensure the public Universe Explorer deployment contains no Mempool
Holdings trademarks, logos, slogans, or presentation implying affiliation.
Status: IN PROGRESS - inventory complete, removal tracked per item below.

Upstream's own about page enumerates the marks of Mempool Holdings S.A. de C.V.:
The Mempool Open Source Project (r), Mempool Accelerator (r), Mempool
Enterprise (r), Mempool Wallet (tm), mempool.space (r), "Be your own
explorer" (tm), "Explore the full Bitcoin ecosystem" (r), Mempool Goggles (tm),
the mempool Logo, Square Logo, block visualization Logo, Blocks Logo,
transaction Logo, Blocks 3|2 Logo, research Logo, and the mempool.space
Vertical/Horizontal Logos.

## Inventory and disposition

| Item | Where found (fork base v3.3.1) | Disposition |
| --- | --- | --- |
| mempool logos (PNG/JPEG/SVG) | `frontend/src/resources/mempool-logo-bigger.png`, `mempool-space-logo-*.png`, `mempool-blocks-*-logo.jpeg`, `mempool-space-preview.png`, `previews/mempool-space-preview.jpg` | REMOVE; replace with original Universe logo treatment and social cards |
| In-app SVG logo components | `frontend/src/app/components/svg-images/svg-images.component.html` (mempool logo paths) | REPLACE with Universe marks |
| "Mempool Goggles" name | `block-filters.component.{ts,html}`, dashboards, transaction-details, about | REPLACE feature name with "Universe Lens"; strings must not ship in bundles |
| "Be your own explorer" slogan | `about.component.html` | REMOVE (about page replaced by Universe source/about page) |
| "Explore the full Bitcoin ecosystem" slogan | `search-form.component.html` placeholder, about | REPLACE with original Universe copy |
| Mempool Accelerator branding + UI | ~91 files under acceleration components/services | Feature remains disabled (no `MEMPOOL_SERVICES` configured); public routes/nav entries removed; branded strings removed from shipped bundles where reachable |
| Mempool Enterprise references | about page, services code | REMOVE from public surface |
| Trademark policy page | `frontend/src/app/components/trademark-policy/` | REMOVE route/page (policy text is Mempool Holdings'); fork keeps no claim to those marks |
| Sponsor graphics / profile images | about page sponsor sections, `frontend/src/resources/profile/*` | REMOVE from public deployment |
| mempool.space service links | chat/onion/enterprise links across components | REMOVE or replace with Universe equivalents |
| Liquid Network branding | liquid logos/components | Liquid views not exposed in Universe deployment (BASE_MODULE=mempool); assets retained in source for upstream mergeability, unreachable publicly |
| Package names/titles ("mempool-frontend", "Mempool" titles) | package.json, index HTML titles, manifests | REPLACE user-visible titles with Universe Explorer; internal package names may remain for merge hygiene |

## Rules applied

- No confusingly similar logos: Universe iconography is designed independently.
- The familiar explorer layout and mechanics of the AGPL codebase are retained;
  that is licensed functionality, not trade dress owned by upstream marketing.
- Upstream LICENSE/COPYING and copyright notices are PRESERVED (see
  AGPL-COMPLIANCE.md) - only trademark usage is removed.
- The upstream synchronization procedure re-checks this table after every sync.

## Release gate

Do not declare GO until every REMOVE/REPLACE row above is verified against the
built production bundle (grep of `dist/` output for: "mempool.space",
"Goggles", "Be your own explorer", "Explore the full Bitcoin ecosystem",
"Accelerator", "Mempool Enterprise", plus visual review of all public routes).
