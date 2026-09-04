# Blockspace Demand and Transaction Semantics Terminal

## Overview
The Blockspace Demand and Transaction Semantics Terminal provides profound visibility into the composition, economic utilization, and intent classification of Bitcoin blockspace. It decomposes blocks beyond simple byte sizes into primary semantic functions: simple monetary payments, multi-output batching, UTXO consolidation, Layer 2 channels, inscriptions, and token protocols.

## Key Capabilities
1. **Primary Transaction Taxonomy**:
   - Additive multi-class taxonomy classifying transactions into monetary transfers, infrastructure operations, arbitrary data payloads, and Layer 2 lifecycle actions.
   - Secondary semantic tags: SegWit versioning, RBF signaling, CPFP packages, locktime enforcement, and change output heuristics.
2. **Composition Timeseries and Weight Breakdown**:
   - Granular block-by-block and rolling window timeseries tracking block weight and fee density by semantic category.
3. **Fee and Demand Regime Detector**:
   - Algorithmic identification of network demand regimes: consolidation-friendly periods, baseline monetary standard, data minting spikes, and extreme congestion waves.
4. **Transaction Semantic Evidence**:
   - Contextual evidence cards embedded in transaction and block inspection views detailing why a specific transaction was classified into its semantic category.

## Endpoints and Routes
- `/intelligence/blockspace`: Real-time blockspace demand dashboard, active regime, and consumption breakdown.
- `/intelligence/blockspace/composition`: Detailed historical timeseries of block weight allocation across semantic classes.
- `/intelligence/blockspace/regimes`: History of detected fee and demand regimes across Bitcoin blocks.
- `/intelligence/blockspace/compare`: Comparative differential tool inspecting fee and weight metrics between two regimes.
- `/intelligence/blockspace/taxonomy`: Authoritative catalog defining every transaction class, pattern, and criteria.
