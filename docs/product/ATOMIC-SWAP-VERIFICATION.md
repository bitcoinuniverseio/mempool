# Cross-Layer Atomic Swap and Submarine Swap Verification Center

## Product Overview
The Cross-Layer Atomic Swap and Submarine Swap Verification Center provides a comprehensive, vendor-neutral intelligence platform for inspecting, auditing, simulating, and recovering HTLC and PTLC atomic swaps across Bitcoin Layer 1, the Lightning Network, Liquid, and sidechains.

## Problem Statement
Atomic and submarine swaps represent the primary non-custodial bridge mechanism between on-chain Bitcoin and off-chain Layer 2 protocols (such as Lightning channels and Liquid pegs). However, users and routing operators face substantial friction:
- Incomplete visibility into active swap providers, liquidity bounds, and fee premiums.
- Cryptographic failure risks due to locktime expiration or unrevealed preimages.
- Locked funds in stranded HTLCs requiring complex refund transaction generation.
- Lack of pre-execution simulation tools to model on-chain fees, reorg risks, and slippage.

## Architecture and Subsystems

### 1. Protocol Decoder Engine
Decodes HTLC (Hash Time Locked Contract) and PTLC (Point Time Locked Contract) witness scripts across standard implementations:
- Submarine Swaps: Lightning invoice payment funded via an on-chain UTXO.
- Reverse Submarine Swaps: On-chain payout claimed by spending an off-chain Lightning hold invoice.
- Chain Swaps: Direct cross-chain swaps between Bitcoin mainnet and Liquid Network assets.

### 2. Provider Intelligence and Registry
Tracks audited public swap gateways including Boltz Exchange, Lightning Loop, and Peer-to-Peer atomic market makers. Records verified historical liquidity, operational uptime, and cryptographic manifest attestations.

### 3. Client-Side Package Inspector
Executes completely within local browser memory. Accepts raw transactions, PSBTs, or Boltz/Loop JSON swap packages, and computes preimage verification, timelock boundaries, and refund keys without sending private inputs to the server.

### 4. Recovery Planner
Provides automated generation of unsigned timelock-sweep refund transactions for expired or failed swaps. Calculates CPFP (Child-Pays-For-Parent) and RBF (Replace-By-Fee) acceleration profiles to rescue stranded capital under fluctuating mempool feerate regimes.

### 5. Settlement and Reorg Simulator
Simulates dynamic network conditions:
- Models miner fee spikes that might delay claim transactions past the CLTV (CheckLockTimeVerify) expiration window.
- Evaluates 1-block and 2-block chain reorganizations to determine safe confirmation depths for provider payouts.

## User Interface Routes
- `/swaps`: Main intelligence dashboard, volume aggregates, and active swap metrics.
- `/swaps/submarine`: Submarine swap protocol status and recent on-chain deposits.
- `/swaps/reverse`: Reverse submarine swap activity and Lightning preimage settlements.
- `/swaps/chain`: Cross-chain atomic swaps (Bitcoin to Liquid L-BTC).
- `/swaps/providers`: Directory of audited swap services with fee schedules and reputation scores.
- `/swaps/provider/:providerId`: Individual provider operational metrics and public keys.
- `/swaps/inspect`: In-browser script decoder and state machine inspector.
- `/swaps/recover`: Automated timelock refund transaction generator.
- `/swaps/simulate`: Scenario simulator for fee volatility and chain reorg resistance.
