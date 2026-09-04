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
- `/tools/simplicity/verify`: Formal proof artifact package verifier for Coq and Lean proof transcripts.

## API Contracts
- `GET /api/v1/intelligence/simplicity/overview`: Global statistics, active toolchain versions, and recent programs.
- `GET /api/v1/intelligence/simplicity/programs`: Program list with filters for jets and static resource weights.
- `GET /api/v1/intelligence/simplicity/programs/:programId`: Deep inspection of program commitments and structure.
- `GET /api/v1/intelligence/simplicity/transactions/:txid`: Input-by-input Simplicity spend execution results.
- `GET /api/v1/intelligence/simplicity/toolchains`: Supported toolchain compilers, verifiers, and revisions.
- `POST /api/v1/intelligence/simplicity/programs/decode`: Decoding of raw program bytes into Merkle roots and type signatures.
- `POST /api/v1/intelligence/simplicity/formal-artifacts/verify`: Cryptographic verification of formal proof manifests and statements.
