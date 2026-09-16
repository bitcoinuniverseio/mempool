# Local Liquid output verifier

Pinned `elements 0.26.2` / `secp256k1-zkp 0.11.0` parses an exact consensus-serialized Elements TxOut, verifies its rangeproof against the value commitment, asset generator and script, verifies its surjection proof against caller-supplied ordered input generators, then rewinds using the private blinding key and checks the recovered asset commitment. Amounts are decimal u64 strings; the asset is not assumed to be L-BTC.

Input outputHex does not contain witness proofs: provide rangeproofHex and surjectionproofHex separately. An outpoint or script alone is insufficient. Input generators must include issuance generators in Elements consensus order. This tool verifies supplied cryptographic data; it does not establish that inputs exist on chain or that a transaction balances, is signed, or is spendable.

Build: `node tools/liquid-proof/build.mjs`. Uses installed Rust wasm32 target and Clang (Windows task-only compiler environment). `cargo test --locked --manifest-path tools/liquid-proof/Cargo.toml` deterministically regenerates fixture.json, a synthetic confidential output from public fixed test keys and seeded test randomness, with no chain or funds. The private test blinding scalar is public test material. Do not use it for funds.

The browser fetches only the same-origin static WASM binary, caches the compiled module, instantiates fresh memory per operation, and wipes the whole instance memory in a finally block after success or failure. No user inputs are sent to a service or persisted. JavaScript strings cannot be guaranteed physically erased by the runtime; UI references and byte buffers are cleared. The verifier requires no entropy: its wasm getrandom callback fails closed, and proof generation is native tests only.

Primary API references: https://docs.rs/elements/0.26.2/elements/struct.TxOut.html and https://docs.rs/secp256k1-zkp/0.11.0/secp256k1_zkp/struct.SurjectionProof.html

## Actual isolated Elements transaction evidence

`regtest-transaction-fixture.json` contains an actual mined transfer from a freshly issued asset on a disposable Elements 23.3.4 chain. Its blinding scalar is deliberately public disposable test material, never a user key. `regtest-output-fixture.json` is the output/proof input extracted from that transaction. The native `extract_transaction` example independently parses exact transaction and parent bytes, verifies txids/ordered prevouts, derives input generators, and checks unblinding against the exact expected asset and 15000001 base units. It supports ordinary non-issuance, non-peg transfer inputs; it explicitly rejects issuance/peg inputs. This fixture's parent transaction contains the issuance.

Reproduce native extraction: `cargo run --locked --manifest-path tools/liquid-proof/Cargo.toml --example extract_transaction -- tools/liquid-proof/regtest-transaction-fixture.json tools/liquid-proof/regtest-output-fixture.json`. The frontend `liquid-regtest-proof.spec.ts` runs the actual browser WASM against these node-created proofs and rejects wrong keys and altered proofs. A chain-created fixture proves the cryptographic operation on real node output; it does not add live history or full transaction validity to the UI's output-only verification contract.

Official release: https://github.com/ElementsProject/elements/releases/tag/elements-23.3.4 . Win64 archive SHA256: a800f2a22bd928a16b109a2209a1e8aa3e04d65e2817c01a4426677b62f5c946 (checked against official release SHA256SUMS). The isolated node has networking disabled and validatepegin disabled, so this is not peg-in validation or Liquid mainnet proof.
