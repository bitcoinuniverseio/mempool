# Support

Universe Explorer is the block, mempool, and asset-protocol explorer behind
[explorer.bitcoinuniverse.io](https://explorer.bitcoinuniverse.io). This page
says where to take a question, and which questions this repository can actually
answer.

## Before you ask: the explorer usually says why

Most reports about a missing figure turn out to be a state the product already
publishes. Check these first, because they name the cause in plain words.

| Question | Where the answer already is |
| --- | --- |
| Is a chain answering, and how far behind is it? | The status rail on that chain's overview page, and `GET /api/v1/<chain>/status` |
| Which protocols can be read right now? | The protocol directory at `/protocols`, and `GET /api/v1/universe/protocols` |
| Is a protocol indexer behind or not answering? | `GET /api/v1/universe/sources`, which reports each authority's checkpoint, lag, and status |
| Are the charts, mining, or address pages actually served by this deployment? | `GET /api/v1/capabilities`, which reports whether each feature's routes were mounted and whether its dependencies are reachable |
| Which commit is deployed? | `GET /api/v1/backend-info`, and the `/source` page |

An empty asset panel that says "outside coverage" or "unavailable" is a
truthful answer about an authority, not a defect. A panel that says "complete"
and shows a wrong figure is a defect.

## Where to raise something

**This repository's issue tracker is turned off.** That is deliberate: a
change, its reasoning, its review, and its checks stay in one record. A pull
request is the durable place to raise anything.

- **A bug, a wrong figure, a broken page, or a documentation error.** Open a
  pull request against `develop`. Describe what you saw, on which page or
  endpoint, and what you expected. Leave the diff empty if you have nothing to
  change yet. [CONTRIBUTING.md](CONTRIBUTING.md) has the conventions and the
  checks a change has to pass.
- **A security vulnerability.** Do not open a pull request, and do not put it
  in a commit message. Both are public the moment they are written. Use
  GitHub's private vulnerability reporting:
  [open a report](https://github.com/bitcoinuniverseio/mempool/security/advisories/new).
  [SECURITY.md](SECURITY.md) has what to include and what is in scope.
- **A question about running your own deployment.** Read
  [`docs/operations/INSTALL.md`](docs/operations/INSTALL.md) and
  [`docs/operations/CONFIGURATION.md`](docs/operations/CONFIGURATION.md) first,
  then open a pull request against the document that failed you.

## What is in scope here

This repository holds the explorer frontend, the forked explorer backend, and
the gateway. Issues about those belong here.

Two things that affect the explorer are owned elsewhere, and a report about
them is better filed against the owning repository:

- **The Universe protocol overlay** serves `/api/v1/universe/*`,
  `/api/v1/chains`, and the per-chain surfaces. It lives in
  `bitcoinuniverseio/backend-apis`, and it owns the protocol roster this
  repository pins a copy of in `docs/protocols/PROTOCOL-COVERAGE.json`.
- **The protocol indexers** (`ord`, `index-opinscriptions`,
  `index-zcash-metaprotocols`, and the rest) are separate services. When
  `/api/v1/universe/sources` reports one as degraded or stale, the explorer is
  reporting that authority accurately; the fix is in the indexer, not here.

## What this project does not provide

- No support for using the upstream Mempool Open Source Project. Take those
  questions to [mempool/mempool](https://github.com/mempool/mempool). See
  [UPSTREAM.md](UPSTREAM.md) for the exact relationship.
- No account recovery, wallet support, transaction acceleration, or help
  moving funds. The explorer is read only and has no accounts.
- No investment, trading, or valuation advice.
- No private data lookups. Everything the explorer can answer is public chain
  data, and the shielded side of Zcash is not part of it.

## Response expectations

This is a working repository, not a staffed support desk. Pull requests are
reviewed as maintainers get to them. Security reports are prioritized over
everything else. Nothing here carries a service level agreement, including for
the public deployment.
