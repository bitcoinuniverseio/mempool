# Configuration reference

Every configuration surface this repository has, what each key does, and which
defaults this fork deliberately changed.

The authoritative list is `backend/src/config.ts`: the `IConfig` interface names
every key and the `defaults` object gives every default. This page explains the
ones that decide whether a deployment works, and states where the Universe
answer differs from upstream's.

`docs/operations/DEPLOYMENT.md` covers where these files live on the operated
deployment. This page covers what goes in them.

## Four surfaces

| Surface | Read by | Format |
| --- | --- | --- |
| `backend/mempool-config.json` | the explorer backend | JSON, merged over the defaults in `config.ts` |
| `UNIVERSE_GATEWAY_*` environment | `scripts/universe/gateway.mjs` | environment variables, all optional |
| `UNIVERSE_EXPLORER_SOURCES_JSON` and the token variables it names | the protocol overlay | environment variables |
| `frontend/mempool-frontend-config.json` | the frontend build and dev proxy | JSON, optional |

Set `MEMPOOL_CONFIG_FILE` to load the backend configuration from somewhere
other than `backend/mempool-config.json`. It is the only environment variable
the backend reads to find its configuration.

## Backend

Start from `backend/mempool-config.sample.json`. Anything you leave out takes
the default from `config.ts`.

### `MEMPOOL`

| Key | Default | What it does |
| --- | --- | --- |
| `NETWORK` | `mainnet` | `mainnet`, `testnet`, `testnet4`, `signet`, `regtest`, `liquid`, `liquidtestnet`. The Universe deployment runs `mainnet` only |
| `BACKEND` | `none` | Where address, script hash, transaction, block, and mempool data comes from: `esplora`, `electrum`, or `none`. This is the single most consequential key in the file. See below |
| `HTTP_PORT` | `8999` | The listener port |
| `HTTP_HOST` | `127.0.0.1` | **Universe change.** Upstream binds every interface, which publishes the API on whatever address the host happens to have. A deployment that wants that has to ask for it |
| `UNIX_SOCKET_PATH` | empty | Listen on a Unix socket instead of a TCP port |
| `SPAWN_CLUSTER_PROCS` | `0` | Worker processes. `0` means a single process |
| `API_URL_PREFIX` | `/api/v1/` | The prefix every backend route is registered under. Changing it moves the whole API and breaks the gateway's route table |
| `POLL_RATE_MS` | `2000` | How often the backend polls its data sources |
| `CACHE_DIR`, `CACHE_ENABLED` | `./cache`, `true` | On-disk mempool cache, so a restart does not start from an empty mempool |
| `INDEXING_BLOCKS_AMOUNT` | `11000` | How far back to index blocks into the database. `0` disables indexing, `-1` indexes the whole chain. Requires `DATABASE.ENABLED` |
| `BLOCKS_SUMMARIES_INDEXING` | `false` | Index per-block transaction summaries. Expensive in both time and space |
| `CPFP_INDEXING` | `false` | Index child-pays-for-parent clusters |
| `AUDIT` | `false` | Block template auditing, which compares mined blocks against what the node expected |
| `RUST_GBT` | `true` | Use the Rust block template builder in `rust/gbt`. Turning it off falls back to the TypeScript implementation |
| `AUTOMATIC_POOLS_UPDATE` | `false` | **Leave off.** Turning it on makes the backend fetch mining pool metadata over the network at runtime, from `POOLS_JSON_URL`. The bundled `backend/src/tasks/pools/pools-v2.json` is used instead |
| `MAX_PUSH_TX_SIZE_WEIGHT` | `400000` | Largest transaction the broadcast route accepts, in weight units |
| `MAX_TRACKED_ADDRESSES` | `1` | How many addresses one WebSocket client may subscribe to |
| `STDOUT_LOG_MIN_PRIORITY` | `debug` | Minimum syslog priority written to stdout |
| `ALLOW_UNREACHABLE` | `true` | Start even when a data source is not answering yet |
| `RECOMMENDED_FEE_PERCENTILE` | `50` | Percentile used for the recommended fee |
| `PRICE_UPDATES_PER_HOUR` | `1` | How often the price task runs, when prices are enabled |

