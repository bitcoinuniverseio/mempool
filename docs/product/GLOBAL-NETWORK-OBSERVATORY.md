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

## Owned-source implementation status

The current implementation uses the owned Core peer set; it does not implement
a global crawler or independent BIP324/BIP155 handshake engine. DNS seeds are
resolved on request and cached. The self-check performs a real, bounded TCP
connection to a public pinned address and leaves BIP324 handshake evidence null.
No geography/ASN source is connected. These limits supersede the broader target
capabilities listed above; the remaining crawler, handshake, archive and owner
claim capabilities still need separate acceptance.

Relay consumers share a 30-second Core snapshot and single in-flight RPC read.
The shared relay accessor verifies genesis/network and exposes source timestamp
and age. Callers have a ten-second wait bound; failures do not relabel stale data
as fresh. See [Relay observatory](RELAY-OBSERVATORY.md) for actual local collection,
stream bounds, provenance and remaining distributed-sensor requirements.
