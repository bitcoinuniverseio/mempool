# Discreet Log Contract and Oracle Verification Center

## Overview
The Discreet Log Contract (DLC) and Oracle Verification Center provides a comprehensive, read-only analytics, verification, and simulation suite for Discreet Log Contracts and oracle networks. It enables trust-minimized verification of oracle announcements and attestations, contract package inspection, multi-oracle outcome analysis, and regtest-only contract simulations.

## Noncustodial and Privacy Guarantees
1. **Zero Key Custody**:
   - The platform never holds private keys, signs transactions, or executes financial trades.
   - The platform broadcasts no funding, CET, or refund transactions.
2. **Local Browser Verification**:
   - Sensitive contract packages (DLC offer, accept, sign, CETs) are verified locally within the user's browser.
   - Private contract details remain strictly local unless the user explicitly exports a sanitized report.
3. **Evidence-Based Disagreement Detection**:
   - Cryptographic detection of oracle nonce reuse and equivocation.
   - Non-accusatory evidence status tracking: suspected conflict, cryptographically verified conflict, insufficient evidence, or invalid evidence.
4. **No Arbitrary On-Chain DLC Claims**:
   - DLC transactions intentionally conceal contract terms on chain.
   - DLC associations are visualized only when a user-supplied contract package or verified public registration provides explicit linkage.

## Architecture and Protocol Standards
- **Specification**: Pinned to DLC TLV specification draft revisions.
- **Cryptography**: Schnorr signatures (BIP340), tagged hashing, and adaptor signature verification.
- **Multi-Oracle Combinations**: Support for single oracle, n-of-n, and t-of-n threshold configurations with numeric outcome rounding intervals and exact satoshi collateral conservation.

## Routes and Navigation
- `/contracts/dlc`: DLC ecosystem overview, pinned specification tracking, and verified activity metrics.
- `/contracts/dlc/oracles`: Public oracle directory with endpoint health, public keys, and reputation scores.
- `/contracts/dlc/oracle/:oracleId`: Detailed oracle view including historical announcements and attestations.
- `/contracts/dlc/events`: Verified event calendar across numeric and enumerated outcome descriptors.
- `/contracts/dlc/event/:eventId`: Event detail with announced nonces, outcome domain, and attestation signatures.
- `/contracts/dlc/inspect`: Local contract package inspector for offer, accept, sign, CET, and refund files.
- `/contracts/dlc/simulate`: Regtest contract execution simulator modeling settlement, timeouts, and outages.

## API Contracts
- `GET /api/v1/intelligence/dlc/overview`: High-level metrics and recent verified event stream.
- `GET /api/v1/intelligence/dlc/oracles`: Registered oracle directory and reachability indicators.
- `GET /api/v1/intelligence/dlc/oracles/:oracleId`: Specific oracle metadata and public key.
- `GET /api/v1/intelligence/dlc/events`: Scheduled and concluded DLC events.
- `GET /api/v1/intelligence/dlc/events/:eventId`: Complete event specification and attestation status.
- `POST /api/v1/intelligence/dlc/announcements/verify`: Validation of oracle announcement signatures and TLVs.
- `POST /api/v1/intelligence/dlc/attestations/verify`: Verification of oracle attestation signatures and nonce alignment.
- `POST /api/v1/intelligence/dlc/contracts/verify`: Mathematical verification of contract collateral conservation.
- `POST /api/v1/intelligence/dlc/simulations`: Regtest simulation orchestration.

## Oracle signature verification implementation

Announcement and attestation checks now execute BIP340 verification through tiny-secp256k1. Requests explicitly declare either dlcspecs-tagged-v0 or rust-dlc-legacy-sha256 because spec-tagged and historical library profiles differ; the verifier never silently tries another scheme. Event descriptor serialization, NFC UTF8, every nonce, maturity and event ID are bound into the announcement. Attestations require the full verified announcement and exact key, event, allowed outcome and ordered nonce matching. Details, limits, independent vectors and source revisions are in `tools/dlc-verification/README.md`.

The public signature verifier is available on the oracle directory and event-detail pages even while the registry is unavailable. It does not claim that a signed outcome is true. Cross-event conflict status remains unknown without separate evidence. Catalog/crawler observations, adaptor signatures, funding/CET/refund execution and simulation are still OPEN gates; oracle signature verification does not close them.
