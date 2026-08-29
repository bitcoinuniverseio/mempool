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
       /api/*              ->  universe-explorer-backend   127.0.0.1:8996
       everything else     ->  the built frontend, SPA fallback

  universe-explorer-backend  ->  Bitcoin Core RPC   127.0.0.1:8332
                             ->  explorer database  127.0.0.1:3307
  universe-explorer-overlay  ->  protocol authorities, all on loopback
```

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

All three run as the `universe-explorer` system user. The backend additionally
holds the `bitcoin` supplementary group so it can read the Core cookie, and
nothing else.

## Data authorities

The backend reads only Universe-owned infrastructure:

- Bitcoin Core on 127.0.0.1:8332, authenticated by cookie
- no third-party API, at runtime or at build time

`MEMPOOL.BACKEND` is `none`, meaning Core answers everything. It was
`electrum`, pointing at a Fulcrum on 127.0.0.1:50001 that is no longer on this
host: no process, no data directory, no unit file. A dead address backend does
not fail loudly, it retries, and it was producing roughly two connection errors
a second and burying every real error in the journal. Core serves blocks,
transactions and the mempool either way; with `none` an address lookup fails
immediately and clearly instead of hanging.

Set this back to `electrum` when Fulcrum is running again. The release
preflight refuses `electrum` when nothing is listening on the configured port,
so the retry storm cannot come back silently.

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

## Configuration

`/etc/universe-explorer/`, owned by root, group `universe-explorer`, mode 0640:

| File | Holds |
| --- | --- |
| `backend.json` | explorer backend configuration |
| `overlay.env` | overlay port and the protocol source registry |
| `gateway.env` | gateway ports and the static root |
| `mysql.env` | explorer database name, user, and passwords |
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
   nothing. It refuses a release whose build is incomplete, whose
   configuration would advertise a feature it cannot serve, whose database does
   not answer, whose source registry does not parse or names a token variable
   that is missing, or where a protocol the registry calls readable has no
   authority configured.
5. `universe-explorer-release cutover <sha>` runs the gates again, swaps the
   `current` symlink atomically, restarts what has to restart, and verifies.

   The backend and the overlay run from a path baked into their unit at exec
   time, so they always restart; they take a few seconds to listen again, and
   the gateway waits for them rather than answering 502. The gateway resolves
   its static root per request, so a new frontend reaches it through the
   symlink with no restart, and it is restarted only when its own file
   changed. A cutover was probed once a second through the restart window and
   every request returned 200.

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
   is exactly the state that shipped. A failed verification rolls back.
6. Run `node scripts/universe/synthetic-check.mjs` against the public origin.
   It asks the live endpoints with nothing mocked and fails on an empty range,
   a protocol advertised as readable whose authority cannot answer, a
   configured authority with no checkpoint, a frontend and backend on different
   builds, or a chain document that cannot name the overlay release behind it.
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
8. Keep the previous release directory until the stability window closes.

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
