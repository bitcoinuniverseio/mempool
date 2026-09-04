# Statechain, CoinSwap, and Off-Chain UTXO Recovery Center

## Overview
The Statechain, CoinSwap, and Off-Chain UTXO Recovery Center provides an observatory, safety verification workbench, and emergency recovery planner for off-chain Bitcoin UTXO protocols. It supports blinded Mercury-style statechains and Teleport-style CoinSwap packages without requiring custody of private keys or spending credentials.

## Privacy and Operational Guarantees
1. **Zero Key Handover**:
   - The platform never accepts, stores, or generates private keys, seeds, WIF strings, or spend secrets.
   - Verification relies exclusively on public keys, operator signatures, transaction manifests, and blinded commitments.
2. **Client-Side Package Inspection**:
   - Sensitive statechain transfer histories and backup transaction sequences remain inside the user's browser.
   - Server endpoints accept only public operator manifests, public maker offers, and anonymous recovery parameters.
3. **No Heuristic On-Chain Classification**:
   - Successful statechain transfers and CoinSwaps are indistinguishable from ordinary transactions on the Bitcoin blockchain.
   - The platform never claims to detect off-chain transfers solely from blockchain data.

## Architecture and Verification Model
- **Statechain Verification**: Validates the complete decrementing locktime sequence across backup transactions, confirms deposit outpoints, and cross-references backup count against operator signature counters.
- **CoinSwap Inspection**: Validates hashlock consistency, timelock ordering, and maker terms across multi-hop contract paths.
- **Recovery Planner**: Identifies earliest unilateral exit heights, checks current mempool fee policy, and exports unsigned recovery PSBTs for user signing in standard hardware or software wallets.

## Routes and Navigation
- `/offchain/utxo`: High-level dashboard for off-chain protocols, active operators, and tracked volume.
- `/offchain/statechains`: Overview of statechain architectures, safety margins, and operator networks.
- `/offchain/statechains/operators`: Directory of registered statechain operators with signed capability manifests.
- `/offchain/statechains/operator/:operatorId`: Detailed operator view showing signature counts, policies, and health.
- `/offchain/statechains/verify`: In-browser verifier for statechain transfer packages and backup transaction chains.
- `/offchain/coinswap`: CoinSwap network overview and public liquidity maker registry.
- `/offchain/coinswap/inspect`: Interactive contract package inspector for CoinSwap funding and timeout stages.
- `/offchain/recovery`: Emergency recovery planner evaluating unilateral exit options and preparing recovery PSBTs.

## API Contracts
- `GET /api/v1/intelligence/offchain/overview`: Network statistics and protocol health status.
- `GET /api/v1/intelligence/offchain/operators`: List of active statechain and CoinSwap service operators.
- `GET /api/v1/intelligence/offchain/operators/:operatorId`: Specific operator profile, signature count, and policies.
- `GET /api/v1/intelligence/offchain/offers`: Public CoinSwap maker offers and liquidity parameters.
- `POST /api/v1/intelligence/offchain/manifests/verify`: Cryptographic verification of signed operator manifests.
- `POST /api/v1/intelligence/offchain/recovery/context`: Calculation of broadcast readiness and fee requirements.
