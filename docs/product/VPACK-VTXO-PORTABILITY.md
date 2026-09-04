# Ark V-PACK, VTXO Portability, and Unilateral Exit Center

## Product Overview
The Ark V-PACK, VTXO Portability, and Unilateral Exit Center provides an open verification, diagnostic, and exit planning environment for Ark second-layer protocols, Virtual UTXOs (VTXOs), and portable backup packages.

## Problem Statement
Ark introduces an out-of-band payment model built on shared UTXOs, virtual transaction trees, and Ark Service Providers (ASPs). While offering immediate off-chain scalability without open channel liquidity constraints, Ark users encounter unique risks:
- VTXO tree expiration and roll-over deadlines: VTXOs expire after a configured locktime (such as 4 weeks) and must be refreshed before expiry.
- ASP non-responsiveness or insolvency: Users require an unambiguous, automated method to execute unilateral exits back to Layer 1.
- Implementation divergence: Competing Ark clients (such as Arkade and Bark) utilize slightly varying serialization formats for off-chain proofs.
- Lack of standard export containers for user wallets to securely backup and migrate VTXOs across software clients.

## Architecture and Subsystems

### 1. Minimal Viable VTXO & V-PACK Specification
Standardizes the virtual transaction package (V-PACK) container format:
- Cryptographic proof of ASP multisig co-signing.
- Full Merkle branch connecting the leaf VTXO to the on-chain shared round UTXO.
- Absolute block expiration height and spending condition validation.

### 2. Implementation Dialect Translator
Translates between distinct VTXO wire formats:
- Bi-directional conversion between Arkade binary formats and Bark BIP370-extended PSBT representations.
- Guarantees lossless portability of uncommitted off-chain funds across different wallet vendors.

### 3. Client-Side Anchor and Proof Verifier
Validates V-PACK integrity entirely in browser memory:
- Checks Schnorr signatures on virtual transactions.
- Confirms the on-chain round transaction exists on Bitcoin Layer 1 and has not been spent or invalidated.
- Verifies that the VTXO has not expired.

### 4. Unilateral Exit Planner & Fee Anchor Calculator
Generates the cascade of Layer 1 transactions required to unilaterally redeem a VTXO if the ASP goes offline:
- Calculates the transaction tree redemption path down to the user's leaf output.
- Estimates cumulative mempool mining fees required for tree broadcast.
- Configures CPFP fee anchors to enable fee bumping for delayed exit branches.

### 5. Encrypted Backup Container
Provides client-side encrypted backup export (AES-GCM with PBKDF2 passphrases) for cold storage of V-PACK envelopes, supporting offline QR codes and JSON bundle downloads.

## User Interface Routes
- `/ark/vpack`: V-PACK ecosystem overview, active rounds, and monitored ASPs.
- `/ark/vpack/verify`: Interactive verification tool for V-PACK proofs and cryptographic signatures.
- `/ark/vpack/translate`: Format translation utility between Arkade, Bark, and PSBT dialect specifications.
- `/ark/vtxo/:vtxoId`: Deep inspection of a specific virtual UTXO, tree position, and expiration countdown.
- `/ark/backups`: Client-side encrypted backup management and export vault.
- `/ark/exit`: Step-by-step unilateral exit execution wizard.
- `/ark/exit/simulate`: Unilateral exit cost, fee requirement, and timeline simulator.
- `/ark/providers`: Directory of registered Ark Service Providers (ASPs) with parameter manifests.
