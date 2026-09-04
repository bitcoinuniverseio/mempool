# Nostr and Lightning Payment Connectivity Center

## Overview
The Nostr and Lightning Payment Connectivity Center delivers an inspection, diagnostic, and verification suite for decentralized payment connectivity protocols. It covers Nostr Wallet Connect (NIP-47), Lightning Address (LUD-16), LNURL specifications (LUD-01 through LUD-21), and Nostr Zaps (NIP-57) without requiring custody of wallet credentials or private encryption keys.

## Privacy and Endpoint Security
1. **Secret Masking & Zero Key Storage**:
   - NWC connection URIs (`nostr+walletconnect://...`) are parsed with the secret key strictly masked.
   - The platform never stores, logs, or transmits NWC secret keys or wallet signing credentials.
2. **SSRF and Protocol Protection**:
   - LNURL and Lightning Address endpoints are validated strictly over HTTPS with mandatory Server-Side Request Forgery (SSRF) defenses blocking private, loopback, and metadata network ranges.
3. **Cryptographic Zap Verification**:
   - Validates the exact SHA256 linkage between NIP-57 zap requests (event kind 9734) and Lightning invoice description hashes (BOLT11 tag `h`).

## Supported Protocols and NIPs
- **NIP-47 (NWC)**: Connection string validation, relay latency measurement, and permission scope auditing.
- **NIP-57 (Zaps)**: Cryptographic verification of zap receipts (kind 9735), pubkey attribution, and preimage settlement.
- **LNURL Protocol**: Diagnostics for LNURL-pay, LNURL-withdraw, and Lightning Address identifier resolution.

## Routes and Navigation
- `/payments`: Payment connectivity ecosystem dashboard and active relay health summary.
- `/payments/nwc`: NWC overview, connection tester, and permission boundary auditor.
- `/payments/nwc/inspect`: Connection URI parser with secret key masking and capability tests.
- `/payments/nwc/compatibility`: Ecosystem compatibility directory across wallets and client apps.
- `/payments/lnurl`: Interactive LNURL protocol debugger with endpoint response validation.
- `/payments/lightning-address`: Lightning Address validator with DNSSEC, TLS, and LUD-16 checks.
- `/payments/zaps`: Real-time stream and verifier for Nostr Zaps with invoice hash cross-checks.

## API Contracts
- `GET /api/v1/intelligence/payment-connectivity/overview`: Aggregated connectivity metrics and relay status.
- `GET /api/v1/intelligence/payment-connectivity/relays`: Real-time reachability and round-trip times for payment relays.
- `POST /api/v1/intelligence/payment-connectivity/nwc/inspect`: URI validation with secret masking and permission reporting.
- `POST /api/v1/intelligence/payment-connectivity/lnurl/inspect`: Validated resolution of LNURL endpoints with SSRF guard.
- `POST /api/v1/intelligence/payment-connectivity/zaps/verify`: Verification of NIP-57 event and BOLT11 invoice binding.
