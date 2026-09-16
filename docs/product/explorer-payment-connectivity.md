# Nostr and Lightning Payment Connectivity Center

## Current implementation and evidence scope

The feature catalog below describes the intended product surface. Directory,
relay-health, LNURL-provider, vendor-manifest and zap-verification integrations
remain unavailable and return explicit 503 responses. They have not achieved
end-to-end acceptance; a route or specification table does not prove them.

### Browser-only NWC inspection

`/payments/nwc/inspect` now parses a pairing URI entirely in the browser. It
validates the [NIP-47](https://github.com/nostr-protocol/nips/blob/master/47.md)
32-byte x-only public key, private scalar, required relay URLs and query encoding.
The input clears after inspection. Returned fields redact the entire secret,
including reflected/encoded copies. No HTTP upload, relay connection, wallet
operation or persistent storage occurs. Edits and sample loading clear old results.

A valid URI does not prove wallet authorization or relay reachability. Encryption
support remains unknown until a signed kind-13194 information event is observed.
The sample uses an invalid relay domain and is not a working wallet connection.
There is no backend `/nwc/inspect` route; never upload a real pairing URI.

### Endpoint inspection

`POST /api/v1/intelligence/payment-connectivity/public-endpoints/verify` accepts
`{"endpoint_url":"https://host/path"}`. It validates a credential-free HTTPS URL
and all resolved addresses against the shared public-address policy. Private and
reserved destinations fail, including expanded/IPv4-mapped IPv6, link-local
ranges, loopback aliases and trailing-dot local hostnames. DNS has a four-second
deadline and a process-wide limit of 32 outstanding resolutions.

Success returns `valid:true`, `resolved_address`, `address_family`,
`verification_scope:"dns-address-inspection"` and `ssrf_safe:null`. This checks
addresses at inspection time. It does not fetch LNURL, verify TLS or certify
a subsequent request. An actual transport must validate again and pin its
connection while verifying the hostname certificate; every redirect requires
independent validation. Failures return `valid:false`, `ssrf_safe:false` and
constant diagnostics without echoing raw URLs or resolver exceptions.

### Payment Studio

BIP21 inspection checks the selected-network address and exact decimal satoshis;
malformed encoding, duplicate/unknown required parameters and excessive amounts
fail. Optional protocol fields are displayed, not accepted as executable payments.
BIP353 uses native DNSSEC proof verification and independent browser WASM
verification, followed by local BIP321/on-chain/BOLT11/BOLT12 parsing. Results
expire with proof/instruction limits and clear on edits and network changes.
Failed lookup does not claim authenticated nonexistence. Resolution never executes
a payment. See [build, configuration and proof tests](../../tools/dnssec-proof/README.md).

### Validation scope

Tests cover actual point/scalar checks, malformed input, secret reflection,
stale results, mixed DNS answers and IPv6 equivalence. DNS/HTTP test doubles
establish error handling only; they do not establish live wallet, relay, provider
or payment acceptance.

## Product scope still requiring complete acceptance
The Nostr and Lightning Payment Connectivity Center delivers an inspection, diagnostic, and verification suite for decentralized payment connectivity protocols. It covers Nostr Wallet Connect (NIP-47), Lightning Address (LUD-16), LNURL specifications (LUD-01 through LUD-21), and Nostr Zaps (NIP-57) without requiring custody of wallet credentials or private encryption keys.

## Required privacy and endpoint security
1. **Secret Masking & Zero Key Storage**:
   - NWC connection URIs (`nostr+walletconnect://...`) are parsed with the secret key strictly masked.
   - The platform never stores, logs, or transmits NWC secret keys or wallet signing credentials.
2. **SSRF and Protocol Protection**:
   - LNURL and Lightning Address endpoints are validated strictly over HTTPS with mandatory Server-Side Request Forgery (SSRF) defenses blocking private, loopback, and metadata network ranges.
3. **Cryptographic Zap Verification**:
   - Validates the exact SHA256 linkage between NIP-57 zap requests (event kind 9734) and Lightning invoice description hashes (BOLT11 tag `h`).

## Target protocols and NIPs
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

## Intended API contracts (availability is stated above)
- `GET /api/v1/intelligence/payment-connectivity/overview`: Aggregated connectivity metrics and relay status.
- `GET /api/v1/intelligence/payment-connectivity/relays`: Real-time reachability and round-trip times for payment relays.
- NWC inspection is browser-only and has no HTTP endpoint.
- `POST /api/v1/intelligence/payment-connectivity/public-endpoints/verify`: URL/DNS address inspection; LNURL fetch and capability verification remain pending.
- `POST /api/v1/intelligence/payment-connectivity/zaps/verify`: Verification of NIP-57 event and BOLT11 invoice binding.
