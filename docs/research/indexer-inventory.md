# Bitcoin Universe Protocol Indexer Inventory

Date: 2026-08-26. Read-only audit of all `D:\universe\<name>\<name>` indexer repos, plus `backend-apis` and `wallet`.
Paths inside each section are relative to that repo's root unless prefixed with `D:\`.

## Headline cross-cutting findings

1. **`/v1/explorer/*` does not exist anywhere.** Zero hits for `v1/explorer` routes in any indexer, in backend-apis, or in wallet. The only string matches are backend-apis' *outbound* proxy to openstamp/stampchain (`src/external/external.controller.ts:280-284`, paths `/api/v1/explorer/src20/all` and `/api/v1/explorer/src20/holdersByTick`) — third-party URLs, not a served contract.
2. **The de-facto standardized contract is the Marketplace v1 authority surface**, not an explorer contract. Recurring routes across most Bitcoin indexers:
   - `GET /live`, `GET /ready` (200/503), `GET /status` or `GET /token-explorer/status`
   - `GET /v1/checkpoint` (only index-ordinals, index-bitmap, index-names)
   - Position source, two shapes:
     - `GET /v1/marketplace/positions/ready` + `GET /v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=` (ordinals-family authorities)
     - `GET /v1/marketplace/protocols/:protocolId/position-source/ready` + `.../position-source/outpoints/:outpoint?heightAtomic=&blockHash=` (stamps, op20, arc20, drops-and-opdrop, runes)
   - Browse: `GET /v1/marketplace/protocols/:protocolId/{assets|listings|offers|collections|activity}`
   - Shared schema id (string literal, duplicated per repo): `universe-marketplace-protocol-position-v1`, plus `universe-marketplace-composite-inventory-v1`.
