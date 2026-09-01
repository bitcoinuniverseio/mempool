# Releases and versioning

This fork cuts its own releases. Upstream's release line and this one are
separate, and neither is a version of the other.

## Two version numbers, and what each means

| Number | Where it lives | What it means |
| --- | --- | --- |
| `universe-YYYY.MM.DD[.N]` | Git tags and GitHub releases in this repository | a Universe Explorer release. `.N` distinguishes the second and later release cut on the same day |
| `3.3.1` | `backend/package.json`, `frontend/package.json`, `version` on `/api/v1/backend-info` | the upstream base this fork is built on, recorded in `UPSTREAM.md` and `upstream-base.json` |

The package version is deliberately left at the upstream base. It answers
"which upstream release is this fork's base", which is the question an upstream
sync needs answered. It does not identify a Universe release, and nothing
should read it as one.

Published releases so far:

| Tag | Published |
| --- | --- |
| `universe-2026.08.29` | 2026-08-29 |
| `universe-2026.08.29.2` | 2026-08-29 |

Both tags are reachable from `main` and from `develop`.

Universe releases are not semantic versions and make no compatibility promise
through their number. What a release promises is stated by the contract
versions its artifact declares, not by its date.

## Branches

| Branch | Role |
| --- | --- |
| `develop` | the integration branch, and the default branch. Pull requests target it |
| `main` | the release branch. It only ever moves through a promotion from `develop` |
| `master` | the read-only upstream mirror, and nothing else |

`docs/operations/UPSTREAM-SYNC.md` is the procedure that keeps `master` current
and opens a synchronization pull request into `develop` when upstream drifts.

## The artifact

`.github/workflows/universe-release-artifact.yml` builds the one artifact a
release installs, on the self-hosted runner fleet. It is dispatched manually
and builds the ref it is dispatched on.

It takes no ref input on purpose. Dispatched from the default branch, the job
holds that branch's Actions cache scope, so building an arbitrary ref would run
that ref's install and build scripts with write access to the cache every other
workflow restores from. Dispatch it against the branch or tag you want built
instead.

Building on the fleet rather than a workstation is also deliberate. A
workstation has two ways of handing you a stale build without saying so: a
leftover server process keeps serving an old output directory, and a failed
build step can leave the previous output in place. Both have already produced a
measurement that described a build nobody was running. A runner starts from a
clean checkout, so the artifact matches the commit it names.

### `RELEASE-MANIFEST.json`

Every artifact carries one at its root, generated from the commit being built
by `scripts/universe/release-manifest.mjs`. It names the single commit the
frontend, the explorer backend, and the gateway in that artifact all come from,
and the contract versions this frontend reads.

It deliberately does not pin the protocol overlay's commit. The overlay is
built from `bitcoinuniverseio/backend-apis` on its own release train, and a
manifest that pinned it would either be wrong every time that train moved or
would couple two releases that are not coupled. What the manifest requires of
the overlay is the contract version and an identity it can state; the commit it
reports is recorded rather than required.

```bash
node scripts/universe/release-manifest.mjs verify \
  --manifest=<path to RELEASE-MANIFEST.json> \
  --origin=<origin>
```

## Release identity

Three components run behind one origin and each publishes its own commit. They
are allowed to differ, and reading one as another is how the last identity
defect went unnoticed for as long as it did.

| Component | Where it publishes its commit |
| --- | --- |
| frontend | `GIT_COMMIT_HASH` in `/resources/config.js`, and the `/source` page |
| explorer backend | `gitCommit` on `/api/v1/backend-info` |
| protocol overlay | `release.sha` on every `/api/v1/<chain>/status` |

A build whose commit is not pushed to the public repository must not ship.
That is an AGPL section 13 obligation, not a convention:
`docs/legal/AGPL-COMPLIANCE.md` records how the corresponding source is
guaranteed for every deployed version.

## Cutting a release

1. **Run the full check set.** The same one `.github/workflows/universe-ci.yml`
   runs, listed in `CONTRIBUTING.md`. CI answers from fixtures, so passing it is
   necessary and not sufficient.
2. **Promote `develop` to `main`** through a pull request.
3. **Build the artifact** by dispatching the release artifact workflow against
   the commit being released.
4. **Install, preflight, cut over** with `scripts/universe/release.sh`, which is
   installed on the deployment host. It installs the release beside the running
   one and switches only after every gate passes.
5. **Tag and publish.** Tag the released commit `universe-YYYY.MM.DD`, adding
   `.N` if it is not the first release that day, and publish a GitHub release
   from that tag.
6. **Record the evidence.** `docs/operations/RELEASE-EVIDENCE-<date>.md` is
   where a release's measurements are written down.

`docs/operations/DEPLOYMENT.md` has the full procedure with the exact commands.

## What the gates check

`release.sh preflight` runs against the release that is about to serve traffic,
before anything switches. These gates exist because the previous release passed
every check in CI and still shipped a Charts page and a Mining dashboard whose
backend routes were never mounted. What was wrong was the configuration of the
machine, and nothing in a fixture suite can see that.

| Gate | What it refuses |
| --- | --- |
| release present | an artifact missing the backend build, the frontend build, the gateway, the bundled mining pool metadata, or its own manifest |
| manifest matches | a manifest and a release directory that name different commits |
| configuration coherent | statistics on with the database off, statistics on with the mempool backend off, block indexing set with the database off. Each of those advertises a feature nothing would serve |
| database | a configured database that does not accept a connection |
| address backend | `MEMPOOL.BACKEND` set to `none` while the site still offers address search, and a configured index that cannot answer the three questions an address page asks. An open port is not an answer |
| sources parse | a protocol source registry that does not parse. Parsing is all or nothing, so one invalid descriptor disables the whole registry rather than serving partially trusted data |
| readable protocols have authorities | a protocol the build presents as readable with no authority behind it |
| private listeners | a service listening on a public interface that has not been declared |

After the switch, the cutover verifies a live address lookup, a live socket,
and that the three components report the identities the manifest expects. A
failure at that point rolls back rather than standing.

Rollback is a single flip back to the previous release directory, because a
release is installed beside the running one rather than over it.

## Between releases

`scripts/universe/synthetic-check.mjs` runs against the public origin on a
timer, and hourly in CI through
`.github/workflows/universe-production-smoke.yml`. It exercises the same path a
reader takes, including the edge and TLS.

It fails on a feature advertised with no routes behind it, a statistics range
that answers with nothing, a protocol marked readable whose authority cannot
answer, a configured authority that published no checkpoint, and a frontend and
backend reporting different builds.

```bash
node scripts/universe/synthetic-check.mjs https://explorer.bitcoinuniverse.io
node scripts/universe/protocol-contract.mjs --against https://explorer.bitcoinuniverse.io
```

The second one fails when a deployment serves a protocol roster that differs
from the copy pinned in `docs/protocols/PROTOCOL-COVERAGE.json`.

## Upstream releases are not ours

Upstream tags are preserved in this repository because the complete upstream
Git history is preserved. A tag like `v3.3.1` belongs to upstream's release
line, not to this fork. Only `universe-*` tags are releases of this fork.
