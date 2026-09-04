# Consensus Upgrade, Covenant, and Vault Lab

## Overview
The Consensus Upgrade, Covenant, and Vault Lab provides a rigorous testing, simulation, and specification ground for soft fork proposals, Bitcoin covenant mechanisms, and advanced custody architectures. It includes a versioned proposal registry, a covenant state-machine simulator, and an interactive visual vault designer.

## Key Capabilities
1. **Pinned Consensus Proposal Registry**:
   - Authoritative tracking of active and historical proposals including BIP119 (OP_CHECKTEMPLATEVERIFY), BIP347 (OP_CAT), BIP443 (Great Script Restoration), LNHANCE, and CSFS.
   - Comprehensive technical parameters: activation mechanisms, deployment state, witness cost impacts, and expressiveness tiers.
2. **Covenant Simulation Engine**:
   - Step-by-step transaction simulation verifying input encumbrances, recursive covenants, timelock assertions, and target output commitments.
3. **Visual Vault Designer**:
   - Guided builder for noncustodial vault structures: hot key unvaulting, timelock delays, recovery clawback paths, and emergency sweeps.
   - Generates executable Miniscript and descriptor templates ready for deployment.
4. **Proposal Comparison Matrix**:
   - Side-by-side technical evaluation across security assumptions, complexity, recursion capability, and ecosystem consensus readiness.

## Endpoints and Routes
- `/labs/consensus`: Catalog of active soft fork and covenant proposals.
- `/labs/consensus/:proposalId`: Detailed proposal specification, opcode dynamics, and test vectors.
- `/labs/consensus/compare`: Side-by-side matrix comparing proposals by technical attributes.
- `/labs/vaults`: Overview of Bitcoin vault custody models and architecture patterns.
- `/labs/vaults/designer`: Interactive visual drag-and-drop vault state machine builder.
- `/labs/vaults/simulate`: Sandbox simulating unvaulting sequences, timelocks, and recovery spends.
