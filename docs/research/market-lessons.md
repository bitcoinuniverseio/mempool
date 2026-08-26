# Market lessons that changed the build

Research pass completed 26 August 2026. This file exists so research is
accountable: each lesson names the decision it produced, and each rejected idea
names the reason.

Companion documents: `competitive-landscape.md` (per-product analysis),
`competitive-landscape.json` (machine-readable matrix),
`source-ledger.md` (claim to source traceability),
`emerging-trends.md` (what changed in the market this year),
`docs/product/EXPERIENCE-BRIEF.md` (the position these lessons produced).

## Lessons that produced code

### 1. The strongest mempool explorer will not decode metaprotocols

Upstream tags inscription envelopes and runestones but refuses to integrate an
asset indexer, as a stated policy. That is a durable gap, not a backlog item.

**Built:** the asset flow section on every transaction page, resolving tags into
authority-proven positions per input and output.

### 2. Every asset-centric explorer in this market is closed and hosted

UniScan, Ordiscan, GeniiData, Best in Slot, and the exchange explorers are all
closed source and none is self-hostable. A user cannot verify their indexer, and
2026 showed what happens when a hosted protocol data source is withdrawn.

**Built:** first-party authorities only, plus a public `/source` page that names
the exact running commit, so the trust claim is checkable rather than asserted.

### 3. Asset pages are judged on mint progress, supply, and holders

Every serious protocol explorer leads its asset page with those figures.

**Built:** the rune page shows mints against the cap as a floored percentage,
premine, burned, divisibility-scaled supply, and the mint window, all read from
the authority. Where terms carry no cap, the page says there is no progress to
report rather than drawing a meaningless bar.

### 4. Rare-sat and UTXO inspection is a real, underserved job

Ordiscan's rare-sat and UTXO tooling exists because holders need to know which
specific output carries a specific thing.

**Built:** `/outpoint/:txid/:vout` as a first-class page, `/sat/:number` with the
rule that produces the rarity, and outpoint links from every position row.

### 5. Live visualization drives return visits

TxStreet, Bitfeed, and the upstream projected-block view all show that watching
the mempool is itself the product for a large audience.

**Built:** the pulse page. It is not decorative: it publishes the number of
transactions checked alongside every protocol count, so the visualization is
also a measurement.

### 6. Watchlists and alerts are a product category that harvests privacy

Third-party trackers log the addresses their users watch.

**Built:** saved pages, recent history, and pinned protocols in local storage,
with a single button that erases all of it and a privacy page that says so.
No account, no server-side list.

### 7. Speed and the absence of trackers are marketable positions

3xpl competes on exactly those two claims.

**Built:** no analytics of any kind (the upstream hosted tracker path is a
documented no-op), no remote fonts, no third-party requests at runtime or at
build time, and an automated gate that fails the build if one appears.

### 8. Bitcoin Core v30 removed the effective OP_RETURN limit

Released 10 October 2025, `-datacarriersize` defaults to 100,000 bytes, so
data-carrying transactions are no longer filtered by a default Core mempool
while Knots operators keep filtering them.

**Built:** protocols whose instructions live in data outputs are described in
those terms on the protocol pages, so a reader understands that relay policy,
not consensus, decides whether such a transaction propagates. Recorded in
`emerging-trends.md` as the next area to instrument.

### 9. Nobody explains what a transaction did in plain language

Every explorer in the set presents fields. None writes a sentence.

**Built:** the plain-language summary at the top of the asset flow section,
generated only from actions the authority reported, and worded so it never
implies a trade.

## Ideas deliberately rejected

| Pattern | Seen in | Why not |
| --- | --- | --- |
| Paid transaction acceleration | upstream | A centralized commercial service that has no place in a self-hosted, read-only explorer. Removed from this fork entirely. |
| Explorer as a marketplace funnel | UniSat, OKX, Magic Eden | Creates an incentive to present assets favourably. Neutrality is the product. |
| Hosted analytics on the explorer | upstream | Contradicts the privacy claim. The code path is now inert. |
| Enterprise upsells inside the API docs | upstream | Not this deployment's business model. Removed. |
| Trending lists with unpublished methodology | GeniiData, several asset explorers | A rank nobody can recompute is decoration. Every figure here ships its denominator. |
| Price, market cap, and floor figures | most asset explorers | Requires third-party market data and invites the reading that the explorer offers financial advice. |
| Server-side watchlists and alert accounts | BlockPing and similar | Builds exactly the profile this product refuses to hold. Local storage does the same job. |
| Rendering inscription content inline | several | Executing arbitrary inscribed data inside the explorer's own origin is not worth a preview. |
| An MCP or agent endpoint | Bitquery, Blockscout | Genuinely emerging, but out of scope for this release. The versioned public API is the prerequisite and it exists. |
| Multi-chain expansion | Blockchair, OKLink | The registry lists other chains for completeness and the UI separates them. Serving them is a different product. |

## Closure evidence

Discovery ran in four passes with different strategies: category search,
protocol-family search (Alkanes, Stamps, Atomicals, Runes, TAP, DMT, CAT-20),
adjacent-category search (visualizers, privacy explorers, agent interfaces,
alerting), and directory or aggregator search. The final two passes surfaced
new product names (Atomicals Hub, Atomscan, Bitatom, Wizz, OpenStamp Explorer,
Stampscan, TxCity, Tx.Town, BlocksViewer, Luminex, Esplora, Horizontal Systems
Block Explorer) but no new competitor category, capability class, user
expectation, or trend beyond those already recorded. Queries and dates are in
`source-ledger.md`.
