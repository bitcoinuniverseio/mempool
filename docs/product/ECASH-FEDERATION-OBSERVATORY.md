# Ecash and Federation Observatory

## Overview
The Ecash and Federation Observatory delivers independent telemetry and protocol verification for Chaumian ecash systems on Bitcoin, spanning Cashu mints and Fedimint federations. It features verified directory indexes, supported NUT standard detection, federation guardian tracking, and private client-side token inspection.

## Architecture and Privacy Guarantees
1. **Cashu Mint Telemetry**:
   - Automated polling of `/v1/info` endpoints and keyset active state.
   - Capability matrix tracking supported Notation Units of Technology (NUTs 00 through 17).
2. **Fedimint Federation Diagnostics**:
   - Tracking of consensus guardians, threshold BFT quorums, session epochs, and multi-signature federation balance backing.
3. **Client-Side Secret Redaction**:
   - Cashu token strings (`cashuA...`, `cashuB...`) and Fedimint invite codes (`fed11...`) are parsed completely in the user's browser.
   - Secret blinding parameters and private unblinded tokens are never dispatched to any backend server.
4. **Signed Provider Claims**:
   - Mint and federation operators can publish signed cryptographic claims attesting to operational identity, reserve proofs, and auditing reports.

## Endpoints and Routes
- `/ecash`: Macro overview of ecash adoption, active mints, federations, and supported standards.
- `/ecash/cashu`: Directory of verified Cashu mints with protocol features and keyset lifecycles.
- `/ecash/cashu/:mintId`: Detailed endpoint inspection, contact info, and active keysets for a specific Cashu mint.
- `/ecash/fedimint`: Catalog of public Fedimint community and institutional federations.
- `/ecash/fedimint/:federationId`: Federation guardian status, quorum thresholds, and consensus epoch history.
- `/ecash/inspect`: Private, offline in-browser inspector for Cashu e-cash tokens and Fedimint invitation codes.
