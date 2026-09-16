# Lightning HTLC/PTLC Congestion and Jamming Resilience Center

## Current implementation

The candidate reads explicitly published owned LND channel snapshots and offers a deterministic HTLC constraint calculator. It does not infer network-wide health, jamming intent, payment failure probability, onion queue activity, hold-duration history, PTLC support or deployed mitigation effectiveness. Unknown metrics remain null and the UI labels them unknown. Existing overview, HTLC, onion, channel, node, simulator and mitigation routes remain available.

Full acceptance still requires cooperating sensor coverage, historical hold observations, calibrated incident detection, onion queue instrumentation and storm simulation, reputation/fast-lane simulation, observed mitigation deployment and real owned-node validation. These requirements are open; removing fabricated values is not full GO. No topology or multi-hop route-survival model was present in the original backend contract; no graph resilience is claimed by the calculator.

## Owned source configuration

Reading channels requires `LIGHTNING.ENABLED=true`, `LIGHTNING.BACKEND=lnd`, the existing LND REST/TLS/macaroon configuration, and `UNIVERSE_LIGHTNING_RESILIENCE_PUBLISH=1`. The latter explicitly enables publication of owned channel identities, balances and aggregate pending value through the existing public endpoints. Without it, no channel RPC or credential read occurs. Operators must decide whether publishing these aggregates is appropriate. A scoped read-only macaroon needs only GetInfo and ListChannels; no wallet, send or channel mutation permission is needed.

LND getinfo must report exactly this backend's Bitcoin network and be synced to chain. The adapter uses fixed GET /v1/getinfo and /v1/channels paths, validates TLS, forbids redirects, and bounds each response to 8 MiB and each RPC to 10 seconds. Shared in-flight reads prevent request storms. Callers time out after 10 seconds, cached observations expire after 30 seconds, and stale data is never relabeled current. At most 1,000 channels and 966 unresolved HTLCs per channel are accepted. All records, amounts, directions, uniqueness, identity, network and freshness are checked. Payment hashes, preimages and individual HTLC records are never returned.

Incoming occupancy uses local constraints; outgoing occupancy uses remote constraints. Combined utilization requires both directional capacities. Missing limits stay unknown. Snapshot occupancy cannot diagnose jamming. The browser refreshes every 15 seconds, clears evidence on network changes, and suppresses stale responses.

Unavailable sources produce overview source.status=unavailable with null observed totals. Channel/node reads return typed 503; malformed identifiers return 400 and absent entities in a valid current observation return 404. Incidents remain empty with explicit unknown detection status. CLN, Eclair and LDK telemetry adapters remain unimplemented.

## Constraint calculator

POST /api/v1/intelligence/lightning/resilience/simulate accepts LightningSimulationParams. Required integer fields include channel capacity, negotiated directional slot count, pending value limit, offered HTLC count, hold seconds, and legacy traffic/routing-fee fields. The UI supplies zero for traffic and ordinary routing fees, which cannot establish realized revenue or failure probability here.

For exact occupancy supply attacker_htlc_value_sats. With positive hold time, accepted offers equal the minimum of offered count, slot capacity, floor(pending value limit / per-HTLC value), and an optional immediate circuit_breaker_slot_quota. Zero hold produces zero concurrent occupancy. Missing per-HTLC value yields an upper bound and null exact liquidity. Slot count is bounded at 483; supply the actual negotiated directional limit, which can be lower for the channel type.

Hypothetical unconditional fees equal accepted count multiplied by upfront msat plus hold-fee msat/second multiplied by hold seconds. This is a counterfactual fee schedule, not proof of deployment or collection. Ordinary routing fees are not counted as realized attacker cost or routing revenue. Honest failure probability and mitigation effectiveness remain unknown. An enabled flag alone establishes neither.

The channel starts empty and offers arrive simultaneously. The calculator sends no payments and performs no graph routing, queue simulation or empirical calibration. Runtime validation rejects coercion, nonfinite/fractional/negative values, inconsistent capacity/quota settings and exact fee arithmetic overflow.

## Validation and open evidence

Local tests cover directional derivation, all-record validation, wrong network, stale source, coalesced reads, no stale fallback, publication gating, bounded fixed-path RPC, HTTP 400/404, exact quotas and fees, zero inputs, malformed inputs, network changes, stale responses, route changes, errors and unknown rendering.

The owned Signet configuration currently disables Lightning. Candidate ephemeral HTTP checks establish truthful disabled-source behavior and calculator outputs; no real LND telemetry or calibrated attack/mitigation journey has been demonstrated.

Primary references:

- [BOLT 2](https://github.com/lightning/bolts/blob/master/02-peer-protocol.md): negotiated directional HTLC limits; 483 is a protocol bound, not a universal consensus slot count.
- [LND ListChannels](https://api.lightning.community/api/lnd/lightning/list-channels/index.html): pending HTLCs and local/remote constraints.
- [Lightning Labs Circuit Breaker](https://github.com/lightninglabs/circuitbreaker): a project reference, not evidence of an installed mitigation.