#### Choosing `BACKEND`

This key decides which routes the backend mounts, not just where it reads from.

| Value | What happens |
| --- | --- |
| `esplora` | The backend does **not** mount the address, script hash, transaction, block, or mempool routes at all. It expects the edge to send that whole family to an Esplora-compatible index. Point `/api/` at the backend in this mode and every one of those paths answers `404` while the site still loads |
| `electrum` | The backend serves those routes, reading an Electrum server for address history |
| `none` | Address, script hash, and unspent-output lookups cannot be served. The release preflight treats this as a blocking fault on a deployment that still offers address search, because it produced exactly that: a search box that recognised an address and an address page that blamed the address for having too much history |

The gateway's `UNIVERSE_GATEWAY_ESPLORA` has to agree with this key. They are
two halves of one decision.

### `CORE_RPC` and `SECOND_CORE_RPC`

Bitcoin Core RPC. `HOST`, `PORT`, `USERNAME`, `PASSWORD`, `TIMEOUT`, and either
credentials or `COOKIE: true` with `COOKIE_PATH`.

Core needs `txindex=1` and `server=1`. `SECOND_CORE_RPC` is used only when
`MEMPOOL.USE_SECOND_NODE_FOR_MINFEE` is on, to read a minimum relay fee from a
second node.

`DEBUG_LOG_PATH` points at Core's `debug.log` and is read for block template
auditing. Leave it empty when auditing is off.

### `ELECTRUM` and `ESPLORA`

Whichever one `MEMPOOL.BACKEND` names.

`ESPLORA.REST_API_URL` defaults to `http://127.0.0.1:3000`, and
`ESPLORA.UNIX_SOCKET_PATH` uses a socket instead when set.
`ESPLORA.MAX_BEHIND_TIP` (default `2`) is how many blocks the index may be
behind Core and still be treated as current.

`ESPLORA.FALLBACK` is an array of additional Esplora origins. **Leave it
empty.** A fallback to a hosted index is the exact shape the first-party data
policy forbids, and `scripts/universe/check-origins.mjs` exists because that
kind of thing arrives through a well-meaning fallback.

### `DATABASE`

`ENABLED` (default `true`), `HOST`, `PORT`, `DATABASE`, `USERNAME`, `PASSWORD`,
`SOCKET` for a Unix socket, `POOL_SIZE` (default `100`), `TIMEOUT`.

Turning the database off disables block indexing, mining, and statistics. The
release preflight refuses a configuration that leaves those features switched on
with the database off, because that advertises pages nothing would serve.

Migrations run automatically at backend start-up
(`backend/src/api/database-migration.ts`), forward only.

### `STATISTICS`

`ENABLED` (default `true`) and `TX_PER_SECOND_SAMPLE_PERIOD` (default `150`).
Requires the database and `MEMPOOL.ENABLED`. Samples are kept indefinitely on
purpose: the `all` range is the whole series.

### `FIAT_PRICE`

`ENABLED` (default `true`), `PAID`, `API_KEY`.

Worth understanding before you turn it on: the price task calls public exchange
APIs directly from the backend. Those are market data sources, not blockchain
data sources, and the first-party data policy is about blockchain data. It is
still an outbound call from your server, which some deployments do not want.
`/api/v1/prices` answers `-1` for every currency when no price has been
recorded, which is what the public deployment currently serves.

### `REDIS`

`ENABLED` (default `false`), `UNIX_SOCKET_PATH`, `BATCH_QUERY_BASE_SIZE`. An
optional cache for mempool and RBF state across restarts.

### `SYSLOG`

`ENABLED` (default `true`), `HOST`, `PORT`, `MIN_PRIORITY`, `FACILITY`.

### `SOCKS5PROXY`

`ENABLED` (default `false`), `USE_ONION`, `HOST`, `PORT`, and optional
credentials. Routes the backend's outbound requests through a SOCKS5 proxy.

### Sections a Universe deployment leaves alone

