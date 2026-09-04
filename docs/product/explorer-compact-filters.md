# Compact Filter and Light-Client Verification Center

## Overview
The Compact Filter and Light-Client Verification Center provides a dedicated peer-to-peer filter observatory, header-chain verification engine, and privacy-preserving descriptor scanner based on BIP157 (Client-Side Block Filtering) and BIP158 (Compact Size Golomb-Coded Basic Filters).

## Privacy and Network Architecture
1. **Local Descriptor Scanning**:
   - The user's descriptors, xpubs, addresses, and scriptPubKeys NEVER leave the local browser worker.
   - Filters and filter headers are fetched from peers or local cache; matching runs strictly client-side.
2. **Multi-Peer Agreement Verification**:
   - Compares filter checkpoints and filter headers across multiple independent peers.
   - Detects divergent or malicious peers by comparing responses against reference full-block reconstructions.
3. **Bandwidth and Privacy Controls**:
   - Full blocks are downloaded only when a local filter match occurs.
   - Transparent disclosure of query privacy, false-positive probability, and peer observation points.
4. **No Duplicate Full-Chain Index**:
   - Reuses self-hosted Bitcoin Core filter index (`-blockfilterindex`) for authoritative block filter service.

## Core Protocols and Data Flow
- **Standards**: BIP157 peer messages (`getcfilters`, `cfilter`, `getcfheaders`, `cfheaders`, `getcfcheckpt`, `cfcheckpt`) and BIP158 basic filters (type 0x00).
- **Filter Content**: Includes all spent previous output scripts and non-OP_RETURN output scripts for each block.
- **Offline Rescanning**: Stores verified filter headers in browser IndexedDB for fast, offline rescan capabilities.

## Routes and Navigation
- `/network/light-client`: Light-client metrics, peer counts, and tip synchronization status.
- `/network/light-client/providers`: Catalog of active peer providers serving compact filters.
- `/network/light-client/provider/:providerId`: Detailed peer provider reliability, latency, and correctness record.
- `/network/light-client/filters`: Filter explorer displaying raw filter elements, element counts, and header hashes.
- `/network/light-client/verify`: Multi-peer filter-header chain comparison and discrepancy detector.
- `/network/light-client/scan`: Private in-browser descriptor and script scanner with background worker.
- `/network/light-client/privacy`: Light-client privacy documentation and decoy query configuration.

## API Contracts
- `GET /api/v1/intelligence/compact-filters/overview`: Network filter tip, active provider count, and status.
- `GET /api/v1/intelligence/compact-filters/providers`: Directory of observed BIP157 peer nodes.
- `GET /api/v1/intelligence/compact-filters/providers/:providerId`: Provider history, uptime, and validation accuracy.
- `GET /api/v1/intelligence/compact-filters/checkpoints`: Precomputed filter-header checkpoints at standard intervals.
- `GET /api/v1/intelligence/compact-filters/blocks/:blockHash`: Basic filter data and header for a specific block.
- `GET /api/v1/intelligence/compact-filters/ranges`: Available filter index ranges and sync progress.
- `POST /api/v1/intelligence/compact-filters/verifications`: Peer comparison verification and discrepancy analysis.
