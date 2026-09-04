# Bitcoin Staking, Finality, and Slashing Evidence Observatory

## Overview
The Bitcoin Staking, Finality, and Slashing Evidence Observatory provides real-time telemetry, cryptographic verification, and slashing forensics for Bitcoin staking systems such as Babylon. It tracks on-chain staking covenant transactions, finality provider commitments, extractable one-time signature (EOTS) slashing evidence, and reconciles Bitcoin stake with consumer proof-of-stake voting power.

## Noncustodial Principles and Slashing Integrity
1. **Strictly Noncustodial**:
   - The observatory inspects on-chain Bitcoin scripts and covenants without holding or moving funds.
   - Staking funds remain governed exclusively by Bitcoin script timelocks and unbonding covenants on layer-1.
2. **Mathematical Equivocation Verification**:
   - Slashing claims are validated by verifying that two distinct consensus votes were signed for the same block height using the same EOTS public key.
   - When equivocation is verified, the underlying private key is mathematically extracted according to EOTS cryptography, confirming slashing legitimacy.
3. **Cross-Layer Stake Reconciliation**:
   - Independently reconciles active unspent staking transactions on Bitcoin layer-1 with the voting power distributed across consumer proof-of-stake networks.

## Architecture and Protocol Standards
- **Staking Transactions**: Verifies Bitcoin script covenant paths including timelocked return, unbonding transition, and multi-sig slashing spend paths.
- **EOTS Cryptography**: Verifies Extractable One-Time Signatures for double-signing detection.
- **Parameter Governance**: Tracks global protocol parameters including minimum staking duration, unbonding timelock blocks, and slashing covenants.

## Routes and Navigation
- `/protocols/bitcoin-staking`: Staking ecosystem overview, total locked value, and active parameter versions.
- `/protocols/bitcoin-staking/delegations`: Filterable registry of active, unbonding, and withdrawn delegations.
- `/protocols/bitcoin-staking/delegation/:delegationId`: In-depth view of a specific staking output, scripts, and timelocks.
- `/protocols/bitcoin-staking/finality-providers`: Directory of registered finality providers with uptime and delegated stake.
- `/protocols/bitcoin-staking/finality-provider/:providerId`: Detailed provider profile, EOTS public keys, and historical votes.
- `/protocols/bitcoin-staking/parameters`: Global consensus parameters governing staking timelocks and limits.
- `/protocols/bitcoin-staking/evidence`: Cryptographic evidence registry for double-signing and slashing events.
- `/protocols/bitcoin-staking/reconciliation`: Cross-chain audit tool comparing Bitcoin layer-1 UTXOs with PoS voting weights.

## API Contracts
- `GET /api/v1/intelligence/bitcoin-staking/overview`: High-level metrics including total staked sats and active providers.
- `GET /api/v1/intelligence/bitcoin-staking/delegations`: List of observed staking delegations with state filtering.
- `GET /api/v1/intelligence/bitcoin-staking/delegations/:delegationId`: Comprehensive metadata for a single delegation.
- `GET /api/v1/intelligence/bitcoin-staking/providers`: Active finality providers and delegated satoshi totals.
- `GET /api/v1/intelligence/bitcoin-staking/providers/:providerId`: Provider configuration and EOTS public key commitments.
- `GET /api/v1/intelligence/bitcoin-staking/parameters`: Current network parameter rules and script templates.
- `GET /api/v1/intelligence/bitcoin-staking/evidence`: Registry of cryptographic slashing evidence incidents.
- `POST /api/v1/intelligence/bitcoin-staking/transactions/verify`: Script and covenant validation for staking transactions.
- `POST /api/v1/intelligence/bitcoin-staking/reconcile`: Stake-to-voting-power discrepancy calculation engine.
