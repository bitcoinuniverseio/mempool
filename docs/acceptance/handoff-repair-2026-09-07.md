# Handoff repair, 7 September 2026

Source: the read-only audit handoff `mempool_HANDOFF_2026-09-07.zip`
(verdict FUNCTIONAL NO-GO, findings F-01 to F-08, S-01, S-02, B-01 to B-05,
U-01, U-02). This note records what was repaired in code, what was repaired on
the indexer host, what was found underneath the findings, and what remains
blocked. It is written for the next engineer, not as a certificate.

## Root cause found under F-01

F-01 reported `/api/blocks/tip/height` (965905) and `/api/blocks/tip/hash`
(block 965912, later 965975) naming different blocks. Two causes, both real:

1. The two routes read different authorities: the height from the block
   cache, the hash straight from Core. They now read the same completed
   block through `indexedCheckpoint`, and answer 503 together when no
   completed block is cached. Core's own progress stays in
   `/api/v1/backend-info` under `chainSync`.
2. The block cache had stopped at 965905 because the backend's main update
   loop had been hung since 10:51 UTC: no block, mempool or exception log
   line for eleven hours, mempool count frozen at 46,554 while Core held
   42,645, process at 0% CPU. The Electrum client library resolves a request
   only when the server answers with its id and clears its socket timeout
   after connecting, so a dropped reply waits forever, and every log line the
   loop writes sits after the await that never returned.

Repairs: every Electrum request now carries a 60 s deadline
(`electrum-deadline.ts`); the `$updateBlocks` and `$updateMempool` stall
timers repeat every two minutes instead of firing once; and a loop-level
watchdog (`main-loop-watchdog.ts`) marks the mempool out of sync after ten
minutes without a finished run and exits after thirty so `Restart=always`
brings a fresh process back. The hung backend was restarted on the host at
21:56 UTC and was in sync at 965978 three minutes later.

## Code repairs in this repository

| Finding | Change | Tests |
|---|---|---|
| F-01 | tip height and hash from one cached block; 503 when none | `bitcoin-tip-checkpoint.test.ts` |
| F-01 cause | Electrum deadline, repeating stall timers, loop watchdog | `electrum-deadline.test.ts`, `main-loop-watchdog.test.ts` |
| F-05 | ANIMA list pages keep the typed 503/502 document; transport, malformed, unconfigured and unavailable are distinct; a failed next page keeps every item, shows the reason, offers Retry on the same continuation, and appends without duplicates; subscriptions end with the component | `anima-failure.spec.ts`, `anima-items.component.spec.ts` |
| F-06 | a BLOCKED release with declared read operations is no longer "Not implemented"; the live label comes from the authority and the qualifier reads "Read only, not verified" | `protocol-directory.component.spec.ts` |
| F-07 | the status rail chip (`.status-rail .universe-chip`, from the `universe-chip` mixin in `_universe-tokens.scss`) wraps instead of `nowrap`, so "History unavailable · Address history needs attention …" fits a 390 px reading | visual check of the built page |
| S-02 | `/__gateway/health` answers `{"status":"ok"}` with no filesystem path; the release script only waits for the route | `gateway.test.mjs` |

## Repairs in backend-apis

PR bitcoinuniverseio/backend-apis#188: index-anima's status document names
its network `main` (Bitcoin Core's word) and was judged malformed, which is
why the authority was never in the roster; it now reads as mainnet and its
`scanner.tipHeight`/`tipHash` is the checkpoint. The Dogecoin dune catalog
answered 404 object-not-found because the deployed ord-dogecoin (4584da8)
predates the catalog route (cf32233); an unserved collection now answers 501
`dogecoin-protocol-collection-not-served`.

## Host findings (universe-indexers, read-only inspection)

- Memory: 64 GB RAM, 92 GB of 98 GB swap in use, 25 to 33 processes blocked
  on I/O, iowait 72 to 87%. `getblockcount` took 7.6 s. This is the shared
  cause behind the transport timeouts in F-02, F-04 and B-05. Largest swap
  holders: universe-explorer-electrs 25.8 GB, ord-dogecoin-full 14.3 GB,
  ord 0.29 11.3 GB, Fulcrum 8.2 GB, bitcoind 6.1 GB, atomicals-electrumx
  5.8 GB. The host runs two Bitcoin address indexes (electrs for `/api/*`,
  Fulcrum for the backend). Reducing this is a capacity decision.
- index-anima runs at 127.0.0.1:8788 and serves `/anima/status` and
  `/anima/events`; it was missing from `UNIVERSE_EXPLORER_SOURCES_JSON`.
- drops-opdrop API serves 127.0.0.1:3010 and 3011 (`/drops/token-explorer`,
  `/op-drop/token-explorer`, bearer token `OP_DROP_TOKEN_EXPLORER_BEARER_TOKEN`
  in its own env); missing from the roster.
- chainbloom serves 127.0.0.1:3012 (`/v1/chainbloom/worlds` 200, `/health`
  200, `/ready` 503 not leader); missing from the roster.
- index-stamps (3045) is in uninterruptible sleep with 30 MB resident of a
  9.9 GB process: swapped out, not answering `/ready` within 40 s.
- index-alkanes (3044) is in provider backoff since 2 September: "Alkanes
  block 899092 exceeds the 2000 event contract limit" (`alkanes-trace.mjs`).
- index-atomicals token explorer answers `TOKEN_EXPLORER_SOURCE_DISABLED`;
  its arc20 feed route is 404; the ElectrumX behind it times out.
- index-op20 (38323) and index-opinscriptions (38324) are SSH tunnels; op20
  `/status` hangs past 60 s.
- index-dmt: "immutable feed generation is building".
- No service exists on the host for names, bitmap, unat, dust20, block20,
  patina, witness_circles, tandem, cat20 or ordex. index-brc20 has an HTTP
  explorer (`src/server.mjs`) that is not deployed; only the OPI light
  client runs.
- Dogecoin Blockbook runs but cannot sync: `dogecoind` was bootstrapped
  from a snapshot and lacks blocks before about 4.7 M. F-03 stays blocked
  on a full-history node.

## Status after this repair

Repaired and retested locally: F-01 and its cause, F-05, F-06, F-07, S-02,
F-08 (truthful contract; the catalog itself needs an ord-dogecoin rebuild
and a restart of an indexer still catching up, which is not permitted).
Repaired on the host: the hung backend. Blocked with exact cause: F-02 and
F-04 for every authority listed above, F-03, B-05. Not executed: the 1,587
inherited obligations and any Signet journey. Functional acceptance remains
NO-GO; the exact rows are in the handoff's coverage files.
