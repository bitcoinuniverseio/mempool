# Lightning Reliability, Liquidity, and Channel Lifecycle Center

## Overview
The Lightning Reliability, Liquidity, and Channel Lifecycle Center brings institutional-grade observability and empirical health diagnostics to the Lightning Network. It tracks multi-sensor node reachability, payment liquidity depth, LSP specification compliance, and granular onchain channel closure forensics.

## Key Capabilities
1. **Multi-Sensor Node Reachability**:
   - Continuous ping, handshake, and transport-level liveness probes executed from distributed sensor nodes.
   - Empirical uptime metrics distinguishing transient network partitions from sustained node outages.
2. **Liquidity Availability Semantics**:
   - Path simulation and liquidity confidence estimates derived across public channel graph topology.
   - Real-time tracking of high-capacity routing corridors and fee volatility.
3. **LSP Capability Registry**:
   - Verification and tracking of Lightning Service Provider standards including LSPS0 (transport), LSPS1 (channel purchase), LSPS2 (JIT channels), and LSPS5 (dynamic liquidity).
   - Public endpoint audit and policy inspection.
4. **Channel Lifecycle and Closure Forensics**:
   - Full lifecycle tracing from funding transaction confirmation to spend events.
   - Rigorous classification of channel closing events: cooperative mutual closes, force closes (unilateral commitments), breach remedy penalty transactions, and splice events.

## Endpoints and Routes
- `/lightning/reliability`: Network-wide reliability indices, node uptime percentiles, and health metrics.
- `/lightning/liquidity`: Liquidity distribution, fee regimes, and routing corridor simulation.
- `/lightning/lsp`: Directory of active Lightning Service Providers and verified LSPS capability profiles.
- `/lightning/node/:publicKey/reliability`: Longitudinal reliability, gossip freshness, and historical stability for a specific routing node.
- `/lightning/channel/:shortId/lifecycle`: Comprehensive lifecycle events, funding state, and balance history for a single channel.
- `/lightning/closure/:txid`: Deep forensic analysis of an onchain channel closure transaction.
