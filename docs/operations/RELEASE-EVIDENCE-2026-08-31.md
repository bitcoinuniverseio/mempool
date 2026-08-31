# Release evidence, 2026-08-31

What was measured, on what, and what it said. Figures here are readings, not
targets: where something did not reach a release threshold this records the
number rather than the intention.

The short version: the release line is promoted, the artifact is built and its
checksum verified on the deployment host, and the cutover is refused by the
release tool's own preflight. The refusal is correct. This release is NO-GO on
the production evidence gate until the address index finishes its first sync.

## What was promoted

`develop` carried ten commits `main` did not. A three dot comparison of the
trees reported zero files differing in the other direction, so `main` held no
content that `develop` was missing; its eight lead commits were the earlier
`develop` to `main` merge commits.

| step | pull request | result |
| --- | --- | --- |
| mobile and adaptive layout across the route registry | #53 | squashed to `develop` as `b4061a9b5` |
| explorer release promotion | #55 | merged to `main` as `7c18c8dff` |

PR #53 merged with all eight checks green on its exact head, including the three
visual matrix shards and the expanded mobile gate. PR #55 merged with all five
required contexts green.

One reading worth keeping: two Universe CI runs raced on the same `develop`
head, a `push` run and a `pull_request` run. The `push` run's backend job failed
and the `pull_request` run's backend job passed on the identical commit. The
failure did not reproduce and the job was retried green on the same tree, so it
is recorded as runner contention rather than a defect in the commit.

## The artifact

Built by `Universe release artifact` on the self hosted fleet, dispatched
against `main`, run `33414006571`.

| reading | value |
| --- | --- |
| commit | `7c18c8dff0e9bb6d6d1b7c51574df71dc7cbd58a` |
| artifact | `mempool-7c18c8dff.tar.gz`, 3,098,102 bytes |
| sha256 | `e7b094cad33ccb23a81cc17c21dcb5ad7e3a34863fca1d83e3f9daeffa13f7b9` |
| manifest commit | matches the dispatched commit |

The checksum was recomputed after transfer to the deployment host and agreed
with the value the runner wrote at pack time. A release directory for this
commit was already present on the host from a separate build of the same
source; its `backend/dist/index.js` hashes to
`3788dc4cb991b664610bf6f8db400661fbe0f6de8d5cdfc75fe7d08345182b11`, which is the
same file the packed artifact carries, so the installed tree and the built
artifact are the same bytes despite different manifest build timestamps.

## Why the cutover did not happen

`universe-explorer-release preflight 7c18c8dff`:

```
manifest names 7c18c8dff
configuration is coherent
database accepts connections
FAILED: MEMPOOL.BACKEND is none, so every address, script hash and UTXO lookup
would fail while the site still offers them
```

This is the gate that did not exist when the address family shipped broken, and
it is doing exactly what it was added to do. `MEMPOOL.BACKEND` in
`/etc/universe-explorer/backend.json` is `none`. Prepared but unactivated
`backend.json.esplora-ready` and `gateway.env.esplora-ready` sit beside it.

Switching that value to `esplora` would not pass either, and would be the wrong
move. For `esplora` the preflight makes real requests of the index, and the
index is not answering yet.

## The address index

`universe-explorer-electrs` is running its first history index.

| reading | value |
| --- | --- |
| history indexed to height | 550,000 |
| chain tip | 964,897 |
| elapsed | 21 hours |
| written | 566 GB |
| `127.0.0.1:3001` HTTP | no answer |
| `/data/indexers-c` free | 786 GB of 1.9 TB |

The remaining blocks are the larger ones, so the height fraction overstates
progress. The volume is shared with ord-tap, the Fractal node and the explorer's
own working data, and an index that fills it takes those down with it, so the
free space figure is a release reading and not an aside.

## Live origin

Read directly from `https://explorer.bitcoinuniverse.io` while the above was
true:

| reading | value |
| --- | --- |
| `releaseSha` from `/api/v1/capabilities` | `2d88cef` |
| capability keys published | `statistics`, `mining` |
| `addressLookup` capability | absent |
| `/api/address/{addr}` | HTTP 405, "Address lookups cannot be used with bitcoind as backend." |

The deployed release predates the address index work, so the origin publishes no
address capability at all, and nothing on the page states whether it can serve
one. The hourly production smoke has been failing continuously on exactly this,
across runs `33340106169`, `33345192901`, `33366744712` and `33406849973`.

## Authorities that publish no checkpoint

The same smoke run reports two protocols configured as readable that cannot
prove it.

| authority | reading |
| --- | --- |
| `index-dmt` | unit was `failed`, killed by a stop timeout after 1h 28m, never auto restarted. Started for this release, bound `127.0.0.1:3247`, did not accept a connection during a 22.8 GB candidate database warmup, and was stopped again. |
| `index-mezcal` | unit running, `/ready` answers 503, `/v1/checkpoint` requires bearer authentication |

Neither is a fabricated empty result anywhere in the product: the overlay
carries them as configured sources and the smoke gate fails the release rather
than reporting them as quiet. That is the correct behaviour and it is also the
reason this release cannot claim those two protocols.

## Standing verdict

| gate | state |
| --- | --- |
| protected promotion | met, `main` at `7c18c8dff` |
| artifact and checksum | met |
| install beside running release | met |
| preflight | refused, `MEMPOOL.BACKEND` is `none` |
| cutover | not attempted, preflight refused |
| production smoke | failing, address family and two authority checkpoints |

The next action is not a code change. It is the address index finishing its
first sync, after which `backend.json` moves to the prepared `esplora`
configuration, preflight is run again, and the cutover proceeds only if it
passes. Nothing above should be read as the explorer having shipped.
