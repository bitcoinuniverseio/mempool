# Universe Explorer

The Bitcoin Universe mempool and block explorer. It shows what is happening on
Bitcoin right now, and what transactions actually do across Bitcoin Universe
protocols, with the evidence behind every claim.

Live at [explorer.bitcoinuniverse.io](https://explorer.bitcoinuniverse.io).

## What makes it different

Most explorers answer one of two questions. A mempool explorer tells you what
is pending and what it will cost to confirm. A protocol explorer tells you what
assets exist. Universe Explorer answers both in one place, and it never guesses.

- **Exact asset flows.** A transaction page names the inputs and outputs that
  carry protocol assets, the action the authority reported, and the block that
  proves it. Nothing is inferred from transaction shape.
- **Outputs are first class.** `/outpoint/:txid/:vout` is a real page. An output
  is the unit that carries assets on Bitcoin, so it gets its own address.
- **States that mean something.** Proven, partly proven, outside coverage,
  pending, and unavailable are five different answers. A missing indexer never
  becomes a false zero.
- **Live protocol activity, measured.** The pulse page publishes its own
  denominator: how many arriving transactions were checked, and how many carried
  each protocol. Every number on it can be reproduced.
- **No trackers, no accounts.** Search is matched in your browser. Saved pages
  and history live in local storage and never leave the device.
- **First-party data only.** Every figure comes from Bitcoin Universe's own
  node, Electrum index, and protocol authorities.

## Protocol coverage

The registry carries every protocol in the Bitcoin Universe ecosystem, and the
explorer states plainly which ones it can actually read.

| State | Meaning |
| --- | --- |
| Live, read only | A first-party authority is running and its evidence is shown. |
| Not yet available | No first-party authority for it is configured or answering here. The explorer makes no claim about it. |
| Different chain | The protocol lives on a chain this explorer does not serve. |

Live today, backed by the first-party Ord 0.29 authority: **Ordinals**,
**Rare Sats**, **Runes**.

`docs/protocols/PROTOCOL-COVERAGE.md` is generated from the registry and lists
every entry with its authority. Run `node scripts/universe/generate-protocol-coverage.mjs --check`
to verify the table still matches.

## Architecture

Three processes behind one HTTPS origin:

| Component | What it is |
| --- | --- |
| Explorer backend | `backend/` in this repository. Reads Bitcoin Core, Fulcrum, and MariaDB. |
| Protocol overlay | `backend-apis` standalone service. Serves `/api/v1/universe/*` and holds every indexer credential server side. |
| Frontend | `frontend/`, an Angular application served as static files with SPA fallback. |

The browser never talks to an indexer, and no indexer origin or credential is
ever exposed to it. See `docs/architecture/` for the overlay design and
`docs/data/ASSET-EVIDENCE.md` for the evidence contract.

## First-party data policy

No third-party blockchain API, public explorer, hosted indexer, analytics
service, or remote font is called at any point, from the server or the browser.
Collection-level artwork and metadata are the only permitted external sources,
and they are fetched server side and cached.

`node scripts/universe/check-origins.mjs` fails the build if a forbidden origin
appears in the source or in a production bundle. The production build also skips
asset synchronization, so nothing is downloaded from a third party at build time
either; mining pool logos fall back to the bundled default.

## Local development

Requires Node 24.19.0 and npm 11.17.0, both pinned in `.nvmrc` and
`package.json`.

```bash
cd backend && npm ci && npm run build && npm run start
```

```bash
cd frontend && npm ci && npm run serve
```

The frontend proxies `/api` to the backend. To point it at a running deployment
instead, set `MEMPOOL_BACKEND` in `frontend/proxy.conf.json`.

## Testing

```bash
cd frontend && npm run build:universe   # production build, no third-party fetches
cd frontend && npm run test          # Universe unit suite
cd frontend && npm run lint
cd backend && npm run test:ci && npm run lint
node scripts/universe/generate-protocol-coverage.mjs --check
node scripts/universe/check-text.mjs                 # no em dash anywhere
node scripts/universe/check-branding.mjs             # no obsolete upstream marks
node scripts/universe/check-origins.mjs              # no third-party data origins
```

The same checks run in `.github/workflows/universe-ci.yml` on the self-hosted
runner fleet. The branding and origin gates also accept a built bundle path, and
the release workflow runs them against `frontend/dist` before anything ships.

## Configuration

The backend reads `backend/mempool-config.json`. The overlay reads
`UNIVERSE_EXPLORER_SOURCES_JSON`, a JSON array of authority descriptors whose
bearer tokens are named, never embedded:

```json
[{ "authorityId": "ord",
   "origin": "http://127.0.0.1:8382",
   "bearerTokenEnv": "UNIVERSE_ORD_TOKEN",
   "protocols": ["ordinals", "rare_sats", "runes"],
   "network": "bitcoin:mainnet" }]
```

Parsing is strict and all or nothing: one invalid descriptor disables the whole
registry rather than serving partially trusted data.

## Deployment

`docs/operations/DEPLOYMENT.md` documents the release procedure. Releases are
deployed beside the running one and the gateway upstream is flipped, so a
rollback is a single flip back. Every deployment publishes its own commit on
`/api/v1/backend-info` and on the public `/source` page.

## Source and licence

Universe Explorer is free software under the
[GNU Affero General Public License, version 3](LICENSE) or later. Section 13
requires that anyone interacting with it over a network can get the
corresponding source, which is what `/source` provides.

This repository is a fork of the upstream Mempool Open Source Project. Upstream
copyright notices and the full licence text in [COPYING.md](COPYING.md) are
preserved. Upstream trademarks are not used: see
`docs/legal/TRADEMARK-AUDIT.md` and `docs/legal/AGPL-COMPLIANCE.md`.

## Upstream relationship

[UPSTREAM.md](UPSTREAM.md) records the exact upstream base, every subsystem this
fork modifies, and the known conflict points. `docs/operations/UPSTREAM-SYNC.md`
is the synchronization procedure. Universe changes are deliberately isolated so
upstream security fixes stay easy to take.

## Security

Report a suspected vulnerability privately to the Bitcoin Universe security
contact rather than opening a public issue. `docs/security/THREAT-MODEL.md`
records the trust boundaries this deployment assumes.

## Contributing

Work happens on `develop`. Open a pull request against it, keep Universe changes
inside `frontend/src/app/universe/` and the documented integration points where
possible, and make sure the checks above pass. [CONTRIBUTING.md](CONTRIBUTING.md)
covers the details inherited from upstream.
