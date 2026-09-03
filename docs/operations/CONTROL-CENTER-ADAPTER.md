# Explorer private adapter for the Bitcoin Universe Control Center

The unified Control Center lives at `https://inscribe.bitcoinuniverse.io/admin`.
Until now the Explorer had no administration product at all: there was no
place to see whether Bitcoin Core was still syncing, whether the address index
could answer, or why a page was empty. This adapter is the Explorer's half of
that product.

```text
browser  ->  inscribe.bitcoinuniverse.io/api/admin/v1   (same origin, session + CSRF)
                        |
                        |  signed service request, private network path only
                        v
          explorer:/internal/admin/v1/*   ->  Explorer subsystems (unchanged)
```

The browser never talks to these routes. Nothing here is added to the public
API, and the public wildcard CORS origin is stripped from every response.

## Two independent gates

A request reaches a handler only when both of these hold.

1. **Private path.** The connection has to arrive from loopback or an RFC 1918
   or RFC 4193 address. Anything else gets a flat `404`, so a public scan does
   not learn the routes exist.
2. **Signed service request.** A known key id, a timestamp within 60 seconds,
   an unused nonce, a body digest over the exact bytes received, and an HMAC
   over method, path, sorted query, key id, timestamp, nonce and digest. The
   signing string comes from the shared contract, so this adapter and Core's
   cannot drift into different opinions about what a valid request is.

Every rejection returns the same message, so a caller learns nothing about
which check failed. The operator gets the real reason in the log.

## Configuration

```env
# Comma separated keyId:base64secret pairs. Add the new key first, deploy,
# remove the old one on a later deploy. Secrets shorter than 32 bytes are
# ignored rather than accepted.
EXPLORER_ADMIN_ADAPTER_KEYS=control-center:<base64 32+ byte secret>

# Which environment this process is allowed to call itself. A process that
# cannot prove it is production is never labelled production.
UNIVERSE_ADMIN_ENVIRONMENT=production

# The commit the served frontend was built from. Without it the release
# verification says "unknown" rather than claiming the two builds match.
UNIVERSE_FRONTEND_RELEASE_SHA=<40 hex characters>

# Only when an operator has wired a deployment adapter on the host.
EXPLORER_DEPLOYMENT_CONTROL=enabled
```

With no key configured the adapter answers `503` to everything that reaches it
over the private path. An unconfigured adapter is never an open one.

## What the snapshot reports

One request returns the whole Explorer in the shared vocabulary. Every value
comes from something this process measured or read.

| Group | Contents |
| --- | --- |
| Node | Bitcoin Core reachability, chain tip, headers, initial block download, verification progress |
| Database | Connectivity probe and latency, or `disabled_by_policy` when switched off |
| Cache | Redis connection state, or `disabled_by_policy` |
| Mempool | Transaction count, reported size and bytes, transactions per second, seconds since the last completed update cycle |
| Blocks | Newest processed height against the node height, and any loading indicator that is currently running |
| Fees | Whether the estimator produced a usable recommendation, and the projected block count |
| Capabilities | Statistics, mining, address lookup, Lightning, prices, accelerations, wallets, Stratum and Liquid, each with enabled, routes registered, dependency state, coverage, row count, lag and an exact degraded reason |
| Pools | Mining pool metadata revision and how long since it was refreshed |
| Prices | Newest stored price and its age |
| WebSocket | Connected client count |
| Process | Uptime, CPU count, load average, memory, heap used against the heap limit, event loop lag, request count, p50 and p95 latency, error rate, disk capacity |

A value that could not be read is `null`, never a zero. A feature that is
switched off reads `disabled_by_policy`; a feature that is switched on but
cannot answer reads `unavailable` or `degraded` with the reason.

### Event loop lag and request latency

These two are measured here and nowhere else. Lag is sampled by scheduling a
timer and recording how late it actually fires, and latency is measured by a
middleware registered before the routes, so a route that throws is still
counted. A blocked event loop is the difference between an Explorer that feels
instant and one that feels frozen, and it is invisible in every other number.

## Operations

| Operation | Risk | What it does |
| --- | --- | --- |
| `explorer.capabilities.refresh` | SAFE | Drops the cached capability report and reprobes every feature |
| `explorer.dependencies.recheck` | SAFE | Real probe of Bitcoin Core, the database and Redis |
| `explorer.address-index.probe` | SAFE | Real address query, real UTXO query, height compared against Core |
| `explorer.release.verify` | SAFE | Compares the backend commit against the served frontend commit |
| `explorer.smoke.run` | SAFE | Reads capabilities, chain tip and mempool the way a visitor would |
| `explorer.runs.reconcile` | SAFE | Moves runs with an expired lease to `NEEDS_REVIEW` |
| `explorer.pools.refresh` | GUARDED | Re-reads mining pool metadata |
| `explorer.prices.refresh` | GUARDED | Runs one price update cycle now |
| `explorer.indexer.task.run` | GUARDED | Runs one of the two allowlisted indexing tasks |
| `explorer.indexer.reindex` | HIGH_RISK | Releases the indexing loop to run again |
| `explorer.service.restart` | HIGH_RISK | Restarts the approved service unit through the host deployment adapter |
| `explorer.release.rollback` | IRREVERSIBLE | Puts the previous verified release back in service |

`HIGH_RISK` and `IRREVERSIBLE` operations need a typed confirmation, refuse
retries, and are rejected without an elevated action header even when the
service signature verifies. A leaked service key cannot reach them.

`explorer.service.restart` and `explorer.release.rollback` report
`not_configured` with the exact reason until an operator wires a deployment
adapter on the host and sets `EXPLORER_DEPLOYMENT_CONTROL=enabled`. They stay
visible in the catalog rather than disappearing, because an action that is
missing and an action that is switched off look identical to an operator
otherwise.

No operation accepts a shell command, an RPC method, a SQL statement, a
filesystem path, a service unit name or a URL. A test refuses any input field
whose name could carry one.

## Runs survive restarts

Schema version 107 adds `admin_adapter_runs` and `admin_adapter_locks`.

- A run whose lease expires without reaching a terminal state becomes
  `NEEDS_REVIEW`, not succeeded and not failed, because a process that died
  mid-write cannot prove either.
- The lock stops two operators from starting the same work on the same target.
- An `Idempotency-Key` replays the original run instead of starting a second.
- With the database switched off, operations refuse rather than run without a
  record. An operation nobody can audit is not one worth having.

## The /admin address on this host

The Explorer never served an administration panel of its own. Operations for
it live in the unified Control Center, so nginx answers `/admin` and anything
under it with a permanent redirect to
`https://inscribe.bitcoinuniverse.io/admin/apps?application=explorer`.

The redirect is in nginx rather than in the application on purpose: it has to
answer before the Angular bundle loads, and it has to answer for a request
that never reaches Angular at all. `scripts/universe/admin-redirect.test.mjs`
holds it to that: permanent, https only, every path under `/admin`, declared
before the site fallback, and marked so the redirect itself never appears in a
search result.

## Rollback

The tables are additive and no public route reads them. To roll the schema
back, drop them and set the recorded schema version to 106:

```sql
DROP TABLE IF EXISTS admin_adapter_locks;
DROP TABLE IF EXISTS admin_adapter_runs;
UPDATE state SET number = 106 WHERE name = 'schema_version';
```

Reverting the code alone is also safe: the routes disappear, the two tables
are simply unused, and public Explorer traffic is unaffected either way.
