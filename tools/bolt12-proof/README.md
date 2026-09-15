# Native BOLT12 offer decoder

This bounded executable uses official LDK `lightning = 0.2.6`, matching the version already pinned by the payment-discovery tool. `Cargo.lock` fixes all dependencies. LDK parses canonical TLV fields, point encodings, required/optional fields and offer semantics. Two additional checks close acceptance gaps exposed by the official vectors: reject empty explicit chain lists and noncanonical excessive Bech32 padding. Zero amounts are explicitly rejected.

Offers are unsigned. This tool does not manufacture signature verification or establish issuer identity, an invoice, routing, payment acceptance, issuance, or settlement. Invoice requests and invoices have different signed formats and are outside this offer-only operation.

## Build and packaging

Run `node tools/bolt12-proof/build.mjs` from the repository. It runs one locked release Cargo build job and copies the native executable into `tools/bolt12-proof/bin/`, writing SHA256 fingerprints for binary, source and Cargo.lock into `engine-manifest.json`. Windows uses the known local Cargo installation at `C:/rust/cargo/bin/cargo.exe`; other systems use Cargo during the explicit build. Optional `CARGO_TARGET_DIR` affects build artifacts only. No machine configuration is changed.

Package `tools/bolt12-proof/bin/universe-bolt12-proof` (with `.exe` on Windows) and its manifest alongside the backend at their existing relative paths. Runtime invokes only this fixed bundled file with no shell, ambient PATH lookup, request-supplied executable or environment override. Missing binary produces HTTP 503. Runtime is offline, has a 5-second child deadline, 256 KiB output bound, two-process concurrency limit, 16 KiB offer bound and 128 KiB native JSON-input bound.

## API

`POST /api/v1/lightning/offers/decode` accepts `{ "offer": "lno1...", "network": "signet" }`. The network must equal the backend's selected network. The API hashes the exact UTF-8 input into `input_sha256`; it does not silently trim it. LDK handles the specification's uppercase and continuation presentation rules.

Decoded responses distinguish `syntax_valid`, `network_compatible`, `expired`, `unknown_required_features` and `usable_for_invoice_request`. The latter is only the bounded structural/network/time prerequisite, not an invoice/payment guarantee. `signature_status` is `not-applicable-unsigned-offer`; `payment_verified` is always false. Optional fields stay null when absent, amounts and quantity/expiry values are decimal strings, currency amounts are minor units under ISO4217, and `tlv_hex` preserves the full native-decoded stream including optional unknown fields. Chain hashes are explicitly labeled in BOLT wire byte order.

The separate owned-offer directory and RFQ operations retain their independent source requirements; successfully decoding a pasted offer does not populate or validate them.

## Official vectors and local evidence

`testdata/offers-test.json` is from lightning/bolts commit `152897261850d93c4f4597f39cf22d7d22d6ede6`, file `bolt12/offers-test.json`. All 53 official offer vectors and 12 official string-format vectors pass. The latter cover uppercase, allowed continuation/whitespace and rejected malformed presentation. They exercise missing fields, unknown odd/even TLVs and features, allowed ranges, canonical lengths/integers/padding, chain lists, currencies, and blinded paths.

`examples/signet_fixture.rs` uses the official LDK builder and the public key from the official vectors to create an unsigned Signet parser fixture. Its amount and quantity `9007199254740993` demonstrate exact values beyond JavaScript number precision. It represents no operating merchant or payment service.

Source references: https://github.com/lightning/bolts/blob/152897261850d93c4f4597f39cf22d7d22d6ede6/12-offer-encoding.md and https://docs.rs/lightning/0.2.6/lightning/offers/offer/index.html.
