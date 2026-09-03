# Running your own instance

How to stand up Universe Explorer from source, and what is different from the
upstream setup you may already know.

This is the self-hosting guide. `docs/operations/DEPLOYMENT.md` is the runbook
for the deployment Bitcoin Universe operates, and it assumes machinery you will
not have.

The inherited setup steps (Bitcoin Core, an Electrum or Esplora server,
MariaDB, the database user) are documented by upstream in
[`backend/README.md`](../../backend/README.md) and
[`frontend/README.md`](../../frontend/README.md), and this fork has not changed
them. This page covers what is different, in order.

## What you need

| Component | Version | Why |
| --- | --- | --- |
| Node.js | 24.19.0 | pinned in `.nvmrc`; the toolchain the CI fleet and the release artifact use |
| npm | 11.17.0 | pinned alongside Node |
| Rust and `cargo` | 1.84 | `rust/gbt/rust-toolchain`. The backend's `preinstall` script builds `rust/gbt` before anything else, so `npm ci` in `backend/` fails without `cargo` on the path |
| Bitcoin Core | a `txindex=1` node with RPC enabled | the only source of Bitcoin chain data |
| MariaDB or MySQL | MariaDB 10.5 or later; the Universe fleet standard is MySQL 8.4 LTS | blocks, mining, statistics, and price history |
| An address index | optional | without one, address and unspent-output lookups report that they cannot be served |

You do not need Docker. The `docker/` directory is upstream's and is not how
Universe runs this.

### What you get with only the backend

The explorer works without the Universe protocol overlay. You get the full
Bitcoin block, mempool, fee, and mining product, and the protocol pages report
that no authority is configured. That is a truthful state, not a broken one.

You do not get Dogecoin, Zcash, or any asset protocol reading. Those come from
the overlay in `bitcoinuniverseio/backend-apis` and from the protocol indexers
behind it, both of which are separate services with their own deployment.

## 1. Build

```bash
git clone https://github.com/bitcoinuniverseio/mempool.git
cd mempool

cd backend && npm ci && npm run build && cd ..
cd frontend && npm ci && npm run build:universe && cd ..
```

`build:universe` is this fork's production build. It differs from upstream's
`build` in two ways that matter:

- **No localization.** Only the English build ships.
- **No asset synchronization.** Upstream's `sync-assets` step downloads mining
  pool logos and other assets from third parties at build time. The Universe
  build does not, so nothing is fetched from anyone at build time. Mining pool
  logos fall back to the bundled default.

`node scripts/universe/check-origins.mjs frontend/dist` fails the build if any
forbidden origin appears in the output. Run it after a build you intend to
serve.

## 2. Configure the backend

Copy the sample and edit it:

```bash
cp backend/mempool-config.sample.json backend/mempool-config.json
```

The full reference is [`CONFIGURATION.md`](CONFIGURATION.md). The minimum is
`CORE_RPC`, `DATABASE`, and a `MEMPOOL.BACKEND` value that matches the address
infrastructure you actually have.

Three Universe defaults differ from upstream and you should leave them alone
unless you know why you are changing them:

| Setting | Universe default | Why |
| --- | --- | --- |
| `MEMPOOL.HTTP_HOST` | `127.0.0.1` | upstream binds every interface, which publishes the API on whatever address the host happens to have. A deployment that wants that has to ask for it |
| `EXTERNAL_DATA_SERVER.MEMPOOL_API` | empty | this deployment never calls a hosted third-party API. Upstream ships a hosted endpoint here |
| `MEMPOOL.AUTOMATIC_POOLS_UPDATE` | `false` | turning it on makes the backend fetch mining pool metadata from a third-party host at runtime. The bundled `backend/src/tasks/pools/pools-v2.json` is used instead |

## 3. Run

```bash
cd backend && npm run start
```

The backend listens on `127.0.0.1:8999` by default.

For development, the Angular dev server proxies `/api` to
`http://localhost:8999`:

```bash
cd frontend && npm run serve
```

The proxy table is `frontend/proxy.conf.local.js`. To point the dev server at a
different backend, edit the targets there; there is no environment variable for
it.

## 4. Serve the built product

`scripts/universe/gateway.mjs` is the single public entry point. It serves the
built frontend and splits `/api` between the backends. Everything it does is
deliberately small: no body rewriting, no caching layer, no configuration
language.

