# Recovery

## Explorer backend will not start

Read the journal first. Known causes:

- **Database refused**: the MariaDB container is down or still initializing.
  Upstream migrations use MariaDB-only syntax; a MySQL 8.4 container fails at
  `DROP FOREIGN KEY IF EXISTS` during the first migration. Use MariaDB.
- **Core RPC unreachable**: check the bounded RPC pool
  (`universe-explorer-rpc-pool`), then Core itself. Never bypass the pool by
  pointing the backend straight at Core.
- **Pools metadata fetch failing**: the local mirror service must be running.
  The explorer never falls back to a public host.

## Protocol evidence disappears from the UI

The explorer degrades honestly: base Bitcoin data keeps rendering while a
protocol authority is unavailable, and the affected protocol reports its exact
state. Check `/api/v1/universe/sources` for the failing authority, then that
authority's own readiness endpoint.

## An Ord authority stops answering while still indexing

Observed failure mode: the Ord HTTP server accumulates sockets in CLOSE-WAIT
and every read hangs indefinitely while block indexing continues normally, so
process-level health checks still look green. Symptoms: `/status` and
`/blockhash` time out, socket counts in CLOSE-WAIT climb into the hundreds.

Recovery: restart the Ord service. Its database is crash-safe, and a graceful
stop can take up to the configured stop timeout while the in-flight block
commits. Do not kill it early. After restart, verify `/status` responds in
milliseconds and the height matches Core.

Prevention: the overlay's Ord client sets request timeouts and never holds a
connection open waiting for a hung authority, so a wedged authority degrades
one protocol instead of the whole explorer.

## Reorg

The overlay increments its reorg epoch, invalidates derived summaries above the
common ancestor, and republishes. If a protocol authority cannot reconcile the
reorg it is marked stale for the affected range. Base Bitcoin block display is
never hidden, and orphaned protocol events are never presented as current. See
`docs/data/CHECKPOINTS-AND-REORGS.md`.

## Rollback

Releases are separate directories with the gateway upstream selecting one.
Rollback is a single upstream flip back to the previous release, which stays
running through the stability window. No database rollback is required for a
frontend-only or overlay-only regression; the overlay stores derived data only.
