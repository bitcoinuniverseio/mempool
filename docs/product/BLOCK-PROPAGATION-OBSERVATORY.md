# Block Propagation, Compact-Block Reconstruction, and Fork-Race Observatory

## Product Overview
The Block Propagation, Compact-Block Reconstruction, and Fork-Race Observatory provides continuous real-time empirical measurements of Bitcoin block propagation speed, BIP152 compact-block reconstruction efficiency, FIBRE backbone relay performance, and near-simultaneous block fork races.

## Problem Statement
The security of Bitcoin proof-of-work consensus relies on rapid, reliable global propagation of newly discovered blocks:
- Slow block propagation increases orphan rates, giving an unfair advantage to large mining pools with centralized high-speed private connections.
- Inefficiencies in compact-block reconstruction (missing transactions requiring extra roundtrips) increase propagation latencies.
- Near-simultaneous block discoveries lead to temporary chain forks, causing 1-block reorgs that impact exchange settlement and zero-conf applications.
- A lack of open, multi-region empirical sensor telemetry prevents developers from measuring the true health of the peer-to-peer gossip network.

## Architecture and Subsystems

### 1. Global Multi-Region Listening Fleet
Operates listening sensors distributed across Europe, North America, Asia-Pacific, and South America:
- Records microsecond-precise timestamps when block announcements (INV / CMPCTBLOCK) first arrive from peer connections.
- Calculates T50%, T90%, and T99% global propagation curves for every mined block.

### 2. BIP152 Compact-Block Reconstruction Engine
Analyzes the efficiency of compact block relays:
- Tracks the proportion of transactions pre-filled from local mempool inventory versus missing transactions requested via `getblocktxn`.
- Evaluates short-ID collision frequencies and reconstruction latency overhead.

### 3. Fork-Race & Stale-Tip Correlation Engine
Detects simultaneous block discoveries:
- Maps regional block arrival splits across worldwide probe nodes.
- Calculates the exact time difference (in milliseconds) between competing candidate blocks.
- Correlates final main-chain winners with historical miner subsidy and fee losses.

### 4. FIBRE (Fast Internet Bitcoin Relay Engine) Comparison Adapter
Monitors high-speed UDP relay performance featuring forward error correction (FEC), comparing transcontinental FIBRE delivery times directly against standard p2p TCP gossip paths.

## User Interface Routes
- `/network/blocks`: Comprehensive block propagation overview, global latency metrics, and recent block arrivals.
- `/network/blocks/live`: Real-time streaming feed of incoming block announcements and probe latencies.
- `/network/blocks/:blockHash`: Deep dive into a specific block arrival timeline across global sensor nodes.
- `/network/compact-blocks`: BIP152 mempool pre-fill efficiency and reconstruction performance data.
- `/network/fork-races`: Historical index of simultaneous block races and split resolution outcomes.
- `/network/fork-races/:raceId`: Detailed case study of a specific fork race including regional split mapping.
- `/network/stale-tips`: Comprehensive record of orphaned blocks, reorg depths, and lost miner rewards.
- `/network/fibre`: Live health and latency metrics for the FIBRE high-speed relay backbone.
