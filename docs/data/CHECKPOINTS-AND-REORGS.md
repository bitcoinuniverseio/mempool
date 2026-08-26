# Checkpoints and reorg handling

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
