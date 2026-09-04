# Global Bitcoin Network Observatory

## Overview
The Global Bitcoin Network Observatory provides real-time and historical visibility into the topology, health, reachable transports, and geographic distribution of the Bitcoin peer-to-peer network. Built on sovereign Universe crawler infrastructure, it eliminates dependency on third-party analytical APIs and operates fail-closed telemetry.

## Architecture and Capabilities
1. **Multi-Protocol P2P Probe Engine**:
   - Supports Bitcoin Core v1 unencrypted P2P transport.
   - Implements BIP324 v2 encrypted transport negotiation and handshake validation.
   - Parses and propagates BIP155 addrv2 gossip records (supporting IPv4, IPv6, Tor onion v3, I2P, and CJDNS networks).
2. **DNS Seed Probe & Discovery**:
   - Continuous scheduled polling of standard DNS seeds.
   - Endpoint reachability validation with strict SSRF defenses rejecting RFC1918 private subnets, loopbacks, and cloud metadata endpoints.
3. **Crawl Epochs and Snapshots**:
   - Periodic network snapshots capturing active node counts, user agent diversity, protocol version distribution, and service flags.
   - Archive snapshots downloadable with SHA256 integrity verification.
4. **Self-Check Wizard**:
   - Sovereign node operators can run a reachability and latency check on their own public node endpoint.
   - Optional node owner claims supported via cryptographic signature verification.

## Endpoints and Routes
- `/network/global`: Observatory Overview and macro topology metrics.
- `/network/global/nodes`: Filterable catalog of active network nodes.
- `/network/global/node/:endpointId`: Deep diagnostic detail for an individual node endpoint.
- `/network/global/snapshots`: Historical network snapshot archive and diff engine.
- `/network/global/seeds`: Real-time health and response time of network DNS seeds.
- `/network/global/self-check`: Noncustodial inbound node reachability test suite.
