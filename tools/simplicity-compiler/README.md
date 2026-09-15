# Browser SimplicityHL compiler

The workbench is pinned to actual published SimplicityHL 0.2.0 and rust-simplicity 0.5.0, preserving the original advertised language generation. This version is explicitly shown; newer language features are not silently accepted. Input contains source, parameters JSON, and witness JSON. Both mappings use `{ "NAME": { "value": "42", "type": "u32" } }`.

`node tools/simplicity-compiler/build.mjs` builds the compiler WASM with the installed Rust target and Clang. Cargo.lock pins transitive dependencies. `cargo test --locked --manifest-path tools/simplicity-compiler/Cargo.toml` checks native compilation and independently checks emitted bytecode/CMR/cost through the pinned C libsimplicity implementation. Known fixture execution accepts witness42 and rejects witness43. The browser test suite runs the actual WASM compiler and verifies syntax/type/jet/missing-witness rejection, canonical unit encoding, typed witness serialization and changed-source CMRs.

The browser creates a same-origin module worker for each compile, fetches only the static WASM artifact, and terminates it on edit/template/destroy, failure, completion, or after15seconds. Compiler memory is capped at128MiB. Source limit16KB UTF8, whole request40KB, result2MB. JS witness strings cannot be physically guaranteed erased; byte buffers and the single-use WASM memory are wiped and worker terminated. No source, parameters or witnesses are transmitted to a backend.

The pinned upstream crate contains unused wasm-bindgen/getrandom import declarations. All host-import callbacks fail closed if invoked; compilation tests demonstrate the pure path needs none. No fake RNG or host execution fallback exists.

The compiler re-decodes its emitted program independently of the high-level AST and checks the same CMR. It type-checks provided witness data and serializes it, but does not run the contract or prove a theorem. Because upstream0.2.0 silently fills omitted witness data with zeros, this wrapper explicitly rejects missing AST-declared witnesses. Static costs are milliweight units. Extra cell bounds are bits, with separate extra-frame count; root program type1->1 requires no additional input/output bits. A satisfied witness can still fail during actual execution.

Primary references: https://docs.rs/simplicityhl/0.2.0/simplicityhl/ and https://docs.rs/simplicity-lang/0.5.0/simplicity/ . Program index and formal-proof verification are separate integrations, not established by compilation.
