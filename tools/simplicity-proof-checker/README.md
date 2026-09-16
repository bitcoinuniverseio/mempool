# Bounded closed-program proof checker

This is a deliberately narrow independent semantic checker. It supports only proof system `simplicity-closed-program-v1` and the exact statement:

> The closed program evaluates successfully with no witness and no transaction environment.

It does not check arbitrary Coq, Lean4, Isabelle or Dafny proofs. Those original proof-system integrations remain open and return `unsupported_proof_system`. A metadata manifest, declared command, proof hash or caller-provided verification transcript never counts as verification.

## Build and local operation

- Build: `cargo build --locked --release --manifest-path tools/simplicity-proof-checker/Cargo.toml`.
- Set `SIMPLICITY_PROOF_CHECKER_EXECUTABLE` to the absolute task-owned binary path for the local backend process.
- No default executable, shell command or production configuration is changed.
- The backend executes the configured binary with no arguments, sends only bounded source/program/CMR JSON over stdin, and bounds concurrency to 2, time to 10 seconds, output to 16 KiB.
- The binary applies a 256 MiB memory limit to itself before reading input (Windows Job Object or Unix RLIMIT_AS). Failure to apply the limit fails closed.
- Missing configuration returns HTTP503. Unsupported theorem systems are explicitly unverified.

## Binding and semantics

The backend checks schema1.0.0, lowercase SHA256 source/proof/program hashes, exact pinned revisions/dependency list, exact statement, and the canonical proof certificate. The certificate is JSON containing `claim: closed-program-succeeds`, the exact program CMR, and the encoded program SHA256. Public fixture generation is `node tools/simplicity-proof-checker/generate-fixtures.mjs`; it uses the actual compiled WASM bytecode output and writes true/false fixtures plus the frontend sample.

The native checker parses/analyzes the supplied SimplicityHL0.2.0 source, rejects all witness declarations and parameters, recompiles it, and compares exact emitted bytes/CMR. It rejects witness/disconnect nodes and all jets except pure Verify/Eq1/Eq8/Eq16/Eq32/Eq64/Eq256. It then independently decodes, typechecks, computes CMR and evaluates using libsimplicity C0.5.0 with no environment. Only successful evaluation with matching CMR establishes this closed, no-free-input statement.

This proves no authorization policy, custody/asset safety, transaction validity, or general theorem. Broader proofs require a real kernel and a sound binding from its theorem to program semantics.

## Tests

`cargo test --locked --manifest-path tools/simplicity-proof-checker/Cargo.toml` checks true/false closed claims, altered program and witness rejection. The backend formal-checker suite invokes the real release binary and tests actual source/hash/certificate/CMR alterations, recomputed attacker hashes, unsupported systems, and ignored verification commands. Frontend tests verify contract fields and stale-result cancellation. Rendered verification is a separate integration gate.

## Constrained Lean 4 kernel profile

An additional genuine kernel path accepts `proof_system: "lean4"`, `proof_profile: "simplicity-u32-equality-v1"`, and `kernel_revision: "lean-4.24.0"`. It preserves the original broader theorem-system gates as OPEN.

The supported source is exactly `fn main() { assert!(jet::eq_32(A,B)); }`, with canonical decimal u32 literals. The exact theorem is `(A : UInt32) = (B : UInt32)`. A bounded JSON certificate specifies only the profile, left/right literals, `term: "refl"`, its literal value, CMR and program-byte digest. The trusted adapter generates the Lean declaration using those validated integer/hex tokens. No supplied Lean source, imports, commands, tactics, `#eval`, `IO`, `sorry`, axioms or native-decide code can enter the checker. User `verification_command` remains inert.

Lean 4.24.0 commit `797c613eb9b6d4ec95db23e3e00af9ac6657f24b` is checked on every invocation. The official Windows release asset SHA256 is `c2fcf1cba1089e526e184de2a6f6763a6e15596a2991f096dfacd4a6e3ce2cdd`; the downloaded archive was compared with the digest from the official GitHub release API. The tool lives outside the candidate under the isolated task's `tools/lean-4.24.0`, without changing installed runtimes. The release source is https://github.com/leanprover/lean4/releases/tag/v4.24.0.

Set `SIMPLICITY_LEAN_EXECUTABLE` to the absolute owned `lean` executable, in addition to the existing `SIMPLICITY_PROOF_CHECKER_EXECUTABLE`. Missing or wrong-version kernels return an explicit unavailable result. Do not execute user-provided verification commands. `lean-fixtures.json` supplies true42/42 and false42/43 artifacts, and `generate-lean-fixtures.cjs` reproduces their manifests and frontend sample.

The kernel runs with `--trust=0 --threads=2 --memory=256 --timeout=200000`, plus bounded recursion/heartbeats in generated trusted source. Lean's long option syntax is required; short-option `-j=2` is parsed incorrectly by this version. The existing10-second parent deadline remains. On Windows the task-owned checker/descendants belong to a256 MiB-per-process/512 MiB-total Job Object that kills descendants when its handle closes. Unix children inherit256 MiB address-space and5-second CPU limits. Only a fresh generated public theorem file is written; inherited Lean search paths are removed, stdin is closed and output discarded. The exact temporary file/directory are removed after checking. This is a constrained non-executable proof grammar, not a general-purpose sandbox for arbitrary uploaded Lean programs.

A successful response retains `kernel_revision`, the generated checked Lean source's `kernel_artifact_hash`, the supplied program's `proof_artifact_hash`, statement and CMR. The backend recomputes the expected generated-source hash. Independent compilation and C execution bind the equality to the supplied canonical Simplicity source/program; the kernel separately checks the UInt32 theorem. The profile translation between the canonical source and equality is part of this adapter's trusted scope, not a formal verification of the compiler.

Validation:39 combined backend tests (including14 Lean-specific tests),5 native tests with the real pinned kernel,7 frontend tests, Angular template compilation and backend TypeScript checks passed. False statements, wrong reflexivity values, arbitrary Lean commands, attacker-rebound CMR and unsupported general profiles are rejected. Native cases include the maximum u32 value. Live kernel tests explicitly require `SIMPLICITY_LEAN_EXECUTABLE`; absence is not a passing kernel proof.

The new browser button **Load Lean Kernel Sample** exercises this bounded profile. It does not complete arbitrary Coq/Lean/Isabelle/Dafny theorem verification, symbolic/witnessed program proofs, asset authorization or general Simplicity semantics acceptance.
