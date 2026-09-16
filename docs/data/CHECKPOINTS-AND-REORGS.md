# Checkpoints and reorg handling

## Backend template and blockspace observations

Mined-block template comparisons require the same height **and parent hash**,
with template observation no later than block receipt. The comparison uses the
highest-fee eligible collected template and reports age from observer timestamps,
not miner-controlled block timestamps. An in-flight Core template targeting an
old parent cannot replace the tracked tip after a block callback. Next-block
projections carry the current observed parent rather than a previous template's
parent. Selection differences do not establish why a miner chose a transaction.

When a block at an already-observed or lower height replaces the branch,
blockspace regimes are recomputed from retained canonical tallies. Orphaned and
evicted tallies no longer contribute fees, regimes or checkpoints. Regime fee
statistics use the actual median of retained samples, and observation times
remain the original times. This is bounded retained history, not a claim that
the process holds every historical block.

## Checkpoints

Every protocol authority exposes its indexing checkpoint (height + block hash).
The overlay reads evidence with checkpoint bracketing:

1. read the source checkpoint;
2. fetch the evidence;
3. read the source checkpoint again;
4. require the same height and block hash on both reads;
5. reject and retry (bounded) on mismatch; surface `stale`/`pending` when the
   bracket cannot be satisfied.

Evidence from different sources is joined only with each source's own
checkpoint attached; the overlay never mixes evidence into one claimed
checkpoint that the sources did not individually prove.

## Reorg epochs

The overlay maintains a monotonically increasing reorg epoch per
chain/network. Cache keys and derived summaries embed the epoch, so a reorg
invalidates by key namespace rather than by mass deletion.

On reorg detection (base chain hash mismatch at a height, or an authority
reporting reorgDetected):

1. locate the common ancestor with the Bitcoin authority;
2. invalidate derived block summaries and transaction flows above it;
3. increment the reorg epoch;
4. remove orphaned protocol events from current views while preserving audit
   history;
5. replay the new branch through the enrichment pipeline;
6. publish a `universe:block-reorged` WebSocket event;
7. invalidate stale cursors and cache keys (epoch-scoped keys age out).

If a protocol source cannot reconcile the reorg, that protocol is marked stale
or unavailable for the affected range; the base Bitcoin block display is never
hidden, and orphaned assets are never shown as current.

## Cache domains

Cache keys bind: network, block hash, txid, outpoint, protocol id, source
release SHA, and reorg epoch. Immutable confirmed results may cache
indefinitely; pending/mempool results carry bounded TTLs.