```bash
UNIVERSE_GATEWAY_PORT=8099 \
UNIVERSE_GATEWAY_ROOT=frontend/dist/mempool/browser \
UNIVERSE_GATEWAY_BACKEND=http://127.0.0.1:8999 \
node scripts/universe/gateway.mjs
```

It listens on loopback by default and is meant to sit behind your own TLS
terminator. The route split it implements is documented in
[`../api/HTTP-API.md`](../api/HTTP-API.md) and held by
`node --test scripts/universe/gateway.test.mjs`.

Set `UNIVERSE_GATEWAY_OVERLAY` only if you are running the protocol overlay,
and `UNIVERSE_GATEWAY_ESPLORA` only if you are running an Esplora-compatible
address index. Getting the second one wrong is not a subtle failure: with
`MEMPOOL.BACKEND` set to `esplora` the backend does not mount the address,
transaction, block, or mempool routes at all, so pointing `/api/` at it makes
every one of those paths answer `404` while the site still loads.

## 5. Check that it is actually serving

```bash
curl -s http://127.0.0.1:8099/api/v1/capabilities
curl -s http://127.0.0.1:8099/api/v1/backend-info
```

`/api/v1/capabilities` is the endpoint to read first. It reports, per feature,
whether it is enabled, whether its routes were actually mounted, whether its
dependencies are reachable, and how far behind its data is. A feature that is
`enabled` but has `routesRegistered: false` is exactly the fault that shipped a
Charts page and a Mining dashboard with no backend behind them, which is why
the report exists.

## Synchronization and what it costs

### Block indexing

The backend indexes blocks into the database on start-up and then keeps up
incrementally. `MEMPOOL.INDEXING_BLOCKS_AMOUNT` bounds the window: `11000` by
default, `0` disables indexing, `-1` indexes the whole chain. The initial pass
reads history over Bitcoin Core RPC, so it costs Core time; do not start it
while the host is also rebuilding something else.

Raising `INDEXING_BLOCKS_AMOUNT` later re-indexes further back and costs that
RPC time again.

### Database growth

Measured on the Universe deployment with a year of blocks indexed and the
statistics writer sampling once a minute: roughly 300 MB a year in total, with
`blocks` at about 0.4 MB a day and `statistics` about the same. Nothing is
pruned, and statistics are kept indefinitely on purpose, because the `all`
range is the whole series and deleting old samples would silently shorten it.

### The address index

An `mempool/electrs` index built in light mode writes about a terabyte for
Bitcoin mainnet. Light mode is what makes that fit: the index does not keep its
own copy of raw transactions, block-to-txid maps, or block stats, and reads
them from Bitcoin Core's block files instead. Full mode needs roughly twice the
space, and about double that again while compacting.

The repository does not record a measured wall-clock duration for that initial
sync, so this page does not give one. Watch the size of the index data
directory rather than the clock: the index logs one line per batch for hours,
into a journal that can rotate and take the history with it, and the directory
size is the progress signal that survives a rotation.

Do not switch `MEMPOOL.BACKEND` to `esplora` until the index is ready.

### Memory

`npm run start` runs the backend with `--max-old-space-size=2048`.
`npm run start-production` raises that to `16384`. The production value is
sized for a mainnet deployment holding the full mempool and a large indexed
block window; a development instance does not need it.

## Upgrading

```bash
git pull
cd backend  && npm ci && npm run build
cd frontend && npm ci && npm run build:universe
```

Database migrations run automatically on backend start-up
(`backend/src/api/database-migration.ts`). Take a database backup before
upgrading across releases; the migration path is forward only.

The gateway serves the static root per request rather than caching it at
start-up, so swapping the built frontend under a running gateway is enough to
publish a frontend change. A backend change needs a backend restart.

## Where to go next

| Question | Document |
| --- | --- |
| Every configuration key that matters | [`CONFIGURATION.md`](CONFIGURATION.md) |
| The public HTTP surface and how to integrate | [`../api/HTTP-API.md`](../api/HTTP-API.md) |
| How the Universe deployment is put together | [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| What the explorer will and will not claim about an asset | [`../data/ASSET-EVIDENCE.md`](../data/ASSET-EVIDENCE.md) |
| Reorg and checkpoint handling | [`../data/CHECKPOINTS-AND-REORGS.md`](../data/CHECKPOINTS-AND-REORGS.md) |
| Recovering from a specific failure | [`RECOVERY.md`](RECOVERY.md) |
| How releases are cut | [`RELEASING.md`](RELEASING.md) |
