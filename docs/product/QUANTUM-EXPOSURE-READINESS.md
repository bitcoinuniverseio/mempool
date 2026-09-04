# Quantum Exposure and Migration Readiness Center

## Overview
The Quantum Exposure and Migration Readiness Center measures and tracks the exposure of the Bitcoin UTXO set to potential elliptic curve cryptography compromises (Shor's algorithm). It differentiates between hash-protected script outputs and directly exposed public keys, logs historical public key reveals, and provides a noncustodial migration planner.

## Architecture and Cryptographic Classifications
1. **UTXO Vulnerability Cohorts**:
   - **Direct Public Key Exposure**: P2PK (Pay-to-Pubkey) outputs and keypath-spendable Taproot (P2TR) outputs where the public key is known prior to spend.
   - **Address Reuse Exposure**: P2PKH and P2WPKH outputs where a previous transaction on the same address has revealed the public key in a witness or scriptSig.
   - **Hash-Protected Outputs**: P2PKH, P2SH, P2WPKH, and P2WSH unspent outputs protected by preimage resistance (SHA256 and RIPEMD160) until spent.
2. **Public Key Reveal Timeline**:
   - Real-time event log tracking newly exposed public keys revealed onchain during transaction spend inputs.
3. **Local Public Audit**:
   - In-browser evaluation of user-provided addresses or xpubs without disclosing identity or balance to remote servers.
4. **Noncustodial Migration Planner**:
   - Algorithmic batching and transition planning to migrate funds into hash-protected or quantum-hardened script structures while minimizing onchain transaction fees.

## Endpoints and Routes
- `/intelligence/quantum`: Macro quantum vulnerability metrics and supply exposure percentages.
- `/intelligence/quantum/exposure`: Script standard cohort breakdown across P2PK, P2PKH, P2SH, SegWit, and Taproot.
- `/intelligence/quantum/history`: Real-time feed of historical public key and script reveals.
- `/intelligence/quantum/audit`: Client-side audit tool for personal public keys, addresses, and outpoints.
- `/intelligence/quantum/migration`: Migration planner generating noncustodial transaction batches for fund safety.