| Section | State | Why |
| --- | --- | --- |
| `LIGHTNING`, `LND`, `CLIGHTNING` | off, and off by default | The inherited Lightning product is not part of the Universe explorer. `/api/v1/backend-info` reports `lightning: false` on the public deployment |
| `MEMPOOL_SERVICES` | `API` empty, `ACCELERATIONS` false | Upstream's hosted services. Leave both unset |
| `EXTERNAL_DATA_SERVER` | `MEMPOOL_API` empty | **Universe change.** Upstream ships a hosted endpoint here. The remaining onion and Liquid entries are upstream defaults this fork has not cleared; they are not read by a mainnet Bitcoin deployment, and nothing in the Universe deployment path calls them. Do not enable them |
| `REPLICATION` | off | Replicates audit and statistics data from other mempool servers |
| `MAXMIND` | off | GeoIP databases, used only by the Lightning product |
| `WALLETS`, `STRATUM` | off | Upstream features this fork does not use |

## Gateway

`scripts/universe/gateway.mjs`. Every variable is optional and every default is
loopback.

| Variable | Default | What it does |
| --- | --- | --- |
| `UNIVERSE_GATEWAY_HOST` | `127.0.0.1` | Listener address |
| `UNIVERSE_GATEWAY_PORT` | `8099` | Listener port |
| `UNIVERSE_GATEWAY_BACKEND` | `http://127.0.0.1:8996` | The explorer backend |
| `UNIVERSE_GATEWAY_OVERLAY` | `http://127.0.0.1:3400` | The protocol overlay. Leave unset if you are not running one |
| `UNIVERSE_GATEWAY_ESPLORA` | unset | The first-party Esplora-compatible index. Unset means the explorer backend keeps the whole `/api/` family |
| `UNIVERSE_GATEWAY_ROOT` | `frontend/dist/mempool/browser` | The built frontend to serve |

The gateway resolves its static root per request rather than caching it at
start-up, so a release can swap the built frontend underneath a running gateway.
The content security policy is computed per document for the same reason: a
policy pinned at start-up does not follow that swap, and one that did not
follow it once shipped a site whose own theme bootstrap was blocked by its own
policy.

## Protocol overlay

The overlay is a separate service from `bitcoinuniverseio/backend-apis`. Its
source registry is the part this repository documents, because a malformed one
is a whole-product failure.

`UNIVERSE_EXPLORER_SOURCES_JSON` is a JSON array of authority descriptors.
Bearer tokens are **named, never embedded**:

```json
[
  {
    "authorityId": "ord",
    "origin": "http://127.0.0.1:8382",
    "bearerTokenEnv": "UNIVERSE_ORD_TOKEN",
    "protocols": ["ordinals", "rare_sats", "runes"],
    "network": "bitcoin:mainnet"
  }
]
```

Parsing is strict and all or nothing: one invalid descriptor disables the whole
registry rather than serving partially trusted data. The release preflight
refuses a cutover when the registry does not parse, and again when a protocol
the build presents as readable has no authority behind it.

No authority origin, port, path, or token ever reaches a browser. The overlay
holds all of them server side, which is why `/api/v1/universe/sources` can
publish an authority's lag without publishing where it lives.

## Frontend

`frontend/mempool-frontend-config.json`, read by `frontend/generate-config.js` at build
time and by the dev proxy. It is optional; without it the build uses its
defaults.

The dev server proxy table is `frontend/proxy.conf.local.js`, and it targets
`http://localhost:8999`. To point the dev server at a different backend, edit
the targets there. There is no environment variable for it.

`npm run build:universe` is the production build. It omits localization and
upstream's asset synchronization step, so nothing is fetched from a third party
at build time.

## Private administration adapter

The explorer exposes a private adapter for the Bitcoin Universe Control Center.
It is not part of the public API, it answers `404` to anything that does not
arrive over a private network path, and it answers `503` to everything when no
key is configured. An unconfigured adapter is never an open one. Its
configuration is documented in
[`CONTROL-CENTER-ADAPTER.md`](CONTROL-CENTER-ADAPTER.md).

## Checking a configuration

The backend publishes what it concluded from its configuration, so read that
rather than re-deriving it:

```bash
curl -s http://127.0.0.1:8999/api/v1/capabilities
```

A feature that is `enabled` with `routesRegistered: false` is a configuration
fault, not a data problem. So is a dependency reported as `configured: true`
and `reachable: false`.
