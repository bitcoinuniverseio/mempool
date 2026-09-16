# Pinned V-PACK reconstruction engine

Build locally with `cargo build --release --locked`; verify with `cargo test --locked`.
Set `UNIVERSE_VPACK_ENGINE` to the absolute compiled executable path when packaging
outside this repository. Include this binary separately from the TypeScript
backend build, for the correct OS/architecture. Distribute upstream MIT license
and applicable Rust dependency licenses. No build command deploys or broadcasts.

Upstream: https://github.com/jgmcalpine/libvpack-rs at
`e1f783a02489680b84121c71388a6a96122f5c63`, package version1.0.0-rc.1.
Cargo.lock pins all transitive dependencies. The adapter accepts a schema1.0
VpackState envelope (`implementation: ark_labs | second_tech`, typed
`ingredients`) or binary `vpack_hex`.

The engine performs bounded parsing, checksum/invariant checks, serialization
and transaction reconstruction. The backend endpoint is
`POST /api/v1/intelligence/ark/vpack/packages/reconstruct`, with `network`,
`state` or `vpack_hex`, and optional `expected_vtxo_id`. It reads the reconstructed
anchor from owned Bitcoin Core and independently checks transaction links,
known-value conservation and supported Taproot key-path Schnorr signatures.
It checks first-hop signatures against the actual anchor output key and amount.

## Verification limits and upstream findings

The upstream `verify()` slices bytes[..24] before its length check. This wrapper
checks length before invoking any slice-based parser. Upstream transaction engine
signature checks skip the first hop (`if i > 0`) and select the leaf key for later
hops. We therefore disable that optional verifier feature and label native output
as reconstruction. Independent backend signature checks use actual previous
output script keys; unsupported witness forms and missing data remain unknown.

No successful reconstruction implies Ark lifecycle validity, safe exit,
path exclusivity or relay acceptance. No private keys are accepted, generated or
used by this engine; existing witness bytes are merely reconstructed. It never
broadcasts. A protocol fixture can reconstruct successfully while its anchor is
unknown to the owned Signet source; the response preserves both facts.

Native proof-envelope conversion and explicit manifest signature verification are implemented below. Provider discovery/health and complete funded recovery remain open; no fabricated provider catalog is returned.

## Native Bark codec and conversions

The same executable also pins `ark-lib = 0.7.1` from the official Bark project.
It accepts `bark_hex`, decodes full `ProtocolEncoding`, requires exact native byte
round-trip, and reconstructs actual transaction bytes. All100 upstream public
Bark QA fixtures round-trip with independently matching final IDs, amounts and
scripts (maximum315 transactions in that set). The bounded runtime supports512
transactions. libvpack's own Bark adapter failed all100 fixtures under its depth
and node-count constraints; it is not used for native Bark input. An initial
attempt to use ark-lib0.1.0-beta.9 was rejected because its required secp256k1
release is yanked; no yanked dependency was forced into the build.

`POST /ark/vpack/dialects/translate` accepts source_dialect/target_dialect,
network and package. Bark-to-MVV preserves the complete native proof under
native_package.bark_hex and adds a MinimalViableVtxo summary. MVV-to-Bark requires
that proof, compares every summary field to the real decoded values, and emits
exact original native bytes. Unknown extensions and mismatches reject. This is
a proof envelope, not a claim that a bare MVV summary is sufficient for recovery.
The four directions involving Arkade remain explicitly incompatible/unimplemented;
no transaction template, sequence or signature is silently rewritten.

`POST /ark/vpack/exit/plan` and `/exit/simulate` add target_feerate_sat_vb.
They derive actual package stages, unsigned PSBTs when previous outputs are known,
serialized sizes, complete-script-checked sizes, fee sums, scenario deficits,
sequence fields and actual pay-to-anchor output candidates. No new signature,
wallet-funded CPFP child, final leaf sweep, chain maturity or relay acceptance
is fabricated. All lifecycle/exit viability fields remain unestablished.

Actual owned Signet public-fixture proof: one unspent anchor backs67 reconstructed
Bark transactions. Independent signature checking verified66 key-path signatures;
the native btcd transaction-context engine independently executed all67 scripts,
including the remaining script path. This is not a broadcast or full recovery.

The libvpack state wrapper now rejects unknown fields before typed deserialization:
upstream ArkLabsIngredients otherwise ignores such fields as exit_delta. The
upstream conformance JSON includes diagnostic metadata not part of this typed
state schema; the proof supplies only the explicit supported ingredient fields.
