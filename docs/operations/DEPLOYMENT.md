# Deployment

Universe Explorer runs as three processes on one host, reached through one
public HTTPS origin.

## Topology

```
explorer.bitcoinuniverse.io          public origin, TLS terminated at the gateway host
  -> nginx                           proxies the whole origin to one upstream
  -> universe-explorer-tunnel        forward-only SSH tunnel, 127.0.0.1:8385
  -> universe-indexer-01:8099        universe-explorer-gateway
       /api/v1/universe/*  ->  universe-explorer-overlay   127.0.0.1:3400
       /api/*              ->  universe-explorer-backend   127.0.0.1:8996
       everything else     ->  the built frontend, SPA fallback
```

No indexer port, RPC port, or database port is exposed publicly, and the
browser never learns an indexer origin. The tunnel key on the gateway host is
restricted to port forwarding and to that single destination port.

## Components

| Unit | What it is | Listens |
| --- | --- | --- |
| `universe-explorer-backend.service` | the forked explorer backend, `backend/dist/index.js` | 127.0.0.1:8996 |
| `universe-explorer-overlay.service` | the `backend-apis` read-only protocol overlay, `dist/universe-explorer-main.js` | 127.0.0.1:3400 |
| `universe-explorer-gateway.service` | `scripts/universe/gateway.mjs`, static files plus routing | 127.0.0.1:8099 |

All three run as the `universe-explorer` system user. The backend additionally
holds the `bitcoin` supplementary group so it can read the Core cookie, and
nothing else.

## Data authorities

The backend reads only Universe-owned infrastructure:

- Bitcoin Core on 127.0.0.1:8332, authenticated by cookie
- Fulcrum on 127.0.0.1:50001 for address and UTXO queries
- no third-party API, at runtime or at build time

`DATABASE.ENABLED` is `false`. The database only powers historical indexing,
mining statistics, and audit features; the live explorer, the protocol overlay,
and every route this product leads with work without it. Running without it
keeps the explorer off the memory budget of a host that is also indexing.
`AUTOMATIC_POOLS_UPDATE` is `false` so no pool metadata is fetched from a third
party; mining pool logos fall back to the bundled default.

The overlay reads only Universe protocol authorities, configured through
`UNIVERSE_EXPLORER_SOURCES_JSON` in `/etc/universe-explorer/overlay.env`, with
bearer tokens supplied by separate named variables. Credentials never appear in
the JSON, in responses, or in logs.

## Configuration

`/etc/universe-explorer/`, owned by root, group `universe-explorer`, mode 0640:

| File | Holds |
| --- | --- |
| `backend.json` | explorer backend configuration |
| `overlay.env` | overlay port and the protocol source registry |
| `gateway.env` | gateway ports and the static root |
| `fulcrum.conf` | the Electrum index this deployment reads |

## Build

Build on the runner fleet, not on the indexer host:

```bash
cd frontend && npm ci && npm run build:universe
cd backend  && npm ci && npm run build
```

`build:universe` deliberately omits `--localize` and asset synchronization. Only
the English build ships, and nothing is downloaded from a third party.

`src/resources` and the alternative theme stylesheets reach the output through
the production asset list in `frontend/angular.json`, not through the upstream
`sync-assets` step, which also fetches from third parties.
`check-build-assets.mjs` fails the build when anything the built index
references is missing from the output, because both of those went missing once
without anything noticing.

## Release procedure

1. Run the full check set on the runner fleet
   (`.github/workflows/universe-ci.yml`), including the branding, origin, and
   text gates against both the source tree and `frontend/dist`.
2. Install the new release beside the running one under
   `/opt/universe-explorer/releases/mempool-<sha>/`. Never overwrite a live
   release directory in place.
3. Point `/opt/universe-explorer/current` at the new release with an atomic
   symlink swap.
4. Restart the three explorer units. The gateway comes back within a second,
   so the public origin sees at most a brief connection reset rather than a
   sustained outage.
5. Verify: `/__gateway/health` on the gateway, tip height against Core,
   a known block and transaction render, `/api/v1/universe/status` reports its
   sources, and the `/source` page shows the deployed commit.
6. Keep the previous release directory until the stability window closes.

## Rollback

Point the symlink back and restart:

```bash
ln -sfn /opt/universe-explorer/releases/mempool-<previous-sha> /opt/universe-explorer/current.new
mv -Tf /opt/universe-explorer/current.new /opt/universe-explorer/current
systemctl restart universe-explorer-backend universe-explorer-overlay universe-explorer-gateway
```

Nothing else changes: configuration lives outside the release directory, and no
migration runs, so a rollback is exactly the same operation in reverse.

## Rules

Never restart a protocol indexer to make a deployment convenient. Never stop
Bitcoin Core. Never interrupt an ord index rebuild. `universe-mempool.service`
on the same host is a different product and is not part of this stack.

## Release identity

Every deployment publishes what it is running: the backend reports `gitCommit`
on `/api/v1/backend-info`, and the public `/source` page renders the release
SHA, the pinned upstream base, the licence, and the source repository link. A
build whose SHA is not published must not ship.
