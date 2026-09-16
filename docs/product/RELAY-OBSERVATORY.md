# Relay and policy observatory

## Current observed capability

The relay API combines the configured backend's real mempool poll deltas with
peer metadata from the owned Bitcoin Core node. It exposes one local observer,
not a distributed sensor fleet. No region, calibrated clock offset, global
latency percentile, policy divergence, rejection reason or per-transaction
transport is invented.

Core `getpeerinfo` supplies connected-peer v1/v2 transport counts. Unknown
transport metadata stays unknown; percentages use only peers with known
transport. `getnetworkinfo` supplies client/protocol version and the actual
minimum relay fee. `getmempoolinfo.fullrbf` is reported only when present.
Erlay capability remains unobserved. No peer addresses or identifiers are exposed
by the relay API.

Core reads share an in-flight request with the global-network service and cache
for at most 30 seconds. Relay use checks the owned node's genesis against the
configured network. Callers wait at most ten seconds; a hung underlying request
continues to be shared rather than starting duplicate RPC work. Refresh failure
returns 503 instead of serving an old peer snapshot as fresh. Missing policy
metadata is represented as unknown separately from available peer metadata.

## Collection and provenance

`relayCollectorService.observeMempoolPoll(added, removed, complete)` receives only
the current poll's additions and removals. `markPollFailure()` interrupts the
observation interval after a failed main-loop poll. The index hooks invoke both.

Each retained event includes network, observer/worker identity, sequence, random
ID, local observation timestamp, a SHA256 payload digest, poll completeness and
the previous successful complete poll when continuity is known. Detection time
is not P2P arrival time. Clock offset/uncertainty are null and clock regressions
are counted. A departure means the transaction left the local mempool; it does
not establish rejection, replacement, confirmation or eviction without further
evidence. Repeated identical presence updates are deduplicated; later reentry is
retained.

Bounds are 10,000 transaction histories, 16 events per transaction, 24 hours of
retention, and 10,000 processed delta entries per poll. Discarded entries and
per-transaction pruning are explicit. Poll collection reports not-started,
observing, interrupted or stale independently from Core peer-source freshness.
History is in process memory and is lost on restart. In a cluster, the observer
identity includes the stable worker ID; querying the same history across requests
requires sticky routing. It is not a shared durable archive.

## API and UI

- `GET /api/v1/intelligence/relay/overview`: local source scope, freshness,
  retention and actual recent detections.
- `GET .../transactions/:txid`: retained detection history; malformed IDs return
  400, unobserved/expired IDs return 404 with no fabricated sample.
- `GET .../sensors`, `.../transports`: current owned-node metadata.
- `GET .../policy-differences`: actual local policy and explicit unavailable
  multi-sensor comparison, with no synthetic differences.
- `GET .../stream`: network-filtered local SSE detections, capped at 100
  subscribers. Frames and queued response bytes are bounded to 64 KiB. A failed
  write/backpressure closes the slow connection and releases its subscription.
  Disconnects do not replay missing events; heartbeats contain no observations.

The UI uses the selected network, cancels stale searches on edits/network changes,
loads a recent actually observed transaction instead of a fixed sample, and keeps
at most 20 live events. It displays unknown measurements and departures honestly.

## Acceptance still required

Distributed authenticated sensors, calibrated clocks/uncertainty, measured
cross-sensor propagation percentiles, policy divergence probes, replacement
attribution, negotiated Erlay evidence and durable cross-worker history remain
required for the original distributed-observatory scope. Local HTTP, stream,
fixture and rendering tests establish only the implemented local behavior.
