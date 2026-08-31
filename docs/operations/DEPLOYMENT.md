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
       /api/v1/chains      ->  universe-explorer-overlay   127.0.0.1:3400
       /api/v1/bitcoin/*   ->  universe-explorer-overlay   127.0.0.1:3400
       /api/v1/dogecoin/*  ->  universe-explorer-overlay   127.0.0.1:3400
       /api/v1/zcash/*     ->  universe-explorer-overlay   127.0.0.1:3400
       /api/v1/*           ->  universe-explorer-backend   127.0.0.1:8996
       /api/internal/*     ->  refused here, never proxied
       /api/*              ->  universe-explorer-electrs   127.0.0.1:3001
       everything else     ->  the built frontend, SPA fallback

  universe-explorer-backend  ->  Bitcoin Core RPC   127.0.0.1:8332
                             ->  address index      127.0.0.1:3001
                             ->  explorer database  127.0.0.1:3307
  universe-explorer-overlay  ->  protocol authorities, all on loopback
  universe-explorer-electrs  ->  Bitcoin Core RPC   127.0.0.1:8332
                             ->  Bitcoin Core block files, read only
```

The `/api/` split is the part most worth understanding before changing
anything. With `MEMPOOL.BACKEND` set to `esplora` the explorer backend
deliberately does not mount the address, script hash, transaction, block or
mempool routes at all. It expects the edge to send that whole family to the
index instead, exactly as upstream does in nginx. Point `/api/` at the backend
in that configuration and every one of those paths answers 404 while the site
still loads perfectly.

No indexer port, RPC port, or database port is exposed publicly, and the
browser never learns an indexer origin. The tunnel key on the gateway host is
restricted to port forwarding and to that single destination port.

## Components

| Unit | What it is | Listens |
| --- | --- | --- |
| `universe-explorer-backend.service` | the forked explorer backend, `backend/dist/index.js` | 127.0.0.1:8996 |
| `universe-explorer-overlay.service` | the `backend-apis` read-only protocol overlay, `dist/universe-explorer-main.js` | 127.0.0.1:3400 |
| `universe-explorer-mariadb` | the explorer database, a Docker container | 127.0.0.1:3307 |
| `universe-explorer-gateway.service` | `scripts/universe/gateway.mjs`, static files plus routing | 127.0.0.1:8099 |
| `universe-explorer-electrs.service` | `mempool/electrs` v3.3.0, the Bitcoin address index | 127.0.0.1:3001 HTTP, 127.0.0.1:50002 Electrum |

The backend, the overlay and the gateway run as the `universe-explorer` system
user. The backend additionally holds the `bitcoin` supplementary group so it
can read the Core cookie, and nothing else. The index runs as its own
`universe-electrs` user, also in the `bitcoin` group, and holds no other
privilege.

## Data authorities

The backend reads only Universe-owned infrastructure:

- Bitcoin Core on 127.0.0.1:8332, authenticated by cookie
- no third-party API, at runtime or at build time

`MEMPOOL.BACKEND` is `esplora`, pointing at `universe-explorer-electrs` on
127.0.0.1:3001. That index answers every address, script hash, transaction,
block and mempool read; Bitcoin Core answers the rest and is also what the
index itself reads.

It was `none` for a while, meaning Core answered everything, and that is the
configuration that produced the defect this section exists because of. Bitcoin
Core cannot answer an address lookup, so every address on the public site
returned `405 Address lookups cannot be used with bitcoind as backend`, under a
page that explained to the reader that their address had too many transactions
for the backend to handle. The site went on offering address search in the
header the whole time, and every release gate passed, because no gate had any
opinion about address lookup at all.

`none` is now a release blocker rather than a supported state. See the address
index section below for what the gates check and why a listening port is not
enough.

The explorer database is `universe-explorer-mariadb`, a dedicated container on
loopback port 3307 with its own data directory under
`/data/indexers-c/universe-explorer/mariadb`. Credentials live in
`/etc/universe-explorer/mysql.env`, root-owned and group-readable by
`universe-explorer` only, and the database user is scoped to the one schema.

It is MariaDB rather than the MySQL 8.4 pinned elsewhere in the workspace,
because the upstream migrations are written in MariaDB syntax that MySQL
rejects outright. `ALTER TABLE ... DROP FOREIGN KEY IF EXISTS` and a literal
`DEFAULT` on a `JSON` column both abort the whole migration run on MySQL, and
there are twenty of the latter. Carrying a patch for each one would put a
permanent divergence in the middle of upstream migration code and break again
on every upstream sync. The integration test database is pinned to the same
engine and major version for the same reason: a test database on a different
engine proves nothing about the release.

`DATABASE.ENABLED` and `STATISTICS.ENABLED` are `true`, and
`INDEXING_BLOCKS_AMOUNT` is `52560`, one year of blocks. Statistics and every
mining route are registered only when those are on, so with them off the public
Charts and Mining pages sat in front of routes that answered 404. The indexing
bound is deliberate: it covers every range the mining pages offer up to 1Y and
keeps the initial index from competing with the protocol indexers for Bitcoin
Core for longer than it has to. The frontend only offers a range it has the
block count to cover, so ranges beyond the indexed history stay hidden rather
than empty.

`AUTOMATIC_POOLS_UPDATE` is `false` and `POOLS_JSON_FILE` names the pool list
bundled in the repository. Pool metadata is identified by the git blob hash of
that file's own bytes, so the import is deterministic, needs no network, and
does no work on a redeploy that did not change it. Nothing fetches pool data
from a third party at runtime.

`FIAT_PRICE.ENABLED` is `false`. The price updater reads public exchange APIs,
which is not allowed here, and no Universe-owned price source exists yet. Fiat
amounts render blank rather than as a confident zero.

The overlay reads only Universe protocol authorities, configured through
`UNIVERSE_EXPLORER_SOURCES_JSON` in `/etc/universe-explorer/overlay.env`, with
bearer tokens supplied by separate named variables. Credentials never appear in
the JSON, in responses, or in logs.

Two things about a source entry are easy to get wrong, and both have already
produced an authority the overlay reported as unreachable while it was running
and ready.

The scheme has to be the one the authority actually speaks. Most authorities
here are plain HTTP on loopback; `index-doge-tap` is an HTTPS listener, so its
entry names `https://doge-tap.internal.bitcoinuniverse.io:3013`. That host is in
the certificate's subject alternative names and resolves to `127.0.0.1` through
`/etc/hosts`, so verification passes and the traffic still stays on the loopback
interface rather than going out to the public address the certificate also
names. The certificate is trusted through `NODE_EXTRA_CA_CERTS`, never by
turning verification off. Point an entry at `http://` when the authority serves
TLS and every probe gets an empty reply, which the overlay can only report as
unreachable.

The token has to be the one the endpoint being called checks. A service can
carry more than one: `index-doge-tap` authenticates its reader API with
`TOKEN_EXPLORER_BEARER_TOKEN` and its marketplace authority endpoints per
authority, against `DOGE_MARKETPLACE_<AUTHORITY>_AUTHORITY_BEARER_TOKEN`. The
readiness probe passing proves nothing about the checkpoint request, because
readiness is unauthenticated.

The dashboard, mining, and chart families for Dogecoin and Zcash read two
node RPCs and one durable history store, all configured in the same
`overlay.env`:

- `UNIVERSE_DOGECOIN_RPC_URL` with `UNIVERSE_DOGECOIN_RPC_USER` and
  `UNIVERSE_DOGECOIN_RPC_PASSWORD` (already present for the mempool
  collector) also feed the block collector, `estimatesmartfee`, and
  `getmininginfo`.
- `UNIVERSE_ZCASH_RPC_URL` points at the Zebra JSON-RPC listener, plain
  HTTP on loopback (`http://127.0.0.1:8232/`). Zebra runs without RPC
  auth; set `UNIVERSE_ZCASH_RPC_AUTHORIZATION` only if that changes.
- `UNIVERSE_EXPLORER_HISTORY_PATH` names the SQLite file holding collected
  block history and mempool samples
  (`/var/lib/universe-explorer/chain-history.sqlite`). It is separate from
  `UNIVERSE_EXPLORER_STATE_PATH` so history writes never contend with the
  mempool collector's commits. Unset, the history features report
  themselves unavailable and every other surface keeps working.


## The Bitcoin address index

Address balances, history and unspent outputs come from a first-party
`mempool/electrs`, running on this host, indexing the same Bitcoin Core the
explorer reads. No public API, hosted indexer or third-party Esplora endpoint
is used, at runtime or as a fallback, and the release preflight refuses a
configuration that names one.

| | |
| --- | --- |
| Source | `https://github.com/mempool/electrs`, tag `v3.3.0`, commit `141215c349d5cfbabf8f2b925f3dcea59fed0510` |
| Binary | `/opt/universe-explorer-electrs/v3.3.0/electrs`, beside `SOURCE-SHA`, `SOURCE-URL` and `SOURCE-VERSION` |
| Unit | `universe-explorer-electrs.service`, user `universe-electrs`, group `bitcoin` |
| Unit files | `production/linux/`, so they travel with a release rather than living only on the host |
| Data | `/data/indexers-c/universe-explorer-electrs/mainnet` |
| HTTP | `127.0.0.1:3001`, the Esplora REST API the gateway and the backend read |
| Electrum | `127.0.0.1:50002`, loopback only, not used by this deployment |
| Metrics | `127.0.0.1:4224` |

Nothing it listens on is reachable from outside the host. The public browser
talks only to `https://explorer.bitcoinuniverse.io`, and the only path from
there into the index is the gateway.

It runs with `--lightmode`, which is what makes the storage fit. In light mode
the index does not keep its own copy of raw transactions, block-to-txid maps or
block stats; it reads those from Bitcoin Core's block files instead. Full mode
needs roughly twice the space and about double that again while compacting,
which this volume does not have.

Reading those block files needs one permission that is worth knowing about,
because it is invisible and it is not in any unit file. Bitcoin Core writes
`/var/lib/bitcoind/blocks` mode 0700 with a 0077 umask, so a POSIX default ACL
grants the `bitcoin` group read access there:

```bash
setfacl -m    g:bitcoin:rx /var/lib/bitcoind/blocks
setfacl -d -m g:bitcoin:rx /var/lib/bitcoind/blocks
setfacl -R -m g:bitcoin:rX /var/lib/bitcoind/blocks
```

The default entry is the load-bearing one: a directory with a default ACL
ignores the creating process umask, so block files Core writes from now on are
group readable too. Without it the index works until Core rolls to a new
`blk` file and then stops, which is a failure that arrives days after the
change that caused it. This grants the group nothing it did not already have:
every member can read the RPC cookie, and the RPC serves every block anyway.

### Readiness

A listening port is not readiness, and neither is a process that started. The
rule lives in `backend/src/api/bitcoin/address-index.ts` and nowhere else, so
the capability document, the release preflight, the cutover verification and
the production synthetic check cannot form different opinions about it. The
index is `ready` only when all of these hold:

- an endpoint is configured
- it answers
- it reports an indexed height, and Core reports a chain height
- the gap between them is within `ESPLORA.MAX_BEHIND_TIP`, currently 2 blocks
- a real address summary query returns a usable document
- a real UTXO query returns a usable list

Anything else is `syncing`, `degraded`, `unavailable` or `disabled`, and each of
those is a different sentence on the address page. `syncing` says how far the
index has got, because an index that will answer in an hour is not the same
thing as one that is broken.

One thing about `syncing` is worth knowing before reading it as a symptom.
electrs completes its initial index before it binds its HTTP port at all, so
the very first build does not report as `syncing`, it reports as `unavailable`:
there is nothing listening to ask. `syncing` is what a restart looks like once
the index exists, when it replays the blocks it missed and answers again within
seconds or minutes. Watch the journal during a first build; watch the
capability document after one.

Read the current state from the deployment rather than inferring it:

```bash
curl -s http://127.0.0.1:8996/api/v1/capabilities | python3 -m json.tool | sed -n '/addressLookup/,/}/p'
```

### First sync

The initial index is one long run and needs no supervision. It writes about a
terabyte, so watch the volume rather than the clock.

```bash
systemctl start universe-explorer-electrs
journalctl -u universe-explorer-electrs -f
du -sh /data/indexers-c/universe-explorer-electrs
df -h /data/indexers-c
```

`/data/indexers-c` is shared with ord-tap, the Fractal node and the explorer's
own working data, and an index that fills it takes those down with it. So
`universe-explorer-electrs-diskguard.timer` checks every five minutes and stops
the index while there is still room to stop cleanly:

```bash
systemctl list-timers universe-explorer-electrs-diskguard.timer
journalctl -t electrs-diskguard
```

The floor is 120 GB free, set in
`/usr/local/bin/universe-explorer-electrs-diskguard`.

Watch the journal, but do not rely on it for the whole run. The initial index
logs a line per batch for hours into a journal shared with every other service
on this host, and it rotated once during the first build, taking that history
with it. The unit carries `LogRateLimitIntervalSec` and `LogRateLimitBurst` so
a sync cannot own the journal again. `du` on the data directory is the
progress signal that survives a rotation.

Do not switch `MEMPOOL.BACKEND` to `esplora` until the index is ready. The
preflight will refuse the cutover if you do, which is the intended outcome, but
the honest sequence is to leave production serving on the previous release
while the index builds and switch afterwards.

### Restart and rebuild

```bash
systemctl restart universe-explorer-electrs
```

A restart replays from the last committed height and needs nothing else.
Address pages report themselves temporarily unavailable while it comes back and
recover on their own; every other page keeps working, because the gateway
retries a refused connection for a few seconds before answering, and nothing
else on the origin depends on this index.

A rebuild is the last resort, costs another full sync, and must not be started
without the space for it:

```bash
systemctl stop universe-explorer-electrs
rm -rf /data/indexers-c/universe-explorer-electrs/mainnet
systemctl start universe-explorer-electrs
```

The index is derived data and is deliberately not backed up. Restoring a stale
copy of an index would be slower than rebuilding it and would risk serving
balances from a chain state that no longer exists.

### Troubleshooting

| What you see | What it is |
| --- | --- |
| `GlobError ... blocks ... Permission denied` | the ACL above is missing, or a new `blk` file was written before the default entry existed |
| capability `syncing` with a height far behind | first sync, or a restart replaying; watch the height climb |
| capability `unavailable` while the unit is active | the process is up and not answering, usually early start-up or a compaction; check the journal before restarting |
| capability `degraded` at the chain tip | the index is current but an address or UTXO query did not return a usable document; the journal names the query |
| address pages fail while blocks and transactions work | the gateway is sending `/api/` to the explorer backend rather than the index; check `UNIVERSE_GATEWAY_ESPLORA` |
| the diskguard stopped the index | the volume went below its floor; free space before starting it again |

## Configuration

`/etc/universe-explorer/`, owned by root, group `universe-explorer`, mode 0640:

| File | Holds |
| --- | --- |
| `backend.json` | explorer backend configuration |
| `overlay.env` | overlay port and the protocol source registry |
| `gateway.env` | gateway ports, the address index endpoint, and the static root |
| `mysql.env` | explorer database name, user, and passwords |
| `electrs.env` | overrides for the address index unit, when any are needed |
| `doge-tap-ca.pem` | the certificate `index-doge-tap` presents, trusted by the overlay |

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

`scripts/universe/release.sh` performs the release and is installed on the host
as `/usr/local/bin/universe-explorer-release`. It exists because the previous
release passed every check in CI and still shipped two broken pages: the thing
that was wrong was the configuration of the machine, and nothing in a fixture
suite can see that.

1. Run the full check set on the runner fleet
   (`.github/workflows/universe-ci.yml`), including the branding, origin, and
   text gates against both the source tree and `frontend/dist`, the backend
   integration tests against a real database, and the visual matrix.
2. Build on the runner fleet and pack `backend/dist`, `frontend/dist`, and
   `scripts/universe` into one artifact.
2b. Refresh `/usr/local/bin/universe-explorer-release` from the artifact
   before using it. It is a copy, not a symlink, so it does not travel with a
   release and will otherwise run the previous release's gates against the new
   one while printing a log that looks entirely normal. It was found a release
   behind, still carrying gates from before the dependency and rollback guards
   existed.

   ```bash
   tar -xzOf mempool-<sha>.tar.gz scripts/universe/release.sh      > /usr/local/bin/universe-explorer-release.new
   chmod 0755 /usr/local/bin/universe-explorer-release.new
   mv -f /usr/local/bin/universe-explorer-release.new /usr/local/bin/universe-explorer-release
   ```

   Taking it from the tarball rather than a checkout keeps the tool and the
   release it installs on the same commit.

3. `universe-explorer-release install <sha> <artifact>` unpacks it beside the
   running release under `/opt/universe-explorer/releases/mempool-<sha>/` and
   hard-links the dependency tree from the release in use. A release directory
   is never overwritten in place.
4. `universe-explorer-release preflight <sha>` runs the gates and changes
   nothing. It refuses a release whose build is incomplete, whose manifest is
   missing or names a different commit from the one being installed, whose
   configuration would advertise a feature it cannot serve, whose database does
   not answer, whose source registry does not parse or names a token variable
   that is missing, or where a protocol the registry calls readable has no
   authority configured.

   It also refuses a release that cannot serve address lookups, which is the
   gate that did not exist when the address family shipped broken. What it
   asked before was whether a socket accepted a connection, and with
   `MEMPOOL.BACKEND` set to `none` it concluded there was "nothing to reach"
   and passed. It now blocks `none` outright, and for `esplora` it makes real
   requests: the index has to name the right genesis block, be inside
   `MAX_BEHIND_TIP` of Core, and answer a summary, a history page and a UTXO
   query for a known address. Every configured source, fallbacks included, has
   to be loopback or a Unix socket, so a third-party API cannot be introduced
   through the one path nobody watches.
5. `universe-explorer-release cutover <sha>` runs the gates again, swaps the
   `current` symlink atomically, restarts what has to restart, and verifies.

   The backend and the overlay run from a path baked into their unit at exec
   time, so they always restart; they take a few seconds to listen again, and
   the gateway waits for them rather than answering 502. The gateway resolves
   its static root per request, so a new frontend reaches it through the
   symlink with no restart, and it is restarted only when its own file
   changed. A cutover was probed once a second through the restart window and
   every request returned 200.

   When the gateway does change, it restarts before the backend, and that
   order matters as soon as a release moves which upstream owns a path.
   Adopting the index did exactly that. A new gateway in front of an old
   backend is fine: it sends `/api/` to the index, which is already up, and
   `/api/v1/` to the backend, which still answers it. An old gateway in front
   of a new backend is not: it sends `/api/` to a backend that no longer
   mounts those routes, and every transaction, block and address page 404s for
   as long as that lasts. The socket unit holds the port across the gateway's
   own restart, so going first costs nothing.

   A release that changes the gateway itself used to be the one case that
   still showed a gap, because the port went away with the process and nothing
   could bridge it. `universe-explorer-gateway.socket` closes that: systemd
   owns the listening port, so a restart of the service leaves it bound and
   arriving connections wait in the kernel backlog. The unit and the service
   drop-in that requires it are in `production/linux/`. Enable it with

   ```bash
   systemctl enable --now universe-explorer-gateway.socket
   ```

   Measured on this host before adopting it, on a spare port with a throwaway
   unit pair that was removed afterwards: the service logged that it was
   listening on the socket systemd passed, and a full `systemctl restart`
   under a probe every 20 milliseconds returned 200 on all 400 requests while
   the process id changed underneath. The handover is not an assumption.

   Adopting it on a gateway that is already running costs one brief
   interruption, since the running process holds the port without
   `SO_REUSEPORT` and the socket unit cannot bind underneath it. Every deploy
   after that is seamless. The cutover log states which of the two cases
   applies rather than leaving a reader to assume.

   Once the socket owns the port it outlives the service, so stopping the
   service alone does not take the gateway down: the next connection starts it
   again. To stop it for real, stop both units.

   ```bash
   systemctl stop universe-explorer-gateway.socket universe-explorer-gateway.service
   ```

   An upstream that is genuinely gone is still reported as a gateway failure
   within a few seconds, so a real outage is never hidden behind a long wait. After the swap it reads `/api/v1/capabilities` and
   fails the release if any feature is enabled with no routes registered, which
   is exactly the state that shipped. It then holds the three component
   identities to `RELEASE-MANIFEST.json`, which is where a frontend and a
   backend from different releases, or an overlay that cannot name itself, stop
   the cutover. A failed verification rolls back.
5b. After the cutover, `verify_live` opens the public address contract through
   the gateway: the capability document has to say `ready`, and the summary,
   first history page and UTXO query have to answer with whole-number amounts
   and real transaction ids. It also asks the explorer backend directly for an
   address and requires a refusal, because in this configuration the backend
   does not mount that route, and a backend that answers it means the gateway
   is routing `/api/` to the wrong upstream. A failure here rolls back.

6. Run `node scripts/universe/synthetic-check.mjs` against the public origin.
   It asks the live endpoints with nothing mocked and fails on an empty range,
   a protocol advertised as readable whose authority cannot answer, a
   configured authority with no checkpoint, a frontend and backend on different
   builds, or a chain document that cannot name the overlay release behind it.
6b. Run `node scripts/universe/visual-qa/address-page-smoke.mjs` against the
   public origin. Step 6 reads the API; this opens address pages of every
   script type in a browser, including one with an enormous history and one
   malformed string, and fails if any of them renders "Error loading address
   data", "too many transactions on this address", or a failing status beside a
   success phrase such as "405 OK".

7. Run `node scripts/universe/visual-qa/chain-page-smoke.mjs --release=<sha>`
   against the public origin. Step 6 reads the API and cannot see what the
   origin renders, which is how a release that was never promoted went on
   serving an obsolete chain dashboard while every check passed. This one opens
   `/dogecoin` and `/zcash` in a browser and holds each page to its own
   capability document: a labelled status rail, a readable explanation whenever
   the chain says it is not ready and none when it says it is, the three history
   coverage dimensions, no whole snapshot identifier in the primary interface
   and the whole one filed under the technical details, next actions that
   resolve, and the frontend commit this release expected.

8. Check the shell on a phone against the public origin, not only in CI.

   ```bash
   node scripts/universe/visual-qa/mobile-check.mjs --base=https://explorer.bitcoinuniverse.io
   ```

   It walks eleven routes across seven window sizes with a coarse pointer, a
   simulated display cutout and a rotation, and answers every request from
   fixtures, so what it measures is the deployed shell rather than the chain.
   Add `--browser=webkit` for the engine Safari is built on.

   This is worth running against production and not only against the build,
   because the two things it is most likely to catch are things CI cannot see:
   a gateway serving a stale `index.html`, which shows up immediately as the
   viewport meta losing `viewport-fit=cover`, and a configuration difference
   that changes which destinations the bottom bar carries.

   Then look at it by hand on a phone. The gate is emulation, and emulation is
   not a device: it cannot tell you whether a thumb reaches the bottom bar
   one-handed, whether the software keyboard covers the result you were
   reading, or whether the page zooms when you tap the search field. Open the
   header and search, switch chain, search with the keyboard up, open a
   transaction, scroll a table, rotate, go back, and watch a live update
   arrive. Current Safari on iPhone and iPad, Chrome on Android, Samsung
   Internet, and Chrome on iPhone.
9. Keep the previous release directory until the stability window closes.

Rolling back to a release from before the socket handover needs the port back,
because such a gateway opens 8099 itself and dies on bind while systemd holds
it. `release.sh rollback` detects that case by looking for `inheritedListenerFd`
in the target release and disables the socket first. That is worth knowing by
hand too, since the rollback path is reached exactly when something has already
gone wrong.

## Database growth and retention

Measured on the running deployment, with one year of blocks indexed and the
statistics writer taking a sample a minute:

| Table | Rows | Size | Growth |
| --- | --- | --- | --- |
| `blocks` | 52,580 | 130 MB | about 0.4 MB a day, from new blocks only |
| `statistics` | 1 a minute | small | about 0.4 MB a day |
| `hashrates` | 1,437 | 0.2 MB | a few rows a day |

That is roughly 300 MB a year against 1.5 TB free on `/data/indexers-c`, so
nothing is pruned. Statistics are kept indefinitely on purpose: the `all` range
is the whole series, and deleting old samples would silently shorten it.

The indexed block window is bounded by `INDEXING_BLOCKS_AMOUNT`, so `blocks`
grows only with the chain rather than with the backlog. Raising that value
re-indexes further back and costs Bitcoin Core RPC time while it runs; do it
when the host is not also rebuilding an index.

## Monitoring

`universe-explorer-synthetic-check.timer` runs the synthetic check against the
public origin every five minutes. The unit files are in `production/linux/`.
It exercises the same path a reader takes, including the gateway, the tunnel,
and TLS, and marks the service failed when a check fails, so an outage between
releases shows up where every other service failure already does:

```bash
systemctl list-timers universe-explorer-synthetic-check.timer
journalctl -u universe-explorer-synthetic-check.service -n 30
```

It fails on a feature advertised with no routes behind it, a statistics range
that answers with nothing, a protocol marked readable whose authority cannot
answer, a configured authority that published no checkpoint, and a frontend and
backend reporting different builds. The same script runs hourly in CI through
`universe-production-smoke.yml`.

## Rollback

```bash
universe-explorer-release rollback <previous-sha>
```

It points the symlink back, restarts the three units, and verifies the result,
failing loudly if the rollback target does not come back either.

Configuration lives outside the release directory, so a rollback carries the
configuration forward. Database migrations do not roll back: they are additive,
and an older backend reads a newer schema. A rollback across a migration should
therefore be paired with a database restore only if the newer schema is known
to be incompatible, which has not happened yet.

`universe-explorer-backup.timer` dumps the database daily into
`/data/indexers-c/universe-explorer/backups` and keeps two weeks. The script
refuses to keep a dump that is suspiciously small and checks the archive reads
back, because a backup nobody verifies is not a backup. Take one by hand before
a release that migrates:

```bash
systemctl start universe-explorer-backup.service
```

Verify a restore into a scratch schema after any change to the schema or the
engine, rather than trusting that the dump exists:

```bash
docker exec universe-explorer-mariadb mariadb -u root -p"$MYSQL_ROOT_PASSWORD" \
  -e 'DROP DATABASE IF EXISTS restore_probe; CREATE DATABASE restore_probe;'
gunzip -c <dump> | docker exec -i universe-explorer-mariadb \
  mariadb -u root -p"$MYSQL_ROOT_PASSWORD" restore_probe
```

## Rules

Never restart a protocol indexer to make a deployment convenient. Never stop
Bitcoin Core. Never interrupt an ord index rebuild. `universe-mempool.service`
on the same host is a different product and is not part of this stack.

## Release identity

Three components run here and each publishes its own commit. They are allowed
to differ, and reading one as another is how the last identity defect went
unnoticed for as long as it did.

| Component | Where it publishes | Release directory |
| --- | --- | --- |
| frontend | `GIT_COMMIT_HASH` in `/resources/config.js`, and the `/source` page | `releases/mempool-<sha>` |
| explorer backend | `gitCommit` on `/api/v1/backend-info` | the same directory |
| protocol overlay | `release.sha` on every `/api/v1/<chain>/status` | `releases/backend-apis-<sha>` |

A build whose SHA is not published must not ship.

Every artifact carries `RELEASE-MANIFEST.json` at its root, generated from the
commit being built by `scripts/universe/release-manifest.mjs`. It names the one
commit the frontend, the explorer backend and the gateway in that artifact all
come from, and the contract versions this frontend reads. It deliberately does
not pin the overlay commit: the overlay is built from another repository on its
own release train, so what the manifest requires of it is the contract and an
identity it can state, and the commit it reports is recorded rather than
required.

```bash
node scripts/universe/release-manifest.mjs verify   --manifest=/opt/universe-explorer/current/RELEASE-MANIFEST.json   --origin=https://explorer.bitcoinuniverse.io
```

`release.sh` runs the same check against the loopback gateway before the
cutover is allowed to stand.

The overlay's identifier shipped as the literal string `development` and served
that to the public. Two faults produced it, and both are worth knowing because
neither was visible from anything that was being checked:

- Nothing supplied the value. `universe-explorer-overlay.service` reads
  `/etc/universe-explorer/overlay.env`, no example file mentioned
  `UNIVERSE_EXPLORER_RELEASE_SHA`, and no install step wrote it. Meanwhile every
  release directory already carried a `RELEASE-SHA` file naming its commit.
- The absence was survivable. A missing identity fell back to a placeholder and
  the service started, so the only signal was a word on a public page.

The overlay now reads its own release directory's `RELEASE-SHA` when the
variable is absent, which is an identity that cannot drift from the artifact,
and with `NODE_ENV=production` it refuses to start when neither is a commit.
Installing an overlay release therefore has one requirement beyond unpacking it:

```bash
printf '%s
' "<sha>" > /opt/universe-explorer/releases/backend-apis-<sha>/RELEASE-SHA
ln -sfn /opt/universe-explorer/releases/backend-apis-<sha> /opt/universe-explorer/current-overlay.new
mv -Tf /opt/universe-explorer/current-overlay.new /opt/universe-explorer/current-overlay
systemctl restart universe-explorer-overlay
```

`synthetic-check.mjs` fails the release when any chain document reports
`development`, reports something that is not a commit, or when the three chains
disagree about which overlay answered.

## The edge

The public origin terminates on the cPanel host and reaches the explorer
gateway over an SSH tunnel, through an nginx upstream with a keep-alive pool.
Two things about that path have already caused incidents and are worth knowing
before diagnosing a third.

`/favicon.ico` and `/robots.txt` are proxied to apache rather than the tunnel,
and apache inherited a parent rewrite that redirected them elsewhere. A
hijacked `robots.txt` means crawlers never saw this site's policy. Both are now
served from the explorer docroot, with `RewriteEngine On` reset there so the
parent catch-all does not apply.

The tunnel's server-side sshd child carries every public byte and is
single-threaded. Under memory pressure it lands in a per-session scope with
default resource weights, and a few megabytes of page-in on a saturated device
becomes seconds of stall. Runtime protections were applied during the incident
of 2026-08-28, but a per-session scope dies with the session, so the protection
lapses silently whenever the tunnel reconnects. The durable fix is to pin the
tunnel's server end under a controlled slice.

Operator access degrades before user traffic does on that host, which is
backwards from what an operator needs: new SSH connections fail during banner
exchange while the established tunnel keeps serving. A new connection needs
fork, exec, PAM and password file reads, all uncached IO, and proportional IO
weight cannot beat a saturated queue. An established session does none of that
per byte.
