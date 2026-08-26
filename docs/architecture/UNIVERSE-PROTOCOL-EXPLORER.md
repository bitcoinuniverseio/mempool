# Universe Protocol Explorer Architecture

Status: living document. Established 2026-08-26 with the fork base (upstream v3.3.1).

## Product

Universe Explorer is the Bitcoin Universe fork of the Mempool Open Source Project.
It preserves the proven live-chain mental model of the upstream explorer (mempool
first, projected blocks, fee market, block/transaction/address pages) and adds
first-party Universe protocol intelligence: every supported protocol operation and
asset-bearing UTXO becomes visible in the correct block, transaction, address, and
outpoint context, backed by exact authoritative evidence from Universe-owned
indexers. The explorer is read-only.

## System layout

```
Universe Explorer Frontend (Angular, forked)
        |
        | same public HTTPS origin (nginx gateway, port 443 only)
        |
        +------------------------------+
        |                              |
        v                              v
Forked Mempool Backend          Universe Protocol Overlay
(Node/TypeScript, MySQL,        (aggregation + evidence layer,
 Redis, WebSocket)               read-only, batched)
        |                              |
        |                              +----------------------+
        |                              |                      |
        v                              v                      v
Private Bitcoin Core v31      Existing Universe        Universe media
+ Fulcrum Electrum            protocol indexers        and content services
(universe-indexer-01)         (universe-indexer-01,    (shared B2-backed
                               Docker + systemd)        media architecture)
```

### Base layer (forked Mempool backend)

Authoritative for Bitcoin blocks, transactions, mempool state, fee market,
projected blocks, RBF/full-RBF, CPFP, mining data, and base transaction detail.
The upstream architecture is retained unchanged: Angular frontend, Node/TypeScript
backend, MySQL, Redis, WebSocket, Bitcoin node integration. No React rewrite.

Data sources are exclusively Universe-owned: Bitcoin Core v31 on
universe-indexer-01 (private RPC, reached through the established SSH tunnel /
private network path, never exposed publicly) and the existing Fulcrum 2.1.1
Electrum server for address lookups. The live `universe-mempool.service` gateway on
universe-indexer-01 is a separate pre-existing system and is not touched by this
deployment.

### Universe Protocol Overlay

A derived read layer that aggregates the existing Universe protocol indexers. It:

- joins evidence by block, transaction, input, output, outpoint, and address;
- maintains checkpoint and reorg evidence (see `docs/data/CHECKPOINTS-AND-REORGS.md`);
- precomputes block protocol summaries as blocks confirm;
- serves batched transaction/outpoint/address enrichment (no N+1);
- publishes live protocol deltas over a bounded, versioned WebSocket namespace;
- caches immutable confirmed results keyed by network, block hash, txid, outpoint,
  protocol id, source release SHA, and reorg epoch;
- never becomes a new protocol indexer: canonical-per-protocol balance and
  ownership state stays in each protocol authority.

Ownership of the overlay (module in `backend-apis` vs. module in the forked
backend) is decided in `ADR-PROTOCOL-OVERLAY.md`.

### Data policy

Runtime blockchain and protocol truth comes only from Universe-owned nodes,
mempool infrastructure, indexers, databases, and authenticated APIs. The
production build must not call mempool.space, Mempool enterprise/accelerator
services, public Esplora/Electrum, third-party protocol indexers, third-party
analytics, or third-party font CDNs. Competitors are research and differential-test
references only. The browser never calls internal indexers directly; all indexer
credentials and topology stay server-side. See
`docs/research/outbound-dependency-audit.md` for the classified outbound inventory
and replacements.

### Correctness policy

No asset movement is inferred from transaction shape alone. Every protocol claim
carries exact authoritative evidence (`ExplorerSourceEvidence` with checkpoint
bracketing). Empty results render as "No supported assets" only when the relevant
authority provides complete negative proof at the same checkpoint
(`negativeCompleteness = true`); otherwise the UI shows explicit
incomplete/pending/stale/unknown states. Buyer/seller/trade language is never
derived from heuristics. Amounts are serialized as decimal strings end-to-end.

### Public RUNES identity

The explorer exposes exactly one public Rune protocol identity: `runes`. Any
legacy `runes_native` adapter evidence is mapped into `runes` server-side,
deduplicated, and excluded from public navigation, filters, search, API schemas,
and labels.

## Networks

Bitcoin mainnet first; testnet/testnet4/signet retained as upstream supports them,
enabled per environment only when a first-party Universe authority exists for that
network. Dogecoin/Fractal/other network views are added only after first-party
node + indexer authorities are verified for that chain; protocol evidence is
strictly chain-isolated.

## Naming and legal

Product name: Universe Explorer. All Mempool Holdings trademarks, logos, and
slogans are removed from the public deployment (see
`docs/legal/TRADEMARK-AUDIT.md`); AGPL obligations are honored via the public
source/about page and `docs/legal/AGPL-COMPLIANCE.md`. Upstream maintainability is
preserved by isolating Universe changes (`frontend/src/app/universe/`,
`backend/src/universe/`, or the external overlay service) and by the scheduled
upstream synchronization procedure in `docs/operations/UPSTREAM-SYNC.md`.
