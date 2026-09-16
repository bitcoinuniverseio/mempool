# BIP353 local proof verification

The owned native process obtains an RFC9102 proof using a configured recursive DNS transport, then verifies signatures to the pinned DNS root. The browser independently verifies the proof with the same compiled Rust library; it never trusts a returned address or an AD flag. No wallet, key, signing or payment request is involved.

## Build

Install Rust's `wasm32-unknown-unknown` target and a Clang toolchain, then run `node tools/dnssec-proof/build.mjs` from the repository root. The locked build creates the native `universe-dnssec-query` executable and copies the browser module into `frontend/src/resources/dnssec/universe_dnssec_proof.wasm`. Windows builds automatically use an existing `C:/Program Files/LLVM/bin` installation when available; per-build `CC_wasm32_unknown_unknown` and `AR_wasm32_unknown_unknown` can override it. The generated asset is served by the normal Angular resources copy. The gateway CSP must permit `wasm-unsafe-eval`; ordinary eval is unnecessary.

## Configure the task-owned backend

- `BIP353_PROVER_EXECUTABLE`: absolute path to the built native executable for the host, including `.exe` on Windows.
- `BIP353_DNS_RESOLVER`: configured recursive DNS transport as an IPv4 address and TCP port, for example an operated local resolver at `127.0.0.1:5353`. There is no fallback resolver.

The process is invoked with fixed arguments, no shell, a 10-second timeout, bounded output, hidden Windows window, and at most four concurrent lookups per backend instance. Missing configuration returns 503. The route is `<API_URL_PREFIX>payment-discovery/bip353?name=user@domain`. Responses and the frontend are scoped to the selected Bitcoin network. A recursive transport's positive AD signal is required by the upstream proof collector, but is insufficient for acceptance: root signatures are checked twice locally.

Run `node tools/dnssec-proof/probe.mjs <full.DNS.owner.>` with the resolver variable set for a DNS-only native/WASM round trip. Optionally set `BIP353_VERIFY_NETWORK` to also inspect payment instructions against that network. The probe emits hashes and verification metadata, not the entire payment record.

## Semantics and failure states

The verifier follows authenticated CNAME/DNAME paths, concatenates strings within each TXT RR, ignores unrelated TXT records, rejects multiple payment TXT records, enforces signature times and TTLs, rejects SHA1 signatures and RSA keys shorter than 1024 bits, and fails closed on absent/invalid proofs. An unresolved or failed lookup is **not** described as authenticated nonexistence; the proof collector cannot currently provide a verified negative DNS answer.

After DNS verification, `bitcoin-payment-instructions` parses the authenticated BIP321 URI locally. This validates supported on-chain/BOLT11/BOLT12 instructions and network context. Offer-only names need no on-chain fallback. The UI displays the inspected payment methods; it does not claim that any payment was executed. Callback and follow-up network resolution are disabled. Unsupported-only instruction formats fail explicitly.

Input edits, network switches and destruction cancel request subscriptions and invalidate pending proof work. Displayed results expire at the minimum transport TTL, signed-chain TTL, signature expiry, and supported payment-instruction expiry.

## Dependencies, provenance and checks

- [`dnssec-prover` 0.6.10](https://docs.rs/dnssec-prover/0.6.10/): MIT OR Apache-2.0; pinned root trust anchors and RFC9102 verification.
- [`bitcoin-payment-instructions` 0.7.1](https://github.com/rust-bitcoin/bitcoin-payment-instructions): MIT OR Apache-2.0; the [BIP321](https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki) reference parser, including LDK offer/invoice parsing.
- `Cargo.lock` pins all transitive versions/checksums. `bip353-official-vectors.json` is derived verbatim from the public [BIP353 CC0 vectors](https://github.com/bitcoin/bips/blob/master/bip-0353.mediawiki), with public names and serialized proof bytes. They are historical fixtures; production verification uses the current clock.

Run `cargo test --locked` in this directory, frontend Vitest for `src/app/universe/payment-studio`, and backend Jest for `src/api/payment-discovery/bip353.test.ts`. Tests include real published signed proofs, CNAME/wildcard coverage, duplicate records, missing NSEC3, tampered/expired/wrong-name proofs, unsupported AD-only input, network mismatch, offer-only parsing, stale requests and TTL expiration. Mocked transport lifecycle tests are separate from the actual cryptographic fixture tests.

The current DNS transport configuration is process-local. This work does not configure a production resolver or deploy any service.
