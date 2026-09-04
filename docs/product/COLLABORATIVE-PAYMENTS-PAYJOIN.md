# Collaborative Payments and Payjoin Center

## Overview
The Collaborative Payments and Payjoin Center accelerates the adoption of collaborative transaction standards, specifically BIP78 (Original Payjoin) and BIP77 (Serverless / Asynchronous Payjoin). It provides proposal analysis, broken clustering heuristic visualization, public directory observation, and a safe interactive regtest playground.

## Key Capabilities
1. **Proposal Comparison Engine**:
   - Compares original PSBT proposals against receiver-augmented Payjoin PSBTs.
   - Quantifies the obfuscation of Common Input Ownership Heuristic (CIOH) and subset-sum change detection.
2. **Directory Observatory and OHTTP Keys**:
   - Health and uptime tracking of public Payjoin directory servers.
   - Rotated Oblivious HTTP (OHTTP) key discovery and cryptographic expiration tracking.
3. **Interactive Sandbox Playground**:
   - Safe simulated lifecycle demonstrating sender proposal, receiver input injection, fee contribution adjustment, and final signature aggregation.
   - Export of raw PSBT proposals and final transaction payloads.
4. **Compatibility Matrix**:
   - Empirical feature matrix tracking active wallet support across Bitcoin Core, Liana, Sparrow, Wasabi, BTCPay Server, and custom implementations.

## Endpoints and Routes
- `/payments/payjoin`: Collaborative payments overview, privacy metrics, and adoption statistics.
- `/payments/payjoin/analyze`: Interactive proposal analyzer comparing baseline PSBT with Payjoin PSBT.
- `/payments/payjoin/directory`: Public directory health monitor and OHTTP gateway keys.
- `/payments/payjoin/compatibility`: Comprehensive wallet, server, and protocol compatibility matrix.
- `/payments/payjoin/playground`: Safe step-by-step interactive sandbox demonstrating Payjoin transaction creation.
