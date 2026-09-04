# Silent Payments Center

## Overview
The Silent Payments Center establishes full support for the BIP352 standard within Universe Explorer. It features noncustodial in-browser scanning, block tweak data bundles, address parsing, BIP321 URI decoding, and BIP375/376 PSBT field inspection.

## Architecture and Privacy Guarantees
1. **Client-Side Cryptographic Scanning**:
   - In-browser scan execution via Web Worker.
   - Scan keys and spend secrets NEVER leave the user's local browser environment.
   - Zero key material, intermediate tweak scalars, or private identifiers are logged, sent to servers, or persisted remotely.
2. **Reorg-Safe Block Scan Bundles**:
   - Backend indexes public block manifests containing tweak outputs, public keys, and candidate taproot outputs.
   - Clients download compact block bundles to execute scanning locally in batch.
3. **Address Verification & BIP321**:
   - Validation for mainnet `sp1q...` and signet/testnet `tsp1q...` addresses.
   - Parsing of BIP321 Unified Bitcoin Payment URIs with fallback addresses.
4. **BIP375 and BIP376 PSBT Inspection**:
   - Decoding of BIP375 sending inputs, DLEQ proofs, and ephemeral keys.
   - Decoding of BIP376 spending fields, script-path spends, and input labels.

## Endpoints and Routes
- `/payments/silent`: Silent Payments overview, ecosystem support status, and protocol guides.
- `/payments/silent/scan`: Private in-browser UTXO scanner using local Web Workers.
- `/payments/silent/address`: Address format validator and BIP321 URI generator.
- `/payments/silent/psbt`: Inspector for BIP375 and BIP376 fields in partially signed transactions.
- `/payments/silent/coverage`: Public block tweak manifest index and sync status across chain history.
