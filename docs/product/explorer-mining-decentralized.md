# Decentralized Mining Sharechain and Template-Autonomy Observatory

## Overview
The Decentralized Mining Sharechain and Template-Autonomy Observatory provides real-time telemetry, sharechain verification, and miner template autonomy tracking for decentralized mining protocols. It supports DATUM (Decentralized Alternative Template User Mining), P2Pool v2, and Braidpool without duplicating existing centralized Stratum V2 or block template observatory tools.

## Protocol Principles and Objective Metrics
1. **Objective, Non-Accusatory Analysis**:
   - The observatory tracks divergence between miner-constructed templates and pool-recommended templates without editorial judgment.
   - Every divergence metric is backed by cryptographic proofs and transaction inclusion diffs.
2. **First-Party Protocol Support**:
   - Direct integration with DATUM template negotiation, P2Pool sharechain validation, and Braidpool directed acyclic graph (DAG) share tracking.
3. **Coinbase Payout Auditability**:
   - Verifies that mined blocks from decentralized pools correctly include individual miner payout outputs directly in the coinbase transaction.

## Architecture and Protocols
- **DATUM Protocol**: Inspects miner-selected transactions versus pool-fallback selections, auditing transaction inclusion freedom.
- **P2Pool v2**: Tracks share difficulty targets, sharechain tip progression, and orphan share rates.
- **Braidpool**: Monitors DAG-based block and share topologies with multiple parent references and reward reconciliation.

## Routes and Navigation
- `/mining/decentralized`: Overview of decentralized mining protocols, network share, and template autonomy score.
- `/mining/decentralized/datum`: Dedicated DATUM protocol observatory showing connected hashers and template diffs.
- `/mining/decentralized/p2pool`: P2Pool v2 sharechain monitor, share difficulty graph, and uncle block metrics.
- `/mining/decentralized/braidpool`: Braidpool DAG visualizer displaying multi-parent share references and consensus tips.
- `/mining/decentralized/share/:shareId`: Detailed inspection of an individual submitted share and its template manifest.
- `/mining/decentralized/compare`: Side-by-side transaction set and fee rate diff between miner and pool templates.

## API Contracts
- `GET /api/v1/intelligence/mining-decentralized/overview`: High-level decentralized mining ecosystem metrics.
- `GET /api/v1/intelligence/mining-decentralized/shares`: Stream of observed shares across tracked decentralized networks.
- `GET /api/v1/intelligence/mining-decentralized/shares/:shareId`: Complete share proof, coinbase script, and header.
- `GET /api/v1/intelligence/mining-decentralized/templates/compare`: Structured transaction diff between miner and pool proposals.
- `GET /api/v1/intelligence/mining-decentralized/datum/summary`: Aggregated DATUM protocol metrics and autonomy trends.
