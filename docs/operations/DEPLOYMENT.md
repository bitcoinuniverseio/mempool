# Deployment

Universe Explorer runs as three processes behind one public HTTPS origin.

## Components

| Component | What it is | Listens |
| --- | --- | --- |
| Explorer backend | The forked Mempool backend (Node, `backend/dist/index.js`) | loopback, `MEMPOOL.HTTP_PORT` |
| Protocol overlay | `backend-apis` standalone read-only service (`dist/universe-explorer-main.js`) | loopback, `UNIVERSE_EXPLORER_PORT` |
| Static frontend | Angular production build (`frontend/dist/mempool/browser`) | served by the gateway |

The gateway (nginx) terminates TLS on 443 and routes:

- `/api/v1/universe/*` and the `universe:*` WebSocket namespace to the overlay
- everything else under `/api/` to the explorer backend
- all other paths to the static frontend with SPA fallback

No native RPC port, indexer port, or database port is ever exposed publicly.

## Data authorities

The explorer backend reads only Universe-owned infrastructure:

- Bitcoin Core v31 through a bounded RPC pool (`universe-explorer-rpc-pool`),
  never directly, so no single consumer can exhaust Core's connections
- Fulcrum (Electrum backend) for address and UTXO queries
- MariaDB for the explorer's own derived data (upstream migrations require
  MariaDB syntax; MySQL 8.4 rejects them)
- A local static mirror for mining-pool metadata, so no runtime call leaves
  Universe infrastructure

The overlay reads only Universe protocol authorities, configured through
`UNIVERSE_EXPLORER_SOURCES_JSON` with bearer tokens supplied by separate
environment variables. Credentials never appear in the JSON, in responses, or
in logs.

## Development instance (universe-indexer-01)

Services, all bound to loopback:

```
universe-explorer-rpc-pool.service    bounded Bitcoin RPC pool
universe-explorer-static.service      mining pool metadata mirror
universe-explorer-backend.service     forked Mempool backend
universe-explorer-overlay.service     protocol overlay
universe-explorer-mariadb (docker)    explorer database
```

Configuration and secrets live in `/etc/universe-explorer/`, mode 0600.
Release checkouts live under `/opt/universe-explorer/`.

## Release procedure

1. Build and test on the certified runner fleet (`.github/workflows/universe-ci.yml`).
2. Deploy the new release beside the current one; never overwrite a live release
   directory in place.
3. Run the explorer backend against the new release on its own port.
4. Verify: tip height matches Core, mempool count is non-zero, fee estimates
   resolve, a known block and transaction render, and the overlay reports its
   sources with agreeing checkpoints.
5. Switch the gateway upstream to the new port; keep the previous release
   running through the stability window so rollback is a single upstream flip.
6. Remove the superseded release only after the window closes.

Never restart a protocol indexer to make a deployment convenient, never stop
Bitcoin Core, and never interrupt an in-flight build.

## Release identity

Every deployment exposes its identity: the explorer backend reports
`gitCommit` on `/api/v1/backend-info`, and the public `/source` page renders
the Universe release SHA, the pinned upstream base, the license, and the
source repository link. A build whose SHA is not published must not ship.
