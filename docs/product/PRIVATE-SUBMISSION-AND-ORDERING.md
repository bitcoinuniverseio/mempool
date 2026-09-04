# Private Transaction Submission, Accelerator, and Ordering Evidence Center

## Product Overview
The Private Transaction Submission, Accelerator, and Ordering Evidence Center provides an integrated interface for direct encrypted miner submission, out-of-band transaction acceleration diagnostics, signed cryptographic proof verification, and empirical detection of block ordering discrepancies and miner extractable value (MEV).

## Problem Statement
The growth of private transaction submission channels and paid miner acceleration introduces structural risks to Bitcoin mempool transparency:
- Front-Running and MEV: Transactions broadcast across public gossip networks can be inspected and replaced by MEV arbitrage bots before block inclusion.
- Out-of-Band Fee Opacity: When miners accept private payments outside the blockchain to prioritize low-feerate transactions, standard block templates and fee estimators produce inaccurate projections.
- Verification Deficit: Users who pay third-party accelerators often receive unverified claims regarding inclusion guarantees without non-repudiable cryptographic receipts.
- Lack of Diagnostics: Senders with stuck transactions cannot easily determine whether CPFP, RBF, or miner acceleration is the most cost-effective path.

## Architecture and Subsystems

### 1. Unified Submission Selector & Pre-Flight Diagnostic
Evaluates transaction hex or txid against current mempool state:
- Computes effective feerate, RBF eligibility, and CPFP parent-child dependencies.
- Recommends the optimal remedy (local fee-bump vs private miner acceleration).

### 2. Direct Miner Private Broadcast Interface
Enables direct injection of raw transactions to participating mining pools:
- Transmits transactions over encrypted TLS/Tor connections directly to pool gateway endpoints.
- Avoids public p2p mempool propagation until block inclusion, protecting transaction privacy.

### 3. Accelerator Directory & Cryptographic Receipt Verifier
Indexes audited miner acceleration services:
- Audits global hashrate reach, pricing models, and confirmed inclusion rates.
- Cryptographically verifies Ed25519-signed or Schnorr-signed accelerator receipts issued by mining pools.

### 4. Block Ordering Evidence & Anomaly Detection Pipeline
Monitors newly mined blocks to detect deviations from knapsack fee-rate ordering:
- Flags transactions included at low feerates at the top of a block while higher-paying public transactions are omitted.
- Quantifies estimated out-of-band revenue captured by mining pools.
- Generates probabilistic classification labels (such as `out_of_band_accelerated` or `private_miner_pool_flow`).

## User Interface Routes
- `/mempool/submission`: Unified transaction submission selector, status metrics, and diagnostic tool.
- `/mempool/private-broadcast`: Direct encrypted transaction injection to partner mining pools.
- `/mempool/accelerators`: Directory of verified transaction acceleration providers and fee rates.
- `/mempool/accelerator/:providerId`: Provider technical profile, API endpoints, and hashrate coverage.
- `/mempool/receipts`: Independent cryptographic verification of signed acceleration receipts.
- `/intelligence/ordering`: Real-time observatory for anomalous block inclusions and MEV activity.
- `/intelligence/ordering/tx/:txid`: Forensic ordering proof and discrepancy score for an individual transaction.
- `/intelligence/ordering/block/:blockHash`: Block-level ordering audit and out-of-band fee estimation.