3. **Shared contracts package exists but only backend-apis + wallet consume it**: `@bitcoinuniverse/ecosystem-contracts` v1.1.1 at `D:\universe\backend-apis\backend-apis\packages\ecosystem-contracts` (vendored into wallet as `wallet/vendor/bitcoinuniverse-ecosystem-contracts-1.1.1.tgz`). **No indexer imports it** — indexers duplicate schema ids as string constants and copy-paste the 26-entry `MARKETPLACE_PROTOCOL_IDS` roster (`ordinals, tap, dmt, unat, bitmap, names, dust20, stamps, src20, brc20, runes, runes_native, mezcal, alkanes, op_return, op_names, op_inscriptions, op_drop, drops, tap_doge, drc20, doginals, arc20, rare_sats, cat20, ordex`).
4. **`runes_native` ("Runes (Native)") is a first-class protocol id** across the ecosystem, and its actual adapter implementation lives in **index-runes** (dual authority: `runes` provider-family + `runes_native` protocol-native). Full reference list in the runes_native section at the bottom.
5. **Port collisions in defaults**: 3043 (index-stamps vs index-atomicals ARC20 sidecar), 3044 (index-alkanes vs index-dmt), 3042 (index-runes vs index-cat20), 3012 (index-tap vs index-witness-circles), 3220 (index-names vs index-bitmap), 3000 (index-chainbloom vs backend-apis vs bitcoin-indexer API), 3101 (index-block20; also 3001 index-opdrop vs drops-and-opdrop containers). Ops env files sometimes override (e.g. atomicals-nfts ops uses 3014, opinscriptions ops uses 3016).
6. **No indexer runs under PM2.** PM2 is only used by backend-apis (`ecosystem.config.cjs`, app name `universe`). Indexers run via bare node, Docker/compose, or systemd units.
7. **Superseded repos**: `index-drops` and `index-opdrop` are functionally superseded by `index-drops-and-opdrop` (no in-repo DEPRECATED marker; evidence: combined repo's README documents the credential rename from `OP_DROP_*` to `DROPS_OPDROP_*`, absorbs both feature surfaces including the Drops CLI/toolkit, carries newer migrations/commits; backend-apis `.env.example` points at `DROPS_OPDROP_INDEXER_URL` with the old names as commented aliases).

---

## index-ordinals — `D:\universe\index-ordinals\index-ordinals`

1. **Stack/run**: TypeScript ESM, Node 24.19.0, compiled to `dist/`; `npm start` -> `node ./dist/main.js`. Dockerfile (EXPOSE 3218, non-root). systemd units under `ops/netcup/`, PowerShell ops under `ops/powervps/`. No PM2. Default port **3218** (`.env.example`).
2. **Protocols**: Ordinals inscriptions + rare sats (`sat:<ordinal>`), fail-closed mainnet-only authority backed by local `ord` + Bitcoin Core. Also hosts the **Marketplace v1 composite collateral inventory** that aggregates position sources from every other metaprotocol (config `INDEX_ORDINALS_POSITION_SOURCES_JSON`).
3. **Routes** (`src/server.ts`, manual dispatch): `GET /live`, `/ready`, `/status`, `/v1/checkpoint`; `GET /v1/assets`, `/v1/assets/:assetId`, `/inscriptions/:page`, `/content/:inscriptionId`, `/content-status/:inscriptionId`; `GET /v1/marketplace/inventory/ready`, `GET /v1/marketplace/inventory/outpoints/:outpoint` (composite 29-protocol inventory); marketplace browse/execution under `/v1/marketplace/protocols/{ordinals|rare_sats}/...` incl. `internal/readiness`, `internal/actions` (POST); settlement: `GET /v1/marketplace/settlements/transactions/:txid`, `GET /v1/marketplace/settlements/protocol-positions/transactions/:txid`; `POST /bitcoin` (Core RPC passthrough). No block-height route, no address route.
4. **Explorer contract**: none. Nearest analogues: `/ready`, `/status`, `/v1/checkpoint`, `/v1/marketplace/inventory/outpoints/:outpoint`.
5. **DB**: SQLite via built-in `node:sqlite` (`src/store.ts`), `INDEX_ORDINALS_DATABASE_PATH`. Per-outpoint data: yes — `asset_observation.outpoint` plus marketplace tables in `src/marketplace-migrations.ts` (`marketplace_listing.source_outpoint`, `marketplace_offer.source_outpoint`, spend fences, settlement observations).
6. **Auth**: three-tier bearer (`INDEX_ORDINALS_BEARER_TOKEN` read; `X-Marketplace-Execution-Authorization` execution bearer; separate rare-sats execution bearer) + HMAC request signing for internal actions (`INDEX_ORDINALS_MARKETPLACE_HMAC_SECRET`). `/live`, `/ready` unauthenticated.
7. **runes_native**: consumed protocol id (not implemented here). `src/marketplace-inventory-types.ts:13,46`; `src/position-source-client.ts:224-225` maps `runes_native` -> prefix `/v1/marketplace/runes-native/position-source`; `README.md:173`.
8. **Shared contracts**: no package import (deps only bitcoinjs-lib + tiny-secp256k1). Local schemas: `src/marketplace-inventory-types.ts`, `src/settlement.ts`, `src/protocol-position-settlement.ts`; position-source client in `src/position-source-client.ts`.

## index-runes — `D:\universe\index-runes\index-runes`

1. **Stack/run**: plain JS ESM `.mjs`, Node 24.19.0, no build. `npm start` -> `node --env-file-if-exists=.env src/main.mjs`. No Docker, no PM2. Port **3042** (`RUNES_PORT`).
2. **Protocols**: Runes (Hiro Runes API-backed journal + normalized token-explorer feed). Two Marketplace authorities: provider-family **`runes`** and protocol-native **`runes_native`**.
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status`, `/token-explorer/runes` (bearer). Dual-prefix marketplace (`/v1/marketplace/runes` -> `runes`, `/v1/marketplace/runes-native` -> `runes_native`): `<prefix>/ready`, `<prefix>/status`, `<prefix>/position-source/ready`, `<prefix>/position-source/outpoints/:outpoint?heightAtomic=&blockHash=`, `<prefix>/outpoints/:outpoint`, `<prefix>/assets`, `<prefix>/positions?runeId=&owner=`, `<prefix>/assets/:runeId/accounts/:account`, `<prefix>/positions/:assetId[/history]`, `POST <prefix>/settlements/verify`, `POST <prefix>/offers` (always rejected). Also `GET /v1/marketplace/protocols/runes_native/internal/readiness` and `.../runes_native/{assets|listings|offers|collections|activity}`. Admin: `POST /indexer/hiro/poll`, `POST /indexer/marketplace/observe`. No block/tx routes; mempool: none (coverage declared partial).
4. **Explorer contract**: none.
5. **DB**: SQLite (`node:sqlite`, `src/database.mjs`). Per-outpoint positions: **yes** — `migrations/003_marketplace_authority.sql`: `marketplace_outputs (outpoint PK)`, `marketplace_positions (PK(outpoint, ref))`, replay tables, `marketplace_output_observations`.
6. **Auth**: bearer `RUNES_SOURCE_BEARER_TOKEN` (feed), per-authority bearers `RUNES_MARKETPLACE_RUNES_BEARER_TOKEN` / `RUNES_MARKETPLACE_RUNES_NATIVE_BEARER_TOKEN`, execution bearer via `x-marketplace-execution-authorization`, admin header `X-Indexer-Admin-Token` (`RUNES_ADMIN_TOKEN`), HMAC cursors.
7. **runes_native**: **implemented here as a separate adapter/authority.** `src/main.mjs:27` instantiates `RunesMarketplaceAuthority(store, config, 'runes_native')`; `src/marketplace/authority.mjs` (schemas `universe-runes-native-marketplace-authority-v1`, `universe-runes-native-marketplace-position-source-v1`; asset id form `<BLOCK>:<TX>@<txid>:<vout>`); `src/marketplace/identities.mjs:64`; `src/config.mjs:142-191` (`RUNES_MARKETPLACE_RUNES_NATIVE_*`, requires distinct authority IDs); docs `docs/MARKETPLACE_V1_AUTHORITY.md` §`runes_native` (route prefix `/v1/marketplace/runes-native`; `/v1/marketplace/runes_native` intentionally NOT a route).
8. **Shared contracts**: none imported (zero deps). Schema ids are local constants in `src/marketplace/authority.mjs`.

## index-stamps — `D:\universe\index-stamps\index-stamps`

1. **Stack/run**: JS ESM `.mjs`, Node 24.19.0, no Docker/PM2. `npm start` -> `node src/main.mjs`. Port **3043** (collides with index-atomicals ARC20 sidecar default).
2. **Protocols**: Bitcoin Stamps, SRC-20, SRC-101 (three sources in one process; Stampchain v2 upstream; marketplace also reads Counterparty Core + Bitcoin Core).
3. **Routes** (`src/server.mjs`): `GET /live`, `/status`, `/ready[?protocol=]`; `GET /token-explorer/{stamps|src20|src101}` (per-protocol bearer); `GET /v1/marketplace/protocols/{stamps|src20}/ready`, `.../position-source/ready`, `.../position-source/outpoints/:outpoint?heightAtomic=&blockHash=`; `GET .../stamps/assets/:assetId`, `.../src20/assets/:assetId/accounts/:account`; orders: `POST/GET /v1/marketplace/protocols/stamps/orders[...]`; offers/src20 execution always rejected. Admin `POST /indexer/stampchain/poll` etc. No block/tx routes; mempool: none (partial coverage per protocol).
4. **Explorer contract**: none.
5. **DB**: SQLite (`node:sqlite`). Per-outpoint positions: **no persisted table** — stamps/src20 use account-ledger ownership; outpoint lookups return complete-empty position sets or resolve live via Counterparty/Core (`src/marketplace/authority.mjs`).
6. **Auth**: bearer per protocol (`STAMPS|SRC20|SRC101_SOURCE_BEARER_TOKEN`) + `INDEXER_ADMIN_TOKEN` (also Bearer), HMAC cursor secrets per protocol.
7. **runes_native**: none.
8. **Shared contracts**: none; emits `universe-marketplace-protocol-position-v1` as literal; source id `index-stamps-{protocol}-account-ledger-position-source-v1` (`src/marketplace/authority.mjs:104`).

## index-atomicals — `D:\universe\index-atomicals\index-atomicals`

1. **Stack/run**: **Python** (atomicals-electrumx fork) + vendored `bitcointx` + AVM consensus lib. Runs via `run.sh` / systemd (`ops/linux/universe-atomicals-electrumx.service`, `universe-atomicals-token-explorer.service`) and Windows Task Scheduler (`ops/windows/`). ElectrumX services `tcp://0.0.0.0:50010`, `ws://:50020`, `rpc://:8000` (HTTP proxy at `/proxy`); ARC-20 token-explorer sidecar (`electrumx/token_explorer/`) on **3043**.
2. **Protocols**: Atomicals (full chain index, LevelDB) + ARC-20 sidecar; AVM readiness canaries.
3. **Routes** (sidecar, `electrumx/token_explorer/server.py` + `marketplace/service.py`): `GET /live`, `/ready`, `/token-explorer/status`, `/token-explorer/arc20` (bearer); adapter base `/v1/marketplace/protocols/arc20/`: `internal/readiness`, `position-source/ready`, `position-source/outpoints/:outpoint`, browse, `listings/:uuid`, `POST internal/actions`; application base `/api/marketplace/v1/protocols/arc20/`: status/readiness/listings/orders/offers/reservations/settlements + auth challenges + prepare/finalize/broadcast/reconcile POSTs. ElectrumX core speaks Electrum JSON-RPC (has full mempool handling internally: `electrumx/server/mempool.py`); sidecar mempool used only as rejection signal (`testmempoolaccept`).
4. **Explorer contract**: none.
5. **DB**: LevelDB (ElectrumX core) + SQLite sidecar (`ARC20_DATABASE_PATH`, `electrumx/token_explorer/store.py`, migrations 001-004). No persisted per-outpoint position table — resolved live against the ElectrumX proxy.
6. **Auth**: sidecar bearer `ARC20_SOURCE_BEARER_TOKEN`, admin header `X-Indexer-Admin-Token`, marketplace signed auth challenges/sessions + nonces + idempotency keys; ElectrumX has cost-based rate limiting.
7. **runes_native**: none.
8. **Shared contracts**: none; local schemas under `electrumx/token_explorer/`; docs `docs/arc20-token-explorer.rst`, `docs/arc20-marketplace-v1.rst`.

## index-atomicals-nfts-and-realms — `D:\universe\index-atomicals-nfts-and-realms\index-atomicals-nfts-and-realms`

1. **Stack/run**: JS ESM `.mjs`, Node 24.19.0. Docker (EXPOSE **3003**, healthcheck `/live`) + systemd units in `ops/linux/` (ops env uses port 3014). No PM2.
2. **Protocols**: Atomicals NFTs, Realms, Subrealms — materialized SQLite projection over an Atomicals ElectrumX HTTP proxy (generation/refresh model). Replaces former `index-atomicals-nfts` and `index-atomicals-realms` services.
3. **Routes** (`src/server.mjs`): `GET /live`, `/version`, `/health`, `/ready`, `/metrics`, `/token-explorer/status`, `/token-explorer/{atomicals|realms}` (bearer); status: `GET /v1/atomicals/index/status` (+ `-nfts`/`-realms` aliases), `/v1/atomicals/index/events`; admin POST refresh/rollback. Assets: `GET /v1/{atomicals|atomicals-nfts|atomicals-realms}/assets` (filters `q,address,ownerScript,realm,parent,txid,utxo,block,type,kind,cursor,limit`), `/assets/:atomicalId[/history|/metadata|/holders]`, media route. Realms: `resolve`, `hierarchy`, `subrealms`. **Chain-shaped queries**: `GET /v1/atomicals/transactions/:txid`, `GET /v1/atomicals/blocks/:height`, `GET /v1/atomicals/utxos/:txid/:vout`. No mempool at all.
4. **Explorer contract**: none, but closest structural match (block/tx/utxo routes exist; no checkpoint route — `generationId` header instead; no `addresses/:address/positions`).
5. **DB**: SQLite (`node:sqlite`, schema in code `src/database.mjs`; FTS5). No dedicated outpoint position table (projection queried by utxo/txid/block snapshots).
6. **Auth**: read surface unauthenticated; bearer only on `/token-explorer/{atomicals|realms}`; admin token for refresh/rollback; HMAC cursors.
7. **runes_native**: none.
8. **Shared contracts**: none. `PROTOCOL-PROVENANCE.json` records provenance locally.

## index-brc20 — `D:\universe\index-brc20\index-brc20`

1. **Stack/run**: JS ESM `.mjs`, Node 24.19.0, zero runtime deps. Dockerfile (EXPOSE **3041**, healthcheck `/live`). `npm start` -> `src/main.mjs`. No PM2.
2. **Protocols**: BRC-20 (canonical decoded ops pushed by external decoder `BRC20_CANONICAL_DECODER_SOURCE_ID`; optional UniSat metadata supplement, default-off).
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status`, `/token-explorer/brc20` (bearer); `GET /v1/marketplace/positions/ready`, `GET /v1/marketplace/positions/outpoints/:outpoint` (line 50); `GET /v1/marketplace/authority/status`, `/authority/assets`, `/authority/assets/:assetId/accounts/:account`, `/authority/transferables[...]`; `POST /v1/marketplace/authority/settlements/verify`, `POST .../offers`; ingest `POST /indexer/operations`, `POST /indexer/unisat/poll`. No block/tx/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite (`node:sqlite`). Per-outpoint: partial — `marketplace_transferables` keyed by `location_txid`/`location_vout` (`migrations/003_marketplace_authority.sql:36,63`); balances account-keyed.
6. **Auth**: bearer `BRC20_SOURCE_BEARER_TOKEN` (feed) + `BRC20_MARKETPLACE_BEARER_TOKEN` (authority) + admin header `x-indexer-admin-token`; HMAC cursors.
7. **runes_native**: **absent** — the only Marketplace-authority indexer missing it from its protocol-id list (divergence risk vs the 26-id roster).
8. **Shared contracts**: none; emits `universe-marketplace-protocol-position-v1` literal.

## index-alkanes — `D:\universe\index-alkanes\index-alkanes`

1. **Stack/run**: JS ESM `.mjs`, Node 24.19.0, dep `pg`. `npm start` -> `src/main.mjs`. No Docker/PM2. Port **3044** (collides with index-dmt).
2. **Protocols**: Alkanes — reads the PostgreSQL trace projection of `kungfuflex/alkanes-rs` (`TraceBalanceUtxo`), verifies against Bitcoin Core; ESPO RPC for height/metadata.
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status`, `/token-explorer/alkanes`; `GET /v1/marketplace/positions/ready`, `GET /v1/marketplace/positions/outpoints/:outpoint`; `/v1/marketplace/protocols/alkanes/`: `internal/readiness`, browse; `/v1/marketplace/alkanes/`: `ready`, `positions/ready`, `status`, `positions[...]`, `outpoints/:outpoint`, `assets/:assetId`, `POST offers`; admin polls. No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite local store; Postgres is upstream-only. Per-outpoint: **yes** — `migrations/003_marketplace_authority.sql`: `marketplace_outpoints (outpoint PK)`, `marketplace_positions (PK(outpoint, token_id))`, plus `alkane_utxos` in 001.
6. **Auth**: bearer (source + marketplace + execution header + admin header); marketplace enable is fail-closed with pinned revisions (`ALKANES_MARKETPLACE_PROTOCOL_REVISION`, `PRODUCER_REVISION`).
7. **runes_native**: consumed id — `src/marketplace/inventory.mjs:8` (frozen protocol list) and `:191` (`protocolId === 'runes' || protocolId === 'runes_native'` coverage counting).
8. **Shared contracts**: none; source id `index-alkanes-canonical-replay-position-source-v1`.

## index-tap — `D:\universe\index-tap\index-tap`

1. **Stack/run**: TypeScript ESM -> `dist/`; `npm start` -> `node dist/main.js`. Dockerfile (EXPOSE 3012). Port **3012** (collides with index-witness-circles). No PM2. Note: committed `node_modules/` + `dist/`.
2. **Protocols**: TAP (Bitcoin mainnet), sourced from the authenticated Universe ord-tap writer (pinned ord-1.0.5 / commit b8f6ea35...). DMT rows are consumed but delegated to index-dmt.
3. **Routes** (`src/server.ts`): `GET /live`, `/ready` (public), `/status` (bearer), `/v1/ready` (bearer, marketplace authority readiness); `GET /v1/marketplace/positions/ready`, `GET /v1/marketplace/positions/outpoints/:outpoint`; `/v1/marketplace/protocols/tap/`: `internal/readiness`, `POST internal/actions` (dual token), browse `{assets|listings|offers|collections|activity}`, `listings/:id`, `reservations/:id`; `GET /v1/assets/:inscriptionId`; `GET /token-explorer/tap`. No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite (`src/database.ts`). Positions computed live from Ord output + Core txOut (`src/marketplace-authority.ts:524-668`), not persisted; marketplace execution tables created at runtime (`src/marketplace-execution-migrations.ts`: `marketplace_listing.source_outpoint`, `marketplace_offer.source_outpoint`, spend fences).
6. **Auth**: bearer `TOKEN_EXPLORER_BEARER_TOKEN` for authorized GETs, execution header `x-marketplace-execution-authorization`, HMAC cursors.
7. **runes_native**: consumed id — `src/marketplace-authority.ts:61` (protocol-id list).
8. **Shared contracts**: none; literals `universe-marketplace-protocol-position-v1` / `universe-marketplace-composite-inventory-v1`. Marketplace v1 talks to inventory origin `MARKETPLACE_V1_INVENTORY_ORIGIN` (index-ordinals composite, default :3219).

## index-dmt — `D:\universe\index-dmt\index-dmt`

1. **Stack/run**: JS ESM `.mjs`, Node 24.19.0; deps bitcoinjs-lib, socket.io-client. `npm start` -> `src/main.mjs`. No Docker/PM2. Port **3044** (collides with index-alkanes).
2. **Protocols**: DMT (Digital Matter Theory), production input = ord-tap writer + Bitcoin Core; legacy Blockpad/Trac rollback mode.
3. **Routes** (`src/server.mjs`): `GET /live`, `/status`, `/ready`; `GET /dmt/collections`, `/dmt/collections/:collectionId/items`; `GET /v1/marketplace/ready`, `/v1/marketplace/positions/ready`, `/v1/marketplace/positions/outpoints/:outpoint`; `/v1/marketplace/protocols/dmt/`: `internal/readiness`, `POST internal/actions`, browse, `listings/:id`, `reservations/:id`; `GET /v1/marketplace/assets/:assetId`; `GET /token-explorer/dmt`; admin `POST /indexer/dmt/poll`. No block/tx/address routes; mempool: unavailable from canonical providers (partial).
4. **Explorer contract**: none.
5. **DB**: SQLite; `migrations/003_marketplace_authority.sql` carries `outpoint` column on evidence table (partial per-outpoint).
6. **Auth**: bearer only — source, marketplace authority, execution (`x-marketplace-execution-authorization`), admin bearers all distinct.
7. **runes_native**: consumed id — `src/marketplace-authority.mjs:33`; README.md:219 lists "native Runes" as a distinct required protocolCoverage row from the external composite inventory.
8. **Shared contracts**: none; literals only. Talks to `ORDINALS_AUTHORITY_BASE_URL` (:3045 in env example) and `DMT_MARKETPLACE_COLLATERAL_INVENTORY_BASE_URL` (:3046).

## index-dust20 — `D:\universe\index-dust20\index-dust20`

1. **Stack/run**: JS ESM `.mjs`, zero deps, Node 24.19.0. `npm start` -> `src/main.mjs`. No Docker/PM2. Port **3102**.
2. **Protocols**: DUST-20 (inscribed deploy/mint; UTXO-flow transfers reconstructed via ordinal FIFO sat tracking). Upstreams: shared Ord 0.29 (`DUST20_ORD_ORIGIN` :8380) + Bitcoin Core verbosity-3.
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status`, `/token-explorer/dust20`; `/v1/marketplace/protocols/dust20/`: `internal/actions` (POST), `internal/execution-readiness`, `internal/readiness`, browse; `GET /v1/marketplace/positions/ready`, `/v1/marketplace/positions/outpoints/:outpoint`; `GET /v1/marketplace/authority/ready`, `/v1/marketplace/authority/assets/:assetId`; legacy unauthenticated `GET /dust20/indexer`, `/dust20/checkTicker`, `/dust20/detail/ticker`, `/dust20/indexer/tick`; admin polls. No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite. Per-outpoint: **yes** — `dust20_allocations` (+ `idx_dust20_allocations_unspent_outpoint`, `spent_by_txid`), `dust20_transition_outputs` with outpoint index.
6. **Auth**: bearer source/authority/execution + admin header; legacy `/dust20/*` routes unauthenticated.
7. **runes_native**: consumed id — `src/marketplace-composite-inventory.mjs:66`.
8. **Shared contracts**: none; literals incl. `universe-dust20-marketplace-authority-v1`.

## index-op20 — `D:\universe\index-op20\index-op20`

1. **Stack/run**: JS ESM `.mjs`; deps bitcoinjs-lib + mysql2. Dockerfile (EXPOSE **3045**, healthcheck `/live`). `npm start` -> `src/main.mjs`. No PM2.
2. **Protocols**: OP-20 (protocol id `op_return`) + separate **OP Names** (`op_names`, gated off by default). Sources: canonical OP-20 MySQL (`tap_wallets` schema, repeatable-read RO snapshots), Bitcoin Core, Esplora outspends (mempool.space API), Bitcoin Universe V4 API oracle.
3. **Routes** (`src/server.mjs`): `GET /live`, `/status`, `/ready` (public); `GET /token-explorer/op20` (bearer); `GET /v1/marketplace/protocols/op_return/ready`; `GET /v1/marketplace/protocols/(op_return|op_names)/internal/readiness` (dual bearers), browse `{assets|listings|offers|collections|activity}`, `position-source/ready`, `position-source/outpoints/:outpoint?heightAtomic=&blockHash=`; `GET .../op_return/assets/:assetId/accounts/:account`; `GET .../op_names/ready`, `.../op_names/assets/:assetId`; admin `POST /indexer/op20/poll`, `/indexer/op_names/poll`. No block/tx/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite projection + MySQL (upstream RO for OP-20; writable OP Names authority store, `migrations/mysql/001_op_names_authority.sql`). Per-outpoint: OP Names yes (`op_names_assets.current_txid/current_vout` with outpoint index); OP-20 account-ledger (empty position sets; source `index-op20-account-ledger-position-source-v1`).
6. **Auth**: bearers `OP20_SOURCE_BEARER_TOKEN`, `OP_NAMES_SOURCE_BEARER_TOKEN`, `INDEXER_ADMIN_TOKEN`, execution bearers via `X-Marketplace-Execution-Authorization`.
7. **runes_native**: none.
8. **Shared contracts**: none; sources `index-op20-account-ledger-position-source-v1`, `index-op20-op-names-utxo-position-source-v1`.

## index-opinscriptions — `D:\universe\index-opinscriptions\index-opinscriptions`

1. **Stack/run**: TypeScript; NestJS deps but runtime is raw `node:http` (`dist/indexer/main.js`; no NestFactory call — the Nest module `src/op-inscriptions/` is a legacy compatibility surface, unmounted). Dockerfile (EXPOSE 3000 9091 9092) + systemd `ops/systemd/universe-op-inscriptions-indexer.service` (+ mempool/verifier SSH tunnels). Three listeners: probe **9091** (`/live /ready /metrics`), canonical read API **3000** (ops env 3016), marketplace authority **9092**. No PM2.
2. **Protocols**: OP Inscriptions (`op_inscriptions`), canonical OP_RETURN inscription indexer extracted from universe-backend; dual-provider verification (mempool API + independent verifier / private Core checkpoint authority).
3. **Routes**: probe: `GET /live`, `/ready`, `/metrics`. Read API (`src/indexer/canonical-read.server.ts`, GET/HEAD, no auth): `GET /live`, `/ready` (alias `/api/op-inscriptions/health`), `GET /api/op-inscriptions/inscriptions[
/random]` (+ underscore aliases). Marketplace (`src/marketplace/marketplace-http.server.ts`, bearer): `GET /v1/marketplace/positions/ready`, `GET /v1/marketplace/authority/status`, `GET /v1/marketplace/authority/assets[/:assetId[/history]]`, `GET /v1/marketplace/positions/outpoints/:txid::vout` (line 537), `POST /v1/marketplace/authority/settlements/verify`, `POST .../actions/observe` & `.../offers` (fail 409 by design). Mempool: source-level only (`src/indexer/mempool-chain.source.ts`), no HTTP route.
4. **Explorer contract**: none.
5. **DB**: **MySQL** (`OPI_DATABASE_URL`); migrations `001_canonical_indexer.sql`, `002_marketplace_v1_authority.sql` (assets keyed by `current_txid/current_vout`, unique receipt), `003_canonical_read_api.sql`. Per-outpoint: yes.
6. **Auth**: marketplace bearer `OPI_MARKETPLACE_AUTHORITY_BEARER_TOKEN` (every marketplace route); read API/probe unauthenticated (loopback-bound, reverse-proxy policy); decoder bearer in external mode; HMAC cursors.
7. **runes_native**: none.
8. **Shared contracts**: none; local constants `OP_INSCRIPTIONS_MARKETPLACE_POSITION_SCHEMA` etc. in `src/common/constants.ts`.

## index-drops-and-opdrop — `D:\universe\index-drops-and-opdrop\index-drops-and-opdrop`

1. **Stack/run**: TypeScript + NestJS 11 + TypeORM. Dockerfile (EXPOSE 3001) + `compose.yml` (host bind `${DROPS_OPDROP_BIND_PORT:-3015}:3001`, MySQL 8.4 + Redis) + systemd `ops/linux/universe-drops-opdrop.service`. Roles: `SERVICE_ROLE=all|api|scanner` (advisory-lock single writer). CLI `drops` + library exports (`./drops`, `./drops/client`, `./drops/protocol`, `./drops/pacts`). No PM2. **The canonical route list is committed at `api-list.txt` (110 routes).**
2. **Protocols**: op-drop (BIP-110 `$DROP` fungible tokens + trading desk) and Drops (inscription/artifact indexer + `/drops` HTML gallery) over one confirmed-chain scan.
3. **Routes** (see `api-list.txt`): health `GET /live|/health|/ready|/version|/metrics` (+ `/op-drop/*` aliases), `GET /drops/health`, `/drops/status`; op-drop data: tokens, `balances/:address`, transfers, events, `provisional` (+ `POST provisional/track` — pending/mempool lifecycle `mempool -> M of N -> finalized`), `indexer/status|scan|replay`; trading `POST /op-drop/trading/listings[...]` with authorization payloads; token-explorer feeds `GET /{op-drop|drops}/token-explorer[ /status]` (bearer); Marketplace v1 mounted under BOTH `op-drop/marketplace/v1` and `drops/marketplace/v1` (ready, status, assets, positions[...], `chain/prevouts/:txid/:vout`, listings/offers/intents/actions/history); **generic position source**: `GET /v1/marketplace/protocols/:protocolId/position-source/ready` and `.../position-source/outpoints/:outpoint?heightAtomic=&blockHash=` (`src/marketplace/marketplace-v1-authority.controller.ts:724,738`), protocols `op_drop` and `drops`; custody admin `/drops-and-opdrop/drops/custody/admin/*`; `GET /openapi.json`, `/docs`.
4. **Explorer contract**: none (`/token-explorer/*` is a feed contract, different shape).
5. **DB**: MySQL 8.4 (TypeORM); Redis for rate limiting. Per-outpoint: **yes** — `marketplace_v1_tracked_positions` (idx protocol,txid,vout), `drops_marketplace_listings` (unique outpoint), spend fences, outpoint-keyed custody tables; op-drop transfers unique on `(network, anchorTxid, anchorVout)`.
6. **Auth**: per-protocol bearer tokens (`OP_DROP_MARKETPLACE_V1_BEARER_TOKEN`, `DROPS_MARKETPLACE_V1_BEARER_TOKEN` + execution + inventory bearers), token-explorer bearer, service token `DROPS_OPDROP_INDEXER_SERVICE_TOKEN` (trusted-backend bucket), admin/ingest tokens, BIP322 signatures for trading writes, Redis rate limiting.
7. **runes_native**: consumed id — `src/drops/drops-output-inventory.client.ts:26` in the 26-id `COMPLETE_MARKETPLACE_PROTOCOL_IDS` allowlist for the index-ordinals composite output-inventory client.
8. **Shared contracts**: none imported; local `src/marketplace/marketplace-v1.route.ts`, contract specs `src/marketplace/marketplace-v1.contract.spec.ts`.

## index-unat — `D:\universe\index-unat\index-unat`

1. **Stack/run**: JS ESM `.mjs`; deps @noble/curves, bitcoinjs-lib, mysql2, re2-wasm, unicode-segmenter. Dockerfile (EXPOSE **3217**). `npm start` -> `src/main.mjs`; canonical seed via `scripts/seed-canonical.mjs`. No PM2.
2. **Protocols**: UNAT (fail-closed Marketplace v1 authority + position source; canonical MySQL seed -> incremental Ord/Core replay -> dynamic position proof; TAP writer mirror attestation).
3. **Routes** (`src/server.mjs`): `GET /live`, `/status`, `/ready` (public); `GET /unat/collections[...]` (marketplace bearer); `POST /indexer/unat/poll`, `GET /v1/internal/replay/status` (admin); `GET /v1/marketplace/ready`; `GET /v1/marketplace/protocols/unat/internal/readiness` (dual bearer), browse, `listings/:id`, `reservations/:id`, `POST internal/actions`; `GET /v1/marketplace/positions/ready`, `GET /v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=`; `GET /v1/marketplace/assets/:assetId`. No block/tx/address/mempool routes.
4. **Explorer contract**: none ("explorer" absent from repo).
5. **DB**: SQLite x2 (canonical + marketplace execution journal); MySQL only as one-shot RO seed source. Per-outpoint: yes — `unat_tick_claims.current_outpoint`, `marketplace_evidence.outpoint` (`migrations/001_initial.sql:146,257`).
6. **Auth**: bearers — `UNAT_MARKETPLACE_BEARER_TOKEN`, execution via `X-Marketplace-Execution-Authorization`, `UNAT_ADMIN_BEARER_TOKEN`; outbound bearers for ordinals authority/collateral inventory/TAP writer export.
7. **runes_native**: consumed id — `src/clients.mjs:12` (26-id list for composite/collateral inventory client validation).
8. **Shared contracts**: none; source ids like `index-unat-complete-position-source-v1` (`src/authority.mjs:247`).

## index-bitmap — `D:\universe\index-bitmap\index-bitmap`

1. **Stack/run**: JS ESM `.mjs`, leanest repo (no Docker, no .env.example, no ops). `npm start` -> `node ./src/main.mjs`. Port **3220** (`BITMAP_PORT` default; collides with index-names). No PM2.
2. **Protocols**: Bitmap districts (`{height}.bitmap`, activation 767430, OPI-pinned rules; parcels rejected). Evidence: Ord + Bitcoin Core + index-ordinals composite inventory.
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready` (unauthenticated); bearer: `GET /v1/checkpoint`, `/v1/indexer/progress`, `/v1/marketplace/assets/:inscriptionId`, `/v1/marketplace/positions/ready`, `/v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=`, `/v1/marketplace/protocols/bitmap/` browse + `internal/readiness` + `POST internal/actions` (dual bearer). Rate limited (`BITMAP_RATE_LIMIT_PER_MINUTE`). No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite x2 (canonical `migrations/001_bitmap_authority.sql`: `bitmap_blocks/candidates/claims/authority_state`; marketplace execution journal). No persisted outpoint column — positions computed live (Ord satpoint + Core gettxout + composite inventory).
6. **Auth**: bearer `BITMAP_AUTHORITY_BEARER_TOKEN` on all `/v1/*`; execution bearer header; outbound `BITMAP_ORDINALS_COMPOSITE_BEARER_TOKEN`.
7. **runes_native**: consumed id — `src/authority.mjs:33` (26-id list; context: `POSITION_SCHEMA='universe-marketplace-protocol-position-v1'`, `COMPOSITE_INVENTORY_SOURCE='index-ordinals-composite-inventory-v1'`).
8. **Shared contracts**: none; inline constants `src/authority.mjs:15-20`.

## index-names — `D:\universe\index-names\index-names`

1. **Stack/run**: JS ESM `.mjs`; deps bitcoinjs-lib, json5, tiny-secp256k1. `npm start` -> `node ./src/main.mjs`. No Docker/PM2/.env.example. Port **3220** default (`NAMES_PORT`; collides with index-bitmap).
2. **Protocols**: Sats Names System (SNS) — Ordinals-based `names` protocol (OPI-pinned first-write rules), fail-closed authority (`NAMES_MARKETPLACE_V1_AUTHORITY_ENABLED`).
3. **Routes** (`src/server.mjs`): `GET /live` (open); bearer: `GET /ready`, `/v1/indexer/progress`, `/v1/checkpoint`, `/v1/marketplace/positions/ready`, `/v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=`, `/v1/marketplace/assets/:inscriptionId`; execution mode adds `/v1/marketplace/protocols/names/` internal readiness/actions + browse + listings/reservations. No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite (`node:sqlite`), `migrations/001_names_authority.sql` (`names_blocks/candidates/claims/namespace_claims/authority_state`); no outpoint column — positions resolved live vs ord + Core; separate marketplace DB path.
6. **Auth**: bearer `NAMES_AUTHORITY_BEARER_TOKEN` + execution bearer header; rate limiting.
7. **runes_native**: consumed id — `src/authority.mjs:24` (26-id `MARKETPLACE_PROTOCOL_IDS`); test mirror `test/fixtures.mjs:20`.
8. **Shared contracts**: none; schema id literals `universe-marketplace-protocol-position-v1`, `index-names-position-inventory-v1` (`src/authority.mjs:19-20`).

## index-block20 — `D:\universe\index-block20\index-block20`

1. **Stack/run**: JS ESM `.mjs`; dep `pg` (legacy Hiro adapter only). `npm start` -> `src/main.mjs`; separate `npm run start:rpc-proxy` (`src/bitcoin-rpc-proxy.mjs`, default 8333 -> upstream 8332). No Docker/PM2. Port **3101**.
2. **Protocols**: BLOCK-20 (Ordinals-inscription token protocol; ord adapter at :8380 + Bitcoin Core; mutually-exclusive legacy Hiro Postgres adapter).
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status` (open); `GET /token-explorer/block20` (bearer); legacy `GET /block20/indexer` (open); admin `POST /indexer/operations`, `/indexer/{source|hiro|ord}/poll`. **No marketplace/position-source surface at all.** No block/tx/outpoint/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite; tables incl. `block20_transfer_intents`, `block20_ord_locations` (inscription-id keyed). **No outpoint column anywhere** — no per-outpoint positions.
6. **Auth**: bearer `BLOCK20_SOURCE_BEARER_TOKEN` (feed only) + admin header `X-Indexer-Admin-Token`; HMAC cursors.
7. **runes_native**: none.
8. **Shared contracts**: none; `scripts/check-inscribe-contract.mjs` validates its own feed shape.

## index-mezcal — `D:\universe\index-mezcal\index-mezcal`

1. **Stack/run**: TypeScript ESM -> `dist/`; deps @cmdcode/tapscript, pg. Dockerfile (EXPOSE **3014**, healthcheck `/live`). `npm start` -> `node dist/main.js`. No PM2.
2. **Protocols**: Mezcal (native token protocol). Mirrors canonical bitapeslabs Mezcal Postgres (pinned schema `bitapeslabs-mezcal-postgres-v1`, revision-pinned) + Bitcoin Core verification.
3. **Routes** (`src/server.ts`): `GET /live`, `/ready` (open); `GET /status`, `/token-explorer/mezcal` (bearer); `GET /v1/marketplace/positions/ready`, `/v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=` (marketplace bearer, schema `universe-marketplace-protocol-position-v1`); `/v1/marketplace/protocols/mezcal/`: `internal/readiness`, browse; `/v1/marketplace/mezcal/`: `ready`, `status`, `assets`, `positions?tokenId=&owner=`; all write verbs recognized and rejected as unsupported. No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite local (pg is upstream-only). Per-outpoint: **yes** — `migrations/004_marketplace_v1_authority.sql`: `marketplace_positions (UNIQUE(outpoint, token_id))`, snapshot positions, append-only observations (update/delete triggers ABORT), checkpoint tables scoped `mezcal-utxo-positions`.
6. **Auth**: bearer x3 (`TOKEN_EXPLORER_BEARER_TOKEN`, `MEZCAL_MARKETPLACE_BEARER_TOKEN`, execution bearer header); fail-closed enable flag.
7. **runes_native**: **strong reference** — `contracts/universe-marketplace-native-token-v1.json:4` `"protocolIds": ["runes_native", "mezcal", "alkanes"]` (first-class shared native-token contract: consumerClass `MezcalMarketplaceV1AssetResolver`, 16 `protocolOutpointFields`), duplicated in `scripts/check-marketplace-contract.mjs:34` and enforced by `npm run verify`.
8. **Shared contracts**: vendored local JSON contract (above) + literals; source `index-mezcal-canonical-utxo-position-source-v1` (`src/marketplace.ts:375`).

## index-chainbloom — `D:\universe\index-chainbloom\index-chainbloom`

1. **Stack/run**: TypeScript + NestJS 11 + TypeORM + Socket.IO + ZeroMQ + prom-client. Dockerfile (EXPOSE 3000) + hardened `docker-compose.yml` (pinned mysql:8.4, config-check + migrate one-shots). Port **3000** loopback (`CHAINBLOOM_BIND_*`). Swagger `/docs`, `/docs-json`; generated client in `generated/`. No PM2 (systemd wrapper mentioned in docs/operations.md). backend-apis expects it at `CHAINBLOOM_INDEXER_URL=http://127.0.0.1:3011`.
2. **Protocols**: ChainBloom CBLM v1 (fixed-root UTXO relay; worlds/lanes/events), direct Bitcoin Core RPC + ZMQ, provisional mempool ingest, single-leader lease.
3. **Routes**: `GET /health`, `/ready`, `/metrics`; `/v1/chainbloom/`: `status`, `worlds[...]` (events/graph/lanes), `lanes`, **`lanes/by-outpoint/:txid/:vout`**, `lanes/:worldId/:laneNo`, `scripts/:scriptHash/holdings`, **`address/:address/holdings`**, `events`, **`events/:txid`**, `graph`, `render/:worldId[/svg]`, `fees`, `search`, `stats`, **`mempool`**; admin POST `sync|verify|repair|reindex`; WS namespace `/chainbloom` (block/event/mempool/replacement/reorg). No block-by-height route.
4. **Explorer contract**: none (richest explorer-shaped surface, but under `/v1/chainbloom/*`).
5. **DB**: **MySQL 8.4** (TypeORM migrations in `src/database/migrations/`). Per-outpoint: yes — `lanes.current_carrier_txid/vout` UNIQUE, `transaction_inputs/outputs`, `mempool_inputs.outpoint`.
6. **Auth**: public reads unauthenticated (rate limits + CORS allowlist + Helmet); admin via `X-Api-Key` or `Authorization: Bearer` vs `ADMIN_API_KEYS` (503 fail-closed if unset).
7. **runes_native**: none.
8. **Shared contracts**: none; local `src/api/status-contract.ts`; `SOURCE-PROVENANCE.json` + pinned `CHAINBLOOM_SOURCE_REVISION`. Protocol parser behind `src/protocol/index.ts` awaiting future `@bitcoin-universe/chainbloom` package.

## index-patina — `D:\universe\index-patina\index-patina`

1. **Stack/run**: TypeScript ESM; CLI bin `index-patina` (`serve`/`sync`). Dockerfile + compose (EXPOSE **4180**; optional regtest Core service). Deps: better-sqlite3 + vendored `@bitcoinuniverse/patina` 1.1.0 tarball (SHA-pinned via `SOURCE-PROVENANCE.json`, `scripts/verify-vendor.mjs`). Mainnet fail-closed (`PATINA_MAINNET_AUTHORIZED` + 2-approver deployment record). backend-apis expects `PATINA_INDEXER_URL=http://127.0.0.1:3013` (differs from repo default 4180).
2. **Protocols**: PATINA (Bitcoin artifact/carrier protocol; commit-reveal, rings, epochs/census, ALIVE/RELIC lifecycle). Core RPC (txindex=1) incl. mempool overlay.
3. **Routes** (`src/api.ts`, base `/patina`): `GET /patina/status`, `/window`, `/artifacts[?status=&address=]`, `/artifacts/:id[/card]`, **`/addresses/:address/holdings`**, **`/carriers/:txid/:vout`** (outpoint), `/census/current`, `/census/:epoch`, `/museum`, `/leaderboard`, `/shatter`, `/invalid-events`, `/stats`, **`/mempool`**, **`POST /patina/safety/outpoints`** (batch, <=500); `GET /health`, `/ready`, `/metrics` (bare + prefixed); `/openapi.json`. No block-by-height or tx-by-txid routes.
4. **Explorer contract**: none (closest in shape; prefix `/patina`, forms differ).
5. **DB**: SQLite via **better-sqlite3** (only repo not on `node:sqlite`); code-defined schema `src/migrations.ts`. Per-outpoint: **yes** — `carriers (PK(txid,vout))` + `carrier_artifacts (PK(carrier_txid,carrier_vout,artifact_id))`; `checkpoints`, `block_undo`, mempool tables.
6. **Auth**: **none** (fully public read API; rate limiting 120/min, loopback bind, optional single CORS origin).
7. **runes_native**: none.
8. **Shared contracts**: imports vendored `@bitcoinuniverse/patina` (protocol spec package — not an ecosystem contracts package; no position-source/checkpoint/settlement schemas).

## index-witness-circles — `D:\universe\index-witness-circles\index-witness-circles`

1. **Stack/run**: TypeScript + NestJS 11 + TypeORM + Socket.IO. Dockerfile (EXPOSE **3012**) + docker-compose (mysql:8.4 + migrate one-shot). Port 3012 (collides with index-tap default). Swagger `/docs`. No PM2. backend-apis: `WITNESS_INDEXER_URL=http://127.0.0.1:3012`.
2. **Protocols**: Witness Circles `WITC` (42-byte OP_RETURN PUSH40 marker; CIRCLE only). Bitcoin Core RPC + ZMQ; provisional mempool state.
3. **Routes**: `GET /health`, `/ready`, `/metrics`; `/v1/witness/`: `status`, `circles[/:txid]`, **`transactions/:txid`**, `lineages[...]`, **`shards/:txid/:vout`** (outpoint), **`POST safety/outpoints`**, **`addresses/:address/holdings`**, `addresses/:address/activity`, **`mempool[/:txid]`**, `graph`, `invalid-events`, `search`, `trending`, `stats`, `fees`, `POST validate`; admin POST `sync|verify|verify-core|repair|reindex[-range]`; WS gateway. No block-by-height route.
4. **Explorer contract**: none.
5. **DB**: MySQL 8 (entities `src/database/entities.ts`); per-outpoint: `wc_shards PK(txid, vout)` (no fungible amounts — protocol has no token model).
6. **Auth**: public reads unauthenticated (throttler + CORS); admin bearer (`ADMIN_API_KEYS`, digest + timingSafeEqual).
7. **runes_native**: none.
8. **Shared contracts**: none.

## index-tandem — `D:\universe\index-tandem\index-tandem`

1. **Stack/run**: TypeScript ESM + NestJS 11 + TypeORM; Biome/Vitest; docs site under `site/`. Dockerfile (EXPOSE **3021**) + compose.yaml. Vendored `@bitcoinuniverse/tandem` 0.1.0 tarball. backend-apis: `TANDEM_INDEXER_URL=http://127.0.0.1:3021` (commented out by default). No PM2.
2. **Protocols**: Tandem pipeline A (2-of-2 shared 20,000-sat Bitcoin object; chapters/key rotations); cross-checked against external pipeline B (`PIPELINE_B_BASE_URL`) with signed agreement tuples; mainnet gated by `TANDEM_VERIFIED_MAINNET_ENABLED`.
3. **Routes**: `GET /health`, `/ready`, `/metrics`; `/tandem/`: `status`, `readiness`, `objects/:objectKey`, **`carriers/:txid/:vout`** (outpoint), `events/:txid`, `invalid-events`, `reorgs`, `stats`, `agreement/:height`; `/tandem/verified/`: `status`, `objects[/:key]`, `events/:txid`, **`transactions/:txid`**, **`addresses/:address`**, **`mempool`**, `invalid-events`, `conflicts`, `reorgs`, `stats`, `search` (served only while both pipelines agree). No block-by-height route.
4. **Explorer contract**: none ("Verified explorer" appears only as prose in openapi summaries).
5. **DB**: MySQL (TypeORM). Per-outpoint: `tandem_carriers (PK outpoint varchar(73))` -> 1 outpoint = 1 object; `tandem_mempool`, `tandem_checkpoints`.
6. **Auth**: **none** on HTTP API (helmet only; documented as a mainnet gate item); agreement signing keys are for cross-pipeline signatures, not API auth.
7. **runes_native**: none.
8. **Shared contracts**: none (vendored protocol tarball only).

## index-cat20 — `D:\universe\index-cat20\index-cat20`

1. **Stack/run**: JS ESM `.mjs`; dep `pg`. Dockerfile (EXPOSE **3042** — collides with index-runes; healthcheck `/live`). `npm start` -> `src/main.mjs`. No PM2.
2. **Protocols**: CAT-20 on **Fractal Bitcoin** (`fractal-mainnet`); polls the canonical `CATProtocol/cat-token-box` tracker Postgres.
3. **Routes** (`src/server.mjs`): `GET /live`, `/ready`, `/token-explorer/status` (open); `GET /token-explorer/cat20` (bearer); `/v1/marketplace/protocols/cat20/`: `internal/readiness` (dual bearer), browse `{assets|listings|offers|collections|activity}` (fractal-testnet only via `CAT20_MARKETPLACE_BROWSE_ENABLED`); admin `POST /indexer/operations`, `/indexer/cat-tracker/poll`. **No position-source/outpoint routes.** No block/tx/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite local (pg upstream-only). No per-outpoint positions (address-keyed `holders PK(tick,address)`).
6. **Auth**: bearer `CAT20_SOURCE_BEARER_TOKEN` + admin header `x-indexer-admin-token` + execution bearer header; HMAC cursors.
7. **runes_native**: none.
8. **Shared contracts**: none.

## index-doge-tap — `D:\universe\index-doge-tap\index-doge-tap`

1. **Stack/run**: TypeScript ESM -> dist; deps trac-tap-reader 0.13.49-beta (Hypercore/Hyperbee) + tiny-secp256k1; `dependencies:prepare` (esbuild rebuild + patch-package) required before start. Dockerfile (EXPOSE **3013**). Optional TLS. No PM2.
2. **Protocols**: Dogecoin TAP (`doge-tap`, `dogecoin-mainnet`, pinned channel/reader identity). Feature-flagged Dogecoin Marketplace v1 subsystem (DRC-20/Doginals/TAP-Doge authority builders) — all off in `.env.example`.
3. **Routes** (`src/server.ts`): `GET /live`, `/ready` (open); `GET /status`, `/token-explorer/doge-tap` (bearer); `GET /reader/:method[...]` (legacy gateway, IP-allowlisted, off by default); `GET /v1/marketplace/checkpoint?protocol=&network=dogecoin-mainnet`; marketplace public `/marketplace/v1/...` (listings/assets/offers/intents/settlements/auth challenges) and internal `/v1/marketplace/protocols/:protocol/internal/{actions,funding,wallet,readiness,reservations}`. No block/tx/outpoint/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: SQLite (`node:sqlite`), migrations 001-007 incl. marketplace tables; balances address-keyed — no per-outpoint positions (outpoints only inside marketplace funding tables).
6. **Auth**: bearer `TOKEN_EXPLORER_BEARER_TOKEN` (timingSafeEqual); reader-gateway IP allowlist + TLS; marketplace internal bearer + HMAC-signed headers with replay window (`src/marketplace/internal-auth.ts`); HMAC cursors.
7. **runes_native**: none.
8. **Shared contracts**: none.

## index-zcash-metaprotocols — `D:\universe\index-zcash-metaprotocols\index-zcash-metaprotocols`

1. **Stack/run**: JS ESM `.mjs` + Rust workspace (`rust/zrunes-codec`). systemd deployment (`ops/universe-index-zcash-metaprotocols.service`); Zebra runs as container. Single HTTP server, port **8790**. No Docker for the indexer itself, no PM2.
2. **Protocols**: Zcash metaprotocols over Zebra JSON-RPC: Zerdinals (legacy families + Universe v1), ZRunes (raw journal + projection), legacy token journals (zrc20/zrc721), collections, transparent ownership; one scan, many projections.
3. **Routes**: health `GET /live`, `/ready`, `/status` (`src/health/server.mjs`); API under `/zcash-metaprotocols/` (`src/api/server.mjs`): `status`, `inscriptions[...]`, **`addresses/:address/{inscriptions|zrunes|utxos}`**, **`blocks/:height`**, **`transactions/:txid`**, `zrunes[...]` (holders/activity), `collections[...]`, `activity`, `search`, **`POST outpoints/assets`** (batch <=64 outpoints), `POST transactions/broadcast`. Exposed through Universe gateway allowlist (backend-apis `/zcash_indexer/*` proxy). No mempool route (confirmed-only). Every response carries `schemaVersion` (`zcash-metaprotocols-api-v1`), `network`, `checkpoint`.
4. **Explorer contract**: none, but the closest structural match (ready/status+checkpoint/blocks/transactions/outpoints batch; differences: batch POST outpoints, no `/summary`, address positions split per protocol).
5. **DB**: **MySQL 8.4** (`mysql2/promise`, migrations 0001-0003). Per-outpoint positions: **yes** — `zrune_balances PK(outpoint, zrune_id)`, `zrune_spent_balances`, `zrune_commitments (outpoint PK)`, `inscription_outpoints (outpoint PK)`.
6. **Auth**: none in-process — delegated to Universe gateway allowlist (gateway currently forwards GET/HEAD only; the two POST routes need gateway allowances).
7. **runes_native**: none (protocol is "ZRunes", never labelled native runes).
8. **Shared contracts**: none; API shape pinned by consumer repos by convention (noted in `src/api/server.mjs` header).

## bitcoin-indexer — `D:\universe\bitcoin-indexer\bitcoin-indexer`

1. **Stack/run**: Rust cargo workspace (fork of Hiro `bitcoin-indexer` v3.0.0; components bitcoind/postgres/cli/config/ordinals/ord/runes) + two Fastify TypeScript REST APIs (`api/ordinals`, `api/runes`). Runs via `bitcoin-indexer {ordinals|runes} service start --config-path <toml>`; Docker images in `dockerfiles/`. API default `API_PORT=3000`; runes admin RPC 3001; Postgres 5432. No PM2, no .env.example (TOML config).
2. **Protocols**: Ordinals inscriptions, BRC-20 (ordinals meta-protocol), Runes (stock Hiro components — NOT the Universe `runes_native` adapter).
3. **Routes**: Ordinals API under `/ordinals/v1` (+ `/ordinals`): `/` status, `inscriptions[...]` (transfers/content), `sats/:ordinal[...]`, `stats/inscriptions`, `brc-20/{tokens,balances/:address,activity...}`. Runes API under `/runes/v1` (+ `/runes`): `/` status, `etchings[...]` (activity/holders), **`addresses/:address/{balances,activity}`**, **`transactions/:tx_id/activity`**, **`blocks/:block/activity`**. No dedicated /ready or /health (status route hardcodes `status:'ready'`), no checkpoint, **no outpoint route**, no mempool.
4. **Explorer contract**: none.
5. **DB**: PostgreSQL (migrations for ordinals/brc20/runes). Runes ledger has `(tx_id, output)` index (event ledger, not a current-position table); ordinals `locations`/`current_locations` are satpoint-oriented.
6. **Auth**: none (open CORS).
7. **runes_native**: zero matches.
8. **Shared contracts**: none. Actively maintained (main promoted 2026-08-22).

## index-drops — `D:\universe\index-drops\index-drops`  (LIKELY SUPERSEDED)

1. **Stack/run**: Node TS ESM, raw `node:http`; Node **24.18.1**/npm 10.9.8 (older pin). CLI `drops`; `serve --port 3939` (default **3939**). No Docker/PM2/.env.example.
2. **Protocols**: Drops (base-layer Taproot OP_DROP artifact protocol, BIP341-verified; recognizes `bip110-op-drop` carrier; reference-only Pacts profile). 256-byte body cap.
3. **Routes** (`src/http.ts`, GET-only): `/live`, `/ready` (real readiness), `/health` (deprecated alias), `/openapi.json`, `/docs`, `/drops/status` (source/indexed/finalized cursors), `/drops[?limit=&marker=&planHash=]`, `/drops/:id[/content]`, `/pacts`, `/pacts/capabilities`, `/pacts/:pactId`. No block/tx/outpoint/address/mempool routes.
4. **Explorer contract**: none.
5. **DB**: none — atomic checksummed schema-v2 JSON snapshots on disk (`src/store.ts`); explicitly not production-scale. No outpoint positions (records keyed `drops:<network>:<txid>:d<inputIndex>`).
6. **Auth**: none (GET-only; outbound Core basic auth only).
7. **runes_native**: zero matches.
8. **Shared contracts**: none.
- **Supersession**: likely superseded by index-drops-and-opdrop (last commit 2026-08-02; the combined repo absorbed the `drops` CLI/toolkit/Pacts surface; remote org differs — `bitcoinuniverse/index-drops` vs `bitcoinuniverseio/*`; imported via git-archive snapshot per `SOURCE-PROVENANCE.json`). No in-repo DEPRECATED marker.

## index-opdrop — `D:\universe\index-opdrop\index-opdrop`  (SUPERSEDED)

1. **Stack/run**: NestJS 11 + TypeORM; Node 24.18.1/npm 10.9.8. Dockerfile (EXPOSE 3001) + compose (host `${OP_DROP_BIND_PORT:-3015}:3001`, MySQL 8.4 + Redis). Branch `develop`, never promoted; last substantive commit 2026-08-16.
2. **Protocols**: op-drop (BIP-110 $DROP) + Drops over one scan — the direct predecessor of index-drops-and-opdrop.
3. **Routes**: same shape as drops-and-opdrop minus Marketplace v1: `/live|/health|/ready|/version|/metrics` (+ `/op-drop/*` aliases), op-drop tokens/balances/:address/transfers/events/provisional[track]/indexer status|scan|replay, trading listings + authorization, `/drops/*` data + HTML viewer, `/token-explorer/{op-drop,drops,status}` (bearer), `/openapi.json`, `/docs`.
4. **Explorer contract**: none (`/token-explorer/*` feed only).
5. **DB**: MySQL 8.4; per-outpoint yes (op_drop_transfers UNIQUE (network, anchorTxid, anchorVout); drops custody outpoint tables; balances address-keyed).
6. **Auth**: `X-OP-DROP-Service-Token`, token-explorer bearer `OP_DROP_TOKEN_EXPLORER_BEARER_TOKEN`, admin header `x-op-drop-indexer-token`, BIP322 for trading writes.
7. **runes_native**: zero matches.
8. **Shared contracts**: none.
- **Supersession**: superseded by index-drops-and-opdrop (credential rename documented there: `DROPS_OPDROP_INDEXER_URL`/`_SERVICE_TOKEN` with former OP_DROP names as conflict-checked aliases; combined repo adds Marketplace v1 + newer migrations through 2026-08-24). No in-repo DEPRECATED marker.

---

## backend-apis — `D:\universe\backend-apis\backend-apis`

1. **Stack/run**: NestJS 11 + TypeORM + mysql2, Node 24.19.0. **PM2** app `universe` (`ecosystem.config.cjs`, fork mode, single instance — owns in-process indexer/polling work), `npm run pm2:deploy`. Port **3000** loopback, Apache ingress; systemd socket activation supported. Swagger `/api/docs`.
2. **Aggregation**: yes, HTTP-only (never direct DB reads of indexer stores):
   - Transparent reverse proxies: `/zcash_indexer/*`, `/stamp_indexer/*`, `/unat_indexer/*`, `/dust20_indexer/*`, op-inscriptions routes (`src/{zcash-indexer,stamp-indexer,unat-indexer,dust20-indexer,op-inscriptions}/`; base URLs in `src/common/constants.ts`).
   - Typed indexer clients: chainbloom (:3011), witness (:3012), patina (:3013), drops-opdrop (:3015 + service token), tandem (:3021, commented), mempool provider (:8381), bitmap-render (:3004).
   - Marketplace v1 authority clients under `src/marketplace-v1/adapters/`: `ordinals/index-ordinals-authority.client.ts` (`MARKETPLACE_V1_INDEX_ORDINALS_ORIGIN` + bearer), `account-position/index-op20-authority.client.ts`, `account-position/index-stamps-authority.client.ts`, `ordinal-family/index-ordinal-family-authority.client.ts`. **No index-runes/index-brc20 clients** — runes/brc20 data comes from third-party providers (UniSat, Magic Eden, Satflow, etc.) via `src/external/` and `src/unisat/`.
   - Indexer health gate: `src/indexer-health/` (route `/indexer-health`), consumes `MARKETPLACE_PROTOCOL_REGISTRY` from ecosystem-contracts and blocks marketplace mutations when per-protocol indexer freshness fails.
3. **Route namespaces**: no global prefix; ~60 modules. Notable mounts: `api/marketplace/v1/protocols/:protocolId[...]`, `api/marketplace/v1/runtime`, `api/{patina,witness,tandem,chainbloom,frontier-suite,arc20,cat20,rare-sats,ordex,doge-tap,doginals,whole-products,collectible-check}`, `api/op-drop/trading`, `universe-media/v1`, `ordinals`, `ordinals-collections`, `mempool`, `unisat`, `satflow`, `stampdex`, `ecosystem`, `portfolio`, `indexer-health`, `{zcash,stamp,unat,dust20}_indexer`, `wallet-auth`, `auth/chat`, `bip110`, `atomicals-nfts-and-realms`, plus bare controllers declaring `alkanes`, `op20`, `runes`, `brc20`, `mezcal`, `dmt`, `drc20`, `blockdrop`, `unat` etc. per-route.
4. **Protocol registry**: `packages/ecosystem-contracts/lib/protocols.js` — `PROTOCOL_CAPABILITIES` (38 ids incl. `runes_native` with displayName "Runes (Native)", aliases `runes-native|native-runes|runes-(native)`), `PROTOCOL_ALIASES`, `MARKETPLACE_PROTOCOL_REGISTRY` (29 ids), `normalizeProtocolId`. Entry shape: displayName, aliases, ownershipModel (utxo|balance|hybrid), per-surface actions (main/wallet/inscribe/stampdex), marketplace, decimals, addressRoles.
5. **Explorer/overlay modules**: none. No `overlay` matches. `explorer` matches are incidental (outbound stampchain proxy `/api/v1/explorer/src20/*` in `src/external/external.controller.ts`; frontier-suite feature flag; block-explorer prose).
6. **`/v1/explorer/*` routes**: none served. Only `/v1` mounts: `api/marketplace/v1/*`, `universe-media/v1`, `rare-sats` `v1/health`.
7. **runes_native**: pervasive — ecosystem-contracts registry (protocols.js:120, 691), `src/marketplace-v1/marketplace-protocol-adapter.ts:19`, native-token adapter `src/marketplace-v1/adapters/native-token/native-token-marketplace-v1.adapter.ts:73-75` (`RunesNativeMarketplaceV1Adapter`), asset resolver `native-token-asset-resolver.ts:15,35,595` (agreement `unisat-runes-and-esplora-output-agreement-v1`), coverage contract, trade service verified actions, migrations `20260810_create_runes_marketplace_tables.sql`, `20260802_native_token_trade_integrity.sql`, `20260803_marketplace_v1_persistence*.sql` (protocol enum lists).
8. **Shared contracts**: authoring home of `@bitcoinuniverse/ecosystem-contracts` v1.1.1 (`packages/ecosystem-contracts`; subpath exports core/protocols/deep-links/session/events/lifecycle/utxo/marketplace/marketplace-v1/health/metadata/client/schemas). JSON schemas: asset-metadata.v1, classified-utxo.v1, deep-link-intent.v1, ecosystem-event.v1, lifecycle-snapshot.v1, marketplace-order.v1, marketplace-resolver-utxo.v1, wallet-session.v1. **No position-source/checkpoint/settlement-evidence schema in the package** — settlement evidence contract is a code constant `marketplace-v1-settlement-evidence:v1` in `src/marketplace-v1/settlement/marketplace-v1-settlement-recovery-worker.ts:46-47`.
9. **DB**: MySQL/MariaDB only (TypeORM + raw mysql2 pool); SQL migrations in `migrations/`.
10. **Auth**: per-surface — node-gateway policy middleware (public vs trusted-operator, CIDRs), `PRIVATE_BITCOIN_BEARER_TOKEN`, admin cookie sessions + CSRF, wallet signature challenges (`/wallet-auth/challenge`), Firebase chat tokens, ingest guards, per-protocol marketplace read/execution tokens + HMAC secrets.

## wallet — `D:\universe\wallet\wallet`

- **Protocol registry (primary): `backend/shared/protocol-registry.ts`** (668 lines) — "the single release authority for protocol identifiers and operations." 40 entries built via `blocked()`/`readOnly()`/`disabled()` factories; fields: `id`, `aliases`, `network(s)`, `implementedOperations`, `intendedOperations`, `operations` (evidence-backed), `status` (PRODUCTION VERIFIED | VERIFIED READ ONLY | INTENTIONALLY DISABLED | BLOCKED), `evidence`, `uiActions?`, `paymentOnly?`. `BASE_PROTOCOL_REGISTRY` at line ~260; exported `PROTOCOL_REGISTRY` (line ~504) upgraded by `UNIVERSE_PROTOCOL_AUTHORIZATION` env snapshot. No displayName field — display names come from ecosystem-contracts.
  - Ids: bitcoin, ordinals, brc-20, runes (paymentOnly), alkanes (paymentOnly), tap, src-20, stamps, src-101, dust-20, unat, bitmap, block-20, op_return, op-20, op_names, op_inscriptions, mezcal, drops, op-drop, chainbloom, patina, witness-circles, dogecoin, doginals, drc-20, atomicals, arc-20, cat-20, cat-721, dmt, blockdrop, doge-tap, brc-110, fractal, babylon, bip-110, dogecoin-marketplace, zerdinals, zrunes. (Hyphenated id style; `protocolLookupKey` normalization reconciles with backend's underscore-free ids.) Mirrored in `docs/PROTOCOL-RELEASE-MATRIX.json` / `.md`.
- **Secondary registries**: `backend/shared/protocol-dependencies.json` (schemaVersion 2 — service dependency map: endpoints, healthPaths, per-service protocol lists, lag/finality/reorg policies; e.g. universe-bitcoin-api `https://api.bitcoinuniverse.io` `/health` covering 31 protocols); consumers `frontend/ui/utils/protocol-utils.ts`, `protocol-capabilities.ts`.
- **Shared contracts**: consumes `@bitcoinuniverse/ecosystem-contracts` v1.1.1 as vendored tarball `vendor/bitcoinuniverse-ecosystem-contracts-1.1.1.tgz` (`frontend/package.json:86`; verified by `frontend/scripts/verify-ecosystem-contracts.mjs`).
- **runes_native**: not in wallet sources; only transitively via the vendored ecosystem-contracts (appears in built bundles `frontend/chrome-extension-dev/background.js`, `frontend/dist/chrome/background.js`). Wallet's own registry has a single `runes` entry (paymentOnly, BLOCKED) with no native variant.

---

## runes_native / "Native Runes" — complete reference map

| Repo | Role | Files |
|---|---|---|
| **index-runes** | **Implementation** — second `RunesMarketplaceAuthority` instance for protocol `runes_native`; routes `/v1/marketplace/runes-native/*` + `/v1/marketplace/protocols/runes_native/*` | `src/main.mjs:27`, `src/marketplace/authority.mjs` (schemas, dual-instance guard), `src/marketplace/identities.mjs:64`, `src/config.mjs:142-191`, `src/server.mjs:44,59,272`, `.env.example:31-32`, `docs/MARKETPLACE_V1_AUTHORITY.md`, `README.md:97,108` |
| backend-apis | Registry + marketplace adapter (`RunesNativeMarketplaceV1Adapter`), trade flows, DB enums | `packages/ecosystem-contracts/lib/protocols.js:120,691`; `src/marketplace-v1/adapters/native-token/*`; `src/marketplace-v1/marketplace-protocol-adapter.ts:19`; `src/trade/trade.service.ts` (multiple); migrations `20260810_create_runes_marketplace_tables.sql`, `20260802_native_token_trade_integrity.sql`, `20260803_marketplace_v1_persistence*.sql` |
| index-ordinals | Consumer (composite inventory position-source client; maps to `/v1/marketplace/runes-native/position-source` prefix) | `src/marketplace-inventory-types.ts:13,46`, `src/position-source-client.ts:224-225`, `README.md:173` |
| index-mezcal | Shared native-token contract sibling | `contracts/universe-marketplace-native-token-v1.json:4`, `scripts/check-marketplace-contract.mjs:34` |
| index-alkanes | Protocol-id enum + coverage counting | `src/marketplace/inventory.mjs:8,191` |
| index-tap | Protocol-id enum | `src/marketplace-authority.ts:61` |
| index-dmt | Protocol-id enum + README prose ("native Runes" coverage row) | `src/marketplace-authority.mjs:33`, `README.md:219` |
| index-dust20 | Protocol-id enum | `src/marketplace-composite-inventory.mjs:66` |
| index-names | Protocol-id enum | `src/authority.mjs:24`, `test/fixtures.mjs:20` |
| index-unat | Protocol-id enum | `src/clients.mjs:12` |
| index-bitmap | Protocol-id enum | `src/authority.mjs:33` |
| index-drops-and-opdrop | Protocol-id enum (composite inventory client) | `src/drops/drops-output-inventory.client.ts:26` |
| wallet | Transitive only (vendored ecosystem-contracts; built bundles) | `vendor/bitcoinuniverse-ecosystem-contracts-1.1.1.tgz`; `frontend/dist/chrome/background.js` |
| Absent from | index-brc20 (only Marketplace-authority repo missing it — divergence), index-stamps, index-atomicals(+nfts), index-op20, index-opinscriptions, index-block20, index-cat20, index-doge-tap, index-zcash-metaprotocols, index-chainbloom, index-patina, index-witness-circles, index-tandem, bitcoin-indexer, index-drops, index-opdrop | — |

---

## Compact comparison table

| repo | stack | port (default) | explorer contract? | outpoint queries? | mempool support? | auth |
|---|---|---|---|---|---|---|
| index-ordinals | Node TS, node:http | 3218 | no (/ready /status /v1/checkpoint) | yes — /v1/marketplace/inventory/outpoints/:o | preflight only (testmempoolaccept) | bearer x3 + HMAC |
| index-runes | Node .mjs | 3042 | no | yes — {runes,runes-native}/[position-source/]outpoints/:o | no (partial) | bearer + admin header |
| index-stamps | Node .mjs | 3043 | no | route yes; account-ledger (empty positions) | no (partial) | bearer per protocol |
| index-atomicals | Python ElectrumX + sidecar | 50010/50020/8000 + 3043 | no | yes — arc20 position-source/outpoints/:o | rejection signal only | bearer + admin header |
| index-atomicals-nfts-and-realms | Node .mjs | 3003 (ops 3014) | no (closest: blocks/tx/utxos routes) | yes — /v1/atomicals/utxos/:txid/:vout | none | mostly open; bearer feeds |
| index-brc20 | Node .mjs | 3041 | no | yes — /v1/marketplace/positions/outpoints/:o | no | bearer x2 + admin header |
| index-alkanes | Node .mjs | 3044 | no | yes — positions/outpoints/:o (persisted) | no (partial) | bearer x3 + admin |
| index-tap | Node TS | 3012 | no | yes — positions/outpoints/:o (computed live) | no | bearer + exec header |
| index-dmt | Node .mjs | 3044 (clash) | no | yes — positions/outpoints/:o | no | bearer x4 |
| index-dust20 | Node .mjs | 3102 | no | yes — positions/outpoints/:o (persisted allocations) | no | bearer x3 + admin; legacy routes open |
| index-op20 | Node .mjs | 3045 | no | yes — {op_return,op_names}/position-source/outpoints/:o | no | bearer x3 + exec header |
| index-opinscriptions | Node TS (raw http; Nest unused) | 3000/9091/9092 | no | yes — positions/outpoints/:txid::vout | source-level only | marketplace bearer; read API open |
| index-drops-and-opdrop | NestJS + TypeORM | 3001 (host 3015) | no | yes — protocols/:pid/position-source/outpoints/:o | partial (op-drop provisional tracker; Drops confirmed-only) | bearers + service token + BIP322 |
| index-unat | Node .mjs | 3217 | no | yes — positions/outpoints/:o | no | bearer x3 |
| index-bitmap | Node .mjs | 3220 | no (/v1/checkpoint yes) | yes — positions/outpoints/:o (computed live) | no | bearer + exec header |
| index-names | Node .mjs | 3220 (clash) | no (/v1/checkpoint yes) | yes — positions/outpoints/:o (computed live) | no | bearer + exec header |
| index-block20 | Node .mjs | 3101 | no | no | no | bearer feed + admin header |
| index-mezcal | Node TS | 3014 | no | yes — positions/outpoints/:o (persisted) | no | bearer x3 |
| index-chainbloom | NestJS + MySQL | 3000 (backend expects 3011) | no | yes — lanes/by-outpoint/:txid/:vout | **yes** (/mempool + WS) | public reads; admin API key |
| index-patina | Node TS CLI | 4180 (backend expects 3013) | no | yes — carriers/:txid/:vout + POST safety/outpoints | **yes** (/mempool) | **none** (rate limit only) |
| index-witness-circles | NestJS + MySQL | 3012 (clash) | no | yes — shards/:txid/:vout + POST safety/outpoints | **yes** (/mempool[/txid]) | public reads; admin bearer |
| index-tandem | NestJS + MySQL | 3021 | no | yes — carriers/:txid/:vout | **yes** (verified/mempool) | **none** |
| index-cat20 | Node .mjs | 3042 (clash) | no | no | no | bearer + admin header |
| index-doge-tap | Node TS | 3013 | no | no | no | bearer + IP allowlist + HMAC internal |
| index-zcash-metaprotocols | Node .mjs + Rust | 8790 | no (closest match) | yes — POST /outpoints/assets (batch) | no | none (gateway-fronted) |
| bitcoin-indexer | Rust + Fastify TS | 3000 (API) | no | no | no | none |
| index-drops (superseded) | Node TS | 3939 | no | no | no | none (GET-only) |
| index-opdrop (superseded) | NestJS + MySQL | 3001/3015 | no | no (custody tables only) | partial (provisional) | service token + bearer + admin |
| backend-apis | NestJS + MySQL, **PM2** | 3000 | no (proxies external /api/v1/explorer/src20 only) | via indexer clients | mempool proxy module | multi (gateway policy, bearers, sessions) |
