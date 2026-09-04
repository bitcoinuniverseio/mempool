# AssumeUTXO and Node Bootstrap Snapshot Center

## Overview
The AssumeUTXO and Node Bootstrap Snapshot Center provides an observatory, verification environment, and deployment planner for Bitcoin Core AssumeUTXO snapshots. It allows node operators to inspect published UTXO snapshots, verify their cryptographic commitments against compiled Bitcoin Core release parameters, and monitor dual-chainstate background validation progress.

## Operational and Consensus Safety
1. **Never Automatically Mutate Live Nodes**:
   - The verification tools inspect and validate snapshot files without altering the active node state.
   - Live loading (`loadtxoutset`) requires explicit operator authentication and confirmation.
2. **Strict Verification Against Compiled Parameters**:
   - Compares the serialized UTXO set hash (`gettxoutsetinfo`) against the hardcoded parameters compiled into official Bitcoin Core releases.
   - A snapshot is considered valid only when base height, base block hash, and SHA256 file checksums match the reference release definitions.
3. **Dual Chainstate Architecture Transparency**:
   - Clearly models the concurrent execution of the snapshot chainstate (syncing rapidly to the network tip) and the background validation chainstate (validating historical blocks from genesis).

## Manifest and Provenance Standard
- **Manifest Schema**: Records producer software, base height, block hash, coin count, UTXO set hash, file SHA256, and cryptographic producer signatures.
- **Provenance Citations**: Links snapshots directly to the relevant Bitcoin Core release notes and Git commit references.

## Routes and Navigation
- `/node/bootstrap`: Center overview, compiled AssumeUTXO parameters, and active snapshot catalog.
- `/node/bootstrap/snapshots`: Index of verified UTXO snapshots across mainnet, testnet4, and signet.
- `/node/bootstrap/snapshot/:snapshotId`: Detailed inspection of snapshot metadata, coin counts, and hashes.
- `/node/bootstrap/verify`: In-browser and server-assisted snapshot file checksum and parameter verifier.
- `/node/bootstrap/planner`: Storage, bandwidth, and initial block download (IBD) time calculator.
- `/node/bootstrap/chainstates`: Live dual-chainstate monitor tracking background IBD validation progress.

## API Contracts
- `GET /api/v1/intelligence/bootstrap/overview`: Available snapshots count and active node bootstrap status.
- `GET /api/v1/intelligence/bootstrap/snapshots`: List of published and verified UTXO snapshots.
- `GET /api/v1/intelligence/bootstrap/snapshots/:snapshotId`: Complete metadata and cryptographic checksums for a snapshot.
- `GET /api/v1/intelligence/bootstrap/chainstates`: Real-time status of active chainstates on configured nodes.
- `POST /api/v1/intelligence/bootstrap/snapshots/verify`: Integrity verification of snapshot files against reference manifests.
- `POST /api/v1/intelligence/bootstrap/planner/evaluate`: Bootstrap strategy optimization based on node hardware profile.
