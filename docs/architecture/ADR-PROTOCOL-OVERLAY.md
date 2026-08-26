# ADR: Universe Protocol Overlay ownership and contract

Status: ACCEPTED 2026-08-26
Deciders: Universe engineering (explorer mission)
Input: ecosystem reconciliation (D:\universe\reports\universe-ecosystem-reconciliation-20260826-031715.md)
and the indexer API inventory of 2026-08-26 (docs/research/indexer-inventory.md).

## Context

The explorer needs a derived read layer ("Universe Protocol Overlay") that joins
protocol evidence from ~25 existing Universe indexers by block, transaction,
outpoint, and address, with checkpoint bracketing, batching, caching, and live
deltas. Two candidate homes existed:

1. a module inside the forked mempool backend (`backend/src/universe/`);
2. a module/service inside `backend-apis` (the existing NestJS aggregation tier).

## Findings that drove the decision

- No indexer exposes a `/v1/explorer/*` contract today. The de-facto ecosystem
  standard is the Marketplace v1 authority surface: `/live`, `/ready`, `/status`,
  `/v1/checkpoint`, and checkpoint-bound outpoint position lookups
  (`/v1/marketplace/positions/outpoints/:outpoint?heightAtomic=&blockHash=` or
  `/v1/marketplace/protocols/:protocolId/position-source/outpoints/:outpoint`),
  sharing schema id `universe-marketplace-protocol-position-v1`.
- `backend-apis` already holds per-indexer HTTP clients, marketplace adapters,
  the `@bitcoinuniverse/ecosystem-contracts` package (protocol capability ids and
  the 29-protocol `MARKETPLACE_PROTOCOL_REGISTRY`), multi-tier auth, and PM2
  deployment. Rebuilding those clients inside the fork would duplicate them.
- The forked mempool backend must stay close to upstream for mergeability
  (see UPSTREAM-SYNC.md); a large aggregation subsystem inside the fork would be
  a standing merge liability.
- Block-level protocol event queries are missing from most indexers (only a few
  expose blocks/:height or mempool views), so the overlay must add bounded
  read endpoints to indexers over their existing canonical databases - work that
  belongs next to the existing indexer client code.

## Decision

The Universe Protocol Overlay is implemented as an isolated module inside
`backend-apis` (`bitcoinuniverseio/backend-apis`), deployed as its own PM2
process, exposed publicly only through the same-origin HTTPS gateway of the
explorer under `/api/v1/universe/*` and the `universe:*` WebSocket namespace.

The forked mempool repository receives only thin integration:

- `frontend/src/app/universe/` - Angular components/services for protocol UI,
  calling same-origin `/api/v1/universe/*`;
- `backend/src/universe/` - minimal glue only where the upstream backend must
  surface Universe data inside existing responses (kept as small as possible);
- nginx/gateway config routing `/api/v1/universe/` and `/api/v1/universe/ws`
  to the overlay service.

The overlay:

- speaks the standard explorer authority contract (docs/data/ASSET-EVIDENCE.md)
  to indexers, adapting today's Marketplace v1 position-source surface where it
  already satisfies the contract, and driving the addition of the smallest
  missing read endpoints (block events, batch lookups) to each indexer over its
  existing canonical database - never a second scanner;
- owns checkpoint bracketing, reorg epochs, derived block summaries, caching,
  and WebSocket delta publication;
- maps any legacy `runes_native` evidence into canonical `runes` with
  deduplication; `runes_native` never appears in public schemas.

## Consequences

- The fork stays mergeable with upstream; explorer-specific aggregation logic
  evolves in backend-apis with the existing indexer clients and contracts.
- backend-apis gains a new versioned public namespace (`/api/v1/universe/*`)
  documented via OpenAPI; existing marketplace fail-closed evidence semantics
  are reused, not weakened.
- Indexer changes are bounded read endpoints only, one repo at a time, with
  docs updated in each repo's four-repo documentation set.
- The explorer frontend has exactly one aggregate enrichment call per view
  (no browser-to-indexer traffic, no N+1).
