# Simplicity Contract Explorer and Formal Verification Workbench

## Overview
The Simplicity Contract Explorer and Formal Verification Workbench delivers a dedicated exploration, analysis, and formal verification platform for Simplicity smart contracts on Elements and Liquid. It enables static analysis, resource bound calculation, Commitment Merkle Root (CMR) validation, and verification of formal mathematical proofs.

## Noncustodial and Safety Principles
1. **Zero Execution of Untrusted Native Code**:
   - Program parsing, compilation, type checking, and DAG analysis occur safely in sandboxed Web Workers.
   - Formal proof verification runs through bounded, allowlisted verification tooling.
2. **Clear Toolchain Status Transparency**:
   - Explicit distinction between deployed consensus capabilities on Liquid and experimental compiler or developer tooling.
   - SimplicityHL source representations are clearly identified as active development tooling.
3. **No Unverified Formal Claims**:
   - Contracts are labeled as formally verified only when an official proof verifier executes and completes proof checking successfully against the exact CMR.
4. **No Custody or Transaction Signing**:
   - The workbench operates strictly read-only. It holds no Liquid assets and broadcasts no transactions.

## Architecture and Protocol Standards
- **Core Library**: Pinned to official rust-simplicity and libSimplicity releases.
- **Merkle Roots**: Computes Commitment Merkle Roots (CMR), Identity Merkle Roots (IMR), and Annotated Merkle Roots (AMR).
- **Resource Bounds**: Deterministic calculation of static cost, cell limits, and memory usage before execution.
- **Jets**: Tracks standard jet registry usage for optimized execution paths.

## Routes and Navigation
- `/liquid/simplicity`: Ecosystem overview, program counts, and toolchain readiness dashboard.
- `/liquid/simplicity/contracts`: Registry of on-chain and registered Simplicity programs.
- `/liquid/simplicity/tx/:txid`: Transaction execution trace view for Simplicity spends on Liquid.
- `/liquid/simplicity/program/:programId`: Program detail including CMR, IMR, AMR, DAG nodes, and jets.
- `/tools/simplicity`: Interactive browser workbench for SimplicityHL source editing, compilation, and analysis.
- `/tools/simplicity/verify`: Exact-source closed-program checker and constrained Lean4 u32 equality kernel profile; general theorem transcripts remain unsupported.

## API Contracts
- `GET /api/v1/intelligence/simplicity/overview`: Global statistics, active toolchain versions, and recent programs.
- `GET /api/v1/intelligence/simplicity/programs`: Program list with filters for jets and static resource weights.
- `GET /api/v1/intelligence/simplicity/programs/:programId`: Deep inspection of program commitments and structure.
- `GET /api/v1/intelligence/simplicity/transactions/:txid`: Input-by-input Simplicity spend execution results.
- `GET /api/v1/intelligence/simplicity/toolchains`: Supported toolchain compilers, verifiers, and revisions.
- `POST /api/v1/intelligence/simplicity/programs/decode`: Decoding of raw program bytes into Merkle roots and type signatures.
- `POST /api/v1/intelligence/simplicity/formal-artifacts/verify`: Cryptographic verification of formal proof manifests and statements.

## Compiler workbench implementation and limits

`/tools/simplicity` uses the published SimplicityHL 0.2.0 compiler with rust-simplicity 0.5.0 in a local module worker. Its displayed source and template use that language version. Optional parameter and required declared-witness mappings are editable JSON using value/type entries. Syntax, type, unknown jets and missing witnesses produce actual compiler errors. Bytecode is re-decoded and its CMR compared before reporting success. Static cost is milliweight units; memory cells are bits, with an extra-frame count. Serialization does not establish successful execution, theorem validity or deployment eligibility.

The worker has bounded input/output,128MiB WASM memory, a15-second deadline, and cancels on editing/template/navigation. Only static same-origin artifacts are fetched. Operator build/reproduction and independent C decoder/CMR/cost tests are documented in `tools/simplicity-compiler/README.md`. Other index, execution and formal-proof integrations remain separate gates.

## Formal artifact checker: supported claim and remaining integrations

The previous metadata-only success path is removed. Hashes, theorem text, dependencies, client verification commands and claimed transcripts never independently establish a proof. `verification_command` is retained as inert metadata and is never executed.

The implemented `simplicity-closed-program-v1` checker binds public source, encoded program bytes, SHA256 hashes, exact CMR, pinned compiler/library revisions and a canonical claim certificate. It recompiles the source and independently checks the exact closed, witness-free, environment-free program through libsimplicity C. Only its fixed closed-program-success statement is supported. The frontend uses the backend's actual `verified` and `proof_state` contract, clears stale results, and distinguishes rejection from unavailable checker infrastructure.

General Coq, Lean4, Isabelle and Dafny theorem verification remains an OPEN acceptance item. The additional Lean4 simplicity-u32-equality-v1 profile checks canonical closed u32 equality assertions with the pinned Lean4.24.0 kernel and independent C/compiler binding; other profiles remain unsupported. Local operator setup and limits are in `tools/simplicity-proof-checker/README.md`.
