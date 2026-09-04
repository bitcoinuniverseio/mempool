# Lightning HTLC/PTLC Congestion and Jamming Resilience Center

## Product Overview
The Lightning HTLC/PTLC Congestion and Jamming Resilience Center is an observatory and telemetry dashboard providing real-time visibility into channel slot exhaustion, liquidity locking, onion message queue saturation, and proactive defensive mitigations across the Lightning Network.

## Problem Statement
Lightning Network routing channels are vulnerable to denial-of-service and liquidity griefing attacks:
- Channel Slot Exhaustion: Each commitment transaction is limited to a maximum of 483 concurrent HTLC slots by consensus constraints. Attackers can flood dust or slow-settling HTLCs across channels, blocking payment routing without risking significant capital.
- Liquidity Pinning: Attackers can lock liquidity in long-duration holds across multiple hops, reducing the capital efficiency of routing operators.
- Onion Message Flooding: High-frequency unendorsed onion messages can exhaust node CPU and memory buffers.
- Fragmented Mitigations: Different implementations (LND, Core Lightning, Eclair, LDK) have proposed distinct defensive schemes (upfront fees, reputation-based slot allocation, local circuit breakers) without unified telemetry.

## Architecture and Subsystems

### 1. Privacy-Preserving Telemetry Collector
Gathers aggregated routing statistics from cooperating public routing nodes:
- Aggregates HTLC slot utilization percentages without revealing individual payment amounts, preimages, or payment hashes.
- Tracks P95 and P99 hold durations for in-flight routing attempts.

### 2. Congestion & Jamming Incident Detector
Detects statistical anomalies matching jamming signatures:
- Identifies sudden surges in unendorsed micro-HTLC holds.
- Generates transparent incident alerts with automated recommendations for node operators (such as adjusting peer quotas or tightening cltv_expiry_delta).

### 3. Onion Message Queue Monitor
Tracks hop-by-hop message delivery rates, queue buffer occupancy, and token-bucket rate limiter states across participating nodes to protect against message-amplification attacks.

### 4. Attack and Mitigation Simulator
Provides a deterministic local simulation sandbox:
- Evaluates channel survival rates under slot-exhaustion attacks, slow-hold liquidity pinning, and onion messaging storms.
- Measures the defensive efficacy of upstream reputation endorsement schemes, dual-bucket slot isolation (fast-lane vs unendorsed), and holding fees.

### 5. Defensive Mitigation Registry
Documents and indexes emerging Lightning specifications and implementation pull requests:
- BLIP-0004 / Local Reputation Scheme.
- Hold-fee and unconditional upfront fee proposals.
- Circuit breaker policies and token-bucket rate limiters.

## User Interface Routes
- `/lightning/resilience`: High-level network health, monitored channel aggregates, and active congestion incidents.
- `/lightning/resilience/htlcs`: Deep breakdown of commitment transaction slot pressures and in-flight hold durations.
- `/lightning/resilience/onion-messages`: Onion messaging queue depths, throughput rates, and throttling status.
- `/lightning/resilience/channel/:shortId`: Channel-specific slot usage, endpoint identities, and policy configurations.
- `/lightning/resilience/node/:publicKey`: Node resilience score, circuit breaker status, and peer endorsement settings.
- `/lightning/resilience/simulate`: Dynamic jamming attack simulator and policy testing bench.
- `/lightning/resilience/mitigations`: Comprehensive index of standardized anti-jamming specifications.
