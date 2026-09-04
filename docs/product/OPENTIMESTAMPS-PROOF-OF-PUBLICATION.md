# OpenTimestamps and Bitcoin Proof-of-Publication Center

## Product Overview
The OpenTimestamps and Bitcoin Proof-of-Publication Center provides a complete suite of browser-native and server-assisted tools for anchoring documents, verifying `.ots` cryptographic proofs, inspecting opcode operations, monitoring calendar server networks, and verifying Git commit proofs-of-publication on Bitcoin.

## Problem Statement
Proving that a digital file existed at or before a specific point in time is a fundamental cryptographic challenge:
- Traditional central timestamping authorities (TSAs) rely on trusted third parties and certificate revocations.
- Direct Bitcoin OP_RETURN transactions for every document are cost-prohibitive and bloat the blockchain.
- OpenTimestamps (OTS) solves this via decentralized Merkle aggregation anchored into Bitcoin block headers, but lacks accessible user-facing explorers that allow ordinary users to create, verify, decompile, and monitor proofs.

## Architecture and Subsystems

### 1. Browser-Native Document Stamping
Executes entirely in the user's browser using HTML5 Web Cryptography:
- Computes SHA256 file digests locally without uploading file contents across the network.
- Automatically communicates with distributed public calendar servers (such as Alice, Bob, and Finney) to commit the digest.
- Emits an unconfirmed `.ots` proof file immediately to the user.

### 2. Proof Engine & Opcode Decompiler
Parses raw binary `.ots` files:
- Evaluates the series of append, prepend, and hashing operations (such as SHA256 and RIPEMD160).
- Traces the Merkle path up to the Bitcoin block header Merkle root.
- Confirms mathematical inclusion and displays the definitive timestamp guaranteed by Bitcoin proof-of-work.

### 3. Multi-Calendar Network Telemetry
Tracks public calendar servers:
- Monitors calendar server availability, pending queue sizes, and the latest block height anchored.
- Provides proof upgrading utilities that merge attestations once calendar commitments are mined into a Bitcoin block.

### 4. Git Commit & Release Attestation Inspector
Integrates with `ots-git` to allow developers and auditors to verify software releases, Git commit SHAs, and release tags anchored into Bitcoin block headers, providing tamper-proof evidence against retrospective history rewriting.

## User Interface Routes
- `/tools/timestamp`: Overview of OpenTimestamps ecosystem metrics, active anchors, and quick tools.
- `/tools/timestamp/stamp`: Local client-side document hashing and calendar submission interface.
- `/tools/timestamp/verify`: Drag-and-drop `.ots` proof verification against confirmed Bitcoin block headers.
- `/tools/timestamp/inspect`: Visual decompiler showing the cryptographic opcode execution trace.
- `/tools/timestamp/git`: Tool for verifying Git commit and release tag Bitcoin attestations.
- `/intelligence/timestamps`: Network-level analytics on global timestamp volume and block coverage.
- `/intelligence/timestamps/calendars`: Real-time health, latency, and queue monitoring for public calendar servers.
- `/intelligence/timestamps/batches`: Historical archive of Bitcoin block transactions containing OTS Merkle roots.
