# Reserves and Solvency Verification Center

## Overview
The Reserves and Solvency Verification Center delivers transparent, mathematically verifiable proof-of-reserves and liability auditing for custodial exchanges, asset bridges, and institutional custodians. It supports BIP127 cryptographic proof packages, historical UTXO validation, and Merkle sum tree liability verification.

## Architecture and Cryptographic Verification
1. **BIP127 Proof-of-Reserves Package Validator**:
   - Parses and validates standard BIP127 proof packages containing UTXO outpoints, addresses, signatures, and attestation messages.
   - Verifies digital signatures directly against Bitcoin public keys and confirms that referenced outputs exist and are unspent at the declared block snapshot height.
2. **Merkle Sum Tree Liability Verification**:
   - Verification of Merkle tree roots committing to total client liabilities and account balances.
   - Non-negative balance constraint auditing ensuring no negative balance accounts artificially diminish reported liabilities.
3. **Client-Side Customer Inclusion Checker**:
   - End users can privately verify that their specific account balance and leaf hash are correctly included in a published solvency snapshot without disclosing account credentials.
4. **Attestation History and Provider Directory**:
   - Transparent directory of participating institutions, reporting cadence, historical solvency ratios, and verified onchain snapshot archives.

## Endpoints and Routes
- `/intelligence/reserves`: Solvency overview, total tracked assets versus liabilities, and active providers.
- `/intelligence/reserves/providers`: Directory of participating custodial entities, exchanges, and token bridges.
- `/intelligence/reserves/provider/:providerId`: Longitudinal solvency record, attestation cadence, and snapshots for a single institution.
- `/intelligence/reserves/snapshot/:snapshotId`: Complete block context, Merkle root, and UTXO proof data for an individual snapshot.
- `/intelligence/reserves/verify`: Interactive mathematical proof verification tool supporting BIP127 payloads and Merkle inclusion paths.
