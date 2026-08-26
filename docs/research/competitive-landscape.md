# Competitive Landscape: Bitcoin Protocol-Aware Explorers

**Draft, August 2026.** Research for "Universe Explorer": a self-hosted, protocol-aware
fork of mempool.space that shows exact asset flows across transaction inputs/outputs,
backed by authoritative indexer evidence (never heuristics).

Verdict legend: **ADOPT** = adopt the principle · **IMPROVE** = do it, but better ·
**REJECT** = deliberately do not do this · **OOS** = out of scope for Universe Explorer.

---

## 1. mempool.space

**URL:** https://mempool.space · Open source (mempool/mempool on GitHub), AGPL-style licensing with enterprise tier.

**What it is.** The de-facto reference Bitcoin explorer, centered on the mempool rather
than the chain: live fee market, projected (audited) blocks, mining dashboards, and a
Lightning explorer. Actively developed, v3.0 (Accelerator/Goggles integration,
full-RBF timelines), v3.2 (April 2025: UTXO bubble chart, Stratum job visualizations,
address-poisoning warnings, runestone tags, package broadcast, PSBT previews), v3.3
(Taproot script-tree visualization, sighash icons/highlighting, stale-block
comparisons, sub-1 sat/vB support, new REST endpoints incl. `/address/:addr/utxo` and
merkle proofs on non-Esplora backends).

**Protocol support.** Deliberately minimal. It tags transactions that contain
inscription envelopes or runestones (Mempool Goggles filters, runestone tags) but the
maintainers have publicly stated they will not integrate `ord` or any metaprotocol
indexer, it displays what is in the mempool/blockchain, nothing interpreted. No
BRC-20 balances, no Runes decoding beyond tagging, no Ordinals content rendering.

**Signature features.**
- Live mempool "goggles" visualization: block-shaped grid of pending txs, colored by fee/type filters.
- Projected blocks + block audit (expected vs. actual block composition; detects prioritized/excluded txs).
- Full-RBF replacement timelines (tree of replacements with timestamps and fee deltas).
- CPFP/effective-fee computation and package relationships.
- Accelerator (paid out-of-band acceleration via partner pools), off-chain commercial service.
- Mining dashboards: pool dominance, hashrate, difficulty adjustment, Stratum job monitoring, DATUM/coinbase tags.
- Address pages with UTXO endpoint, taproot script tree rendering, PSBT/raw-tx preview tool, address-poisoning detection.
- Self-hostable (Umbrel/Start9/Docker); first-class REST + WebSocket APIs; Liquid + Testnet4 + regtest support.

**Strengths.** Best-in-class mempool UX and visual language; strong self-hosting story;
excellent mobile/responsive design; healthy release cadence; trusted brand.

**Weaknesses.** Protocol-blind by ideology, a Runes/Ordinals/Alkanes user cannot see
what assets a transaction actually moves; asset "tags" are recognition, not accounting;
Accelerator/enterprise services are centralized; Angular frontend is heavy to fork and
track upstream.

| Feature | Verdict | Reasoning |
|---|---|---|
| Mempool goggles / live block-grid viz | **ADOPT** | The core visual metaphor is proven; extend filters to protocol-aware categories (inscription reveal, rune mint, alkane call) driven by indexer evidence. |
| Projected blocks + block audit | **ADOPT** | Audit-style "expected vs. actual" thinking matches the evidence-first ethos; keep as-is from the fork base. |
| Full-RBF replacement timelines | **IMPROVE** | Keep the timeline, but add what replacement means for pending asset transfers (e.g. a replaced rune mint), no one shows that today. |
| Runestone/inscription *tagging without decoding* | **IMPROVE** | Tagging is heuristic recognition; Universe must resolve tags to authoritative indexer state (asset IDs, amounts, edicts) per input/output. |
| Accelerator (paid out-of-band) | **REJECT** | Commercial, centralized, irrelevant to a self-hosted evidence-focused explorer. |
| Mining/Stratum dashboards | **OOS** | Valuable but orthogonal to asset-flow goals; inherit from fork base without investment. |
| Lightning explorer | **OOS** | Different domain; keep disabled to reduce operational surface. |
| REST/WebSocket API + self-host packaging | **ADOPT** | Table stakes; extend the same API style with asset-flow endpoints. |
| UTXO bubble chart / address UTXO endpoint | **IMPROVE** | Extend UTXO views to show attached assets (inscriptions, rune balances, stamps) per outpoint, the natural home for outpoint-level evidence. |
| Address-poisoning warnings, PSBT preview | **ADOPT** | Cheap safety wins already in the fork base; keep. |

---

## 2. UniScan (uniscan.cc)

**URL:** https://uniscan.cc · Operated by the UniSat team. Closed source.

**What it is.** An "all-in-one" explorer for Bitcoin and Fractal Bitcoin covering
addresses, transactions, blocks, and assets across UniSat's indexer stack. In 2025–26
it expanded to Alkanes and "brc2.0" alongside Ordinals, BRC-20, and Runes, currently
the broadest protocol coverage of any mainstream explorer, reflecting UniSat's
position as an Alkanes ecosystem partner.

**Protocol support.** Ordinals/inscriptions, BRC-20 (incl. brc2.0), Runes, Alkanes;
Fractal Bitcoin network variants of the same.

**Signature features.**
- Unified search across addresses, txids, blocks, inscription IDs, tickers, rune names, alkane IDs.
- Asset-centric pages: token detail pages with holders, mint progress, transfer history.
- Address asset portfolios spanning multiple metaprotocols in one view.
- Tight coupling to UniSat wallet + marketplace (view → trade funnel).
- Dual-network (Bitcoin + Fractal) switching.

**Strengths.** Widest live protocol matrix (only major explorer with Alkanes); backed
by UniSat's mature indexers; asset pages are genuinely useful for traders.

**Weaknesses.** Closed source, not self-hostable; you must trust UniSat's indexer
without independent verification; blocks scraping (403s on plain fetches); mempool-level
insight is thin compared to mempool.space; ecosystem conflict of interest (explorer as
marketplace funnel).

| Feature | Verdict | Reasoning |
|---|---|---|
| Multi-protocol asset portfolio per address | **ADOPT** | One address page showing all metaprotocol holdings is exactly what protocol-aware means; back it with per-outpoint evidence. |
| Alkanes support | **ADOPT** | Emerging smart-contract metaprotocol with real traction; supporting it early is a differentiator. |
| Token pages (holders, mint progress) | **IMPROVE** | Useful, but add provenance: which indexer snapshot, which block height, verifiable via API. |
| Fractal network support | **OOS** | Sidechain/altnetwork support dilutes focus; Universe targets Bitcoin mainnet (+test networks). |
| Marketplace/wallet integration funnel | **REJECT** | Trading funnels compromise neutrality; Universe is evidence infrastructure, not a storefront. |
| Closed-source trusted indexer | **REJECT** | The core thing Universe exists to fix: asset claims must be reproducible on self-hosted indexers. |

---

## 3. Ordiscan (ordiscan.com)

**URL:** https://ordiscan.com · Independent, closed source frontend with public API.

**What it is.** A clean, focused Ordinals-ecosystem explorer: inscriptions, runes,
rare sats, BRC-20, and collections, with a well-documented REST API and even an MCP
server integration for AI agents.

**Protocol support.** Ordinals/inscriptions, BRC-20, Runes, rare sats (satributes), collections.

**Signature features.**
- Per-address views split by asset class (inscriptions / runes / BRC-20 / rare sats).
- API: BRC-20 balances, address activity checks, tx-level info, rare-sat lookup, inscription transfer history per address.
- Collections browsing with metadata.
- MCP server exposing the API to LLM tooling, an early "explorer as agent data source" move.

**Strengths.** Simple, fast, readable UX; API-first mindset; inscription *transfer
history* (not just current location) is closer to flow-tracking than most.

**Weaknesses.** Not self-hostable; no mempool/pending view to speak of; no Alkanes/
Stamps/Atomicals; tx pages show involvement, not exact per-input/per-output asset
accounting; depends on third-party indexer infrastructure.

| Feature | Verdict | Reasoning |
|---|---|---|
| Per-address inscription transfer history | **IMPROVE** | History is the right idea; Universe should generalize it to full outpoint-level flow lineage for every asset type. |
| Asset-class-segmented address tabs | **ADOPT** | Clear information architecture for multi-protocol portfolios. |
| Public REST API with per-asset endpoints | **ADOPT** | Matches Universe's API-first, evidence-serving goals. |
| MCP/agent-accessible data interface | **ADOPT** | Cheap and forward-looking for a self-hosted tool; agents are real API consumers in 2026. |
| Rare-sat (satributes) tracking | **OOS** | Sat rarity is a niche collectible layer; only include if the ord indexer provides it for free. |

---

## 4. Ord.io, DEFUNCT

**URL:** was https://ord.io · **Shut down June 1, 2026** (with its trading app Zap), citing financial unsustainability after ~3 years and 1M+ users.

**What it was.** A social-flavored Ordinals explorer: browse/sort/vote on inscriptions
by content type (image, text, audio, games), satributes for rare-sat analysis, and
real-time Runes mint tracking.

**Protocol support (historical).** Ordinals/inscriptions, Runes, rare sats.

**Strengths (historical).** Best content-first browsing UX; made inscriptions legible
to non-technical users; real-time mint feeds.

**Weaknesses / lesson.** Venture-funded consumer explorer with no durable revenue, the shutdown is the cautionary tale for explorer sustainability. Social features
(votes, profiles) did not save it.

| Feature | Verdict | Reasoning |
|---|---|---|
| Content-type browsing/rendering of inscriptions | **IMPROVE** | Rendering inscription content well matters, but tie it to sandboxed, self-hosted content serving (ord-style), not a curation feed. |
| Social voting/curation layer | **REJECT** | Adds moderation burden and no evidentiary value; Ord.io's fate shows it isn't a moat. |
| Real-time Runes mint tracker | **ADOPT** | Live mint activity in the mempool is a natural protocol-aware extension of the mempool.space live view. |
| VC-funded free consumer service model | **REJECT** | Universe is self-hosted infrastructure; sustainability comes from being software, not a service. |

---

## 5. Blockstream Explorer / Esplora (blockstream.info)

**URL:** https://blockstream.info (now also esplora.blockstream.com) · Fully open source (Blockstream/esplora + electrs backend).

**What it is.** The reference open-source explorer stack: `esplora` frontend + HTTP
API over an `electrs` fork, covering Bitcoin, Testnet, and Liquid. Widely self-hosted;
its REST API surface became a de-facto standard (mempool.space implements a
compatible API).

**Protocol support.** None beyond base Bitcoin/Liquid. Liquid side: confidential
transactions, peg-in/out, multi-asset (issued assets), notable because Liquid asset
display is *consensus-level* asset accounting, shown per output.

**Signature features.**
- Precise low-level tx detail: script hex/asm, witness data, outpoint navigation (previous output ↔ spending tx links).
- Clean REST API (tx, address, UTXO, broadcast, fee estimates, asset metadata on Liquid).
- Tor onion service, no tracking, noscript support; 17 languages; light/dark modes.
- Docker-based self-hosting; runs against your own node.

**Strengths.** Privacy posture (Tor, no trackers, works without JS); the outpoint-level
navigation model; battle-tested self-host path; API standardization.

**Weaknesses.** Static feel, no live mempool visualization, no RBF timelines, no
projected blocks; zero metaprotocol awareness on Bitcoin; development has slowed
relative to mempool.space; heavy disk requirements for full index.

| Feature | Verdict | Reasoning |
|---|---|---|
| Outpoint-level navigation (prev-out ↔ spend links) | **ADOPT** | The structural skeleton that asset-flow evidence hangs on; make every outpoint a first-class page with asset annotations. |
| Liquid-style per-output asset display | **ADOPT** | Exactly the right *presentation* for assets on outputs, Universe applies it to metaprotocol assets with indexer evidence instead of consensus data. |
| Tor / no-tracking / noscript operation | **ADOPT** | Privacy-preserving defaults are core to a self-hosted explorer's value. |
| API-standard compatibility (Esplora API) | **ADOPT** | Keeping Esplora-compatible endpoints (via the mempool fork base) preserves ecosystem tooling. |
| Multi-language UI (17 locales) | **OOS** | Nice-to-have; inherit whatever the fork base provides, don't invest early. |
| Confidential transaction support | **OOS** | Liquid-specific; not applicable to Bitcoin metaprotocols. |

---

## 6. Bitfeed (bits.monospace.live)

**URL:** https://bits.monospace.live · Open source (bitfeed-project/bitfeed), by mononaut (now a lead mempool.space engineer).

**What it is.** An ambient live visualization of Bitcoin activity: each unconfirmed tx
is a square sized by output value (log scale), drifting in the mempool until a block
sweeps them up with a satisfying animation. Self-hostable (Umbrel app).

**Protocol support.** None.

**Signature features.** Value-scaled live tx squares; block-formation animation;
block composition view; "screensaver" mode.

**Strengths.** Emotional/legibility win, makes network activity *felt*; tiny,
self-hostable, elegant; open source.

**Weaknesses.** Not an explorer (no search, addresses, or history); one-trick;
maintenance is quiet since its author moved to mempool.space.

| Feature | Verdict | Reasoning |
|---|---|---|
| Ambient real-time block-formation animation | **OOS** | Delightful but decorative; Universe's live view already comes from the mempool fork base. |
| Value/size-scaled visual encoding of txs | **ADOPT** | The principle, visual channels encoding real tx properties, should extend to protocol events (e.g. color = asset action, verified by indexer). |
| Minimal self-host footprint | **ADOPT** | Keep Universe deployable on modest hardware where possible; heavy indexers should be optional modules. |

---

## 7. TxStreet (txstreet.com)

**URL:** https://txstreet.com · Frontend open-sourced (txstreet/txstreet); multi-chain (BTC, ETH, BCH, LTC, XMR).

**What it is.** A gamified mempool visualizer: transactions are cartoon people
boarding buses (blocks); fee level controls their speed and boarding priority.
Development has been largely dormant for years; the site still runs.

**Protocol support.** None (chain-level only).

**Strengths.** Unmatched as an *educational* metaphor for fee markets; memorable.

**Weaknesses.** Not an explorer; stale development; multi-chain scope; heavy
client-side; not practically self-hostable end-to-end (backend pieces incomplete).

| Feature | Verdict | Reasoning |
|---|---|---|
| Gamified fee-market metaphor | **REJECT** | Charming but at odds with an evidence-first professional tool; mempool goggles communicate the same facts precisely. |
| Multi-chain visualization | **OOS** | Universe is Bitcoin-only by design. |
| Making fee dynamics legible to newcomers | **IMPROVE** | The *goal* is right, serve it with accurate projected-block and fee-band UI, not cartoons. |

---

## 8. Blockchair (blockchair.com)

**URL:** https://blockchair.com · Closed source; commercial API.

**What it is.** A privacy-positioned multi-blockchain (40+ chains) explorer and data
platform: SQL-like filterable datasets, portfolio tracker without accounts, wallet
statements (PDF), Tor mirror, no ads/trackers, batch APIs, database dumps for
researchers. Long known for its transaction "Privacy-o-meter" score on Bitcoin txs.

**Protocol support.** Chain-level only on Bitcoin (no Ordinals/Runes decoding);
breadth is horizontal (many chains), not vertical (deep Bitcoin protocols).

**Signature features.**
- SQL-like query/filter API over indexed fields (any column, any predicate).
- Privacy-o-meter heuristic scoring of transactions.
- Anonymous portfolio tracker; wallet statements; xPub support; batch queries; full DB dumps.
- Tor endpoint; no-tracking stance.

**Strengths.** Research-grade queryability; genuine privacy posture for a hosted
service; reliable commercial API.

**Weaknesses.** Closed source, not self-hostable; Bitcoin depth is shallow;
privacy-o-meter is explicitly heuristic; multi-chain breadth is noise for Bitcoin-native users.

| Feature | Verdict | Reasoning |
|---|---|---|
| SQL-like filterable data API | **IMPROVE** | Powerful principle; Universe can expose rich filtered queries over *indexer-evidenced* asset events rather than raw columns only. |
| Privacy-o-meter (heuristic tx scoring) | **REJECT** | Heuristic scoring is precisely the "never heuristics" anti-pattern; if Universe flags anything, it must be provable properties. |
| Anonymous portfolio / xPub statements | **IMPROVE** | Portfolio views are wanted, but on a self-hosted instance they become private by construction, add asset-aware balances. |
| Database dumps for researchers | **ADOPT** | Exportable, reproducible datasets align with evidence-first values; publish indexer snapshots with block-height provenance. |
| 40+ chain coverage | **REJECT** | Horizontal breadth is the opposite of Universe's vertical protocol depth. |

---

## 9. OKX Bitcoin Explorer (web3.okx.com/explorer/bitcoin)

**URL:** https://web3.okx.com/explorer/bitcoin · Closed source; part of OKX exchange/wallet ecosystem.

**What it is.** The largest exchange-operated protocol-aware Bitcoin explorer:
inscription lists, BRC-20 token tracker (deploy/mint/transfer states, holders),
Ordinals transaction lists, Runes market data, Atomicals support, all fused with
OKX's wallet and inscription marketplace.

**Protocol support.** Ordinals/inscriptions, BRC-20, Runes, Atomicals (via wallet
stack); marketplace-grade token metadata.

**Signature features.**
- BRC-20 tracker with token lifecycle status and holder rankings.
- Inscription/asset transaction lists with token type, quantity, inscription number per tx.
- One-stop Runes market (data + trading).
- Enormous liquidity of attention: default explorer for many Asian-market users.

**Strengths.** Scale and data freshness; token lifecycle detail; deep wallet integration.

**Weaknesses.** Centralized exchange dependency (accounts, tracking, regional
availability); closed indexers with no verifiability; explorer serves the trading
funnel; API access gated through OKX platform keys; longevity tied to exchange
strategy (cf. Magic Eden's exit).

| Feature | Verdict | Reasoning |
|---|---|---|
| Token lifecycle tracking (deploy/mint states, holders) | **ADOPT** | Core protocol-aware functionality users expect; ground it in indexer state with verifiable snapshots. |
| Per-tx asset annotations in list views | **IMPROVE** | OKX shows *that* a tx moved a token; Universe must show *exactly which inputs/outputs* carried which asset amounts. |
| Exchange-integrated trading | **REJECT** | Conflicts with neutral evidence infrastructure. |
| Gated platform API keys | **REJECT** | Self-hosted Universe means open local APIs, no accounts. |

---

## 10. Magic Eden Ordinals Explorer, DEFUNCT (as explorer)

**URL:** was magiceden.io / magiceden.us Ordinals + Runes sections · **Feb 27, 2026: announced shutdown** of Bitcoin Ordinals, Runes, and EVM NFT marketplaces (and its multi-chain wallet) to refocus on Solana and a gambling product.

**What it was.** Not a general explorer but the dominant marketplace lens on Ordinals
(≈80% of Ordinals/Runes trading volume at peak): collection pages, floor prices, rare
sat listings, wallet portfolio views, Runes swap UI.

**Protocol support (historical).** Ordinals collections, Runes, rare sats.

**Strengths (historical).** Collection-level metadata, market context (floors, volume) that pure explorers lack.

**Weaknesses / lesson.** Marketplace economics could not sustain the infrastructure, 80% of costs for 20% of revenue. Its exit (weeks before Ord.io's) leaves a data
vacuum: collection metadata and market context lost a canonical home in 2026.

| Feature | Verdict | Reasoning |
|---|---|---|
| Collection-level organization & metadata | **IMPROVE** | Collections are how users think; source memberships from open, citable provenance (parent/child inscriptions, published manifests), not proprietary curation. |
| Market data (floor price, volume) | **OOS** | Price feeds are third-party, heuristic-adjacent, and perishable; link out rather than index. |
| Wallet-connected portfolio | **OOS** | Wallet connection belongs to wallets; Universe address pages should not require any connection. |
| Marketplace-subsidized infrastructure | **REJECT** | Both 2026 shutdowns prove the model's fragility; self-hosted software survives its operator. |

---

## 11. Blockchain.com Explorer

**URL:** https://www.blockchain.com/explorer · Closed source; part of the Blockchain.com wallet/exchange business.

**What it is.** The oldest mainstream Bitcoin explorer, now a general crypto-platform
surface: tx/address/block lookup across BTC and other chains, price/market data,
wallet-value charts. Aimed at retail wallet users, not analysts.

**Protocol support.** None (chain-level only).

**Signature features.** Simple search; address balance/history with charts; market data integration; brand recognition.

**Strengths.** Recognizable, simple for newcomers; stable.

**Weaknesses.** No mempool depth, no RBF/CPFP insight, no protocol awareness, trackers
and account funnels; API less loved than Esplora-compatible ones; innovation has moved elsewhere.

| Feature | Verdict | Reasoning |
|---|---|---|
| Beginner-simple search & address pages | **ADOPT** | Progressive disclosure, simple by default, deep on demand, is worth preserving in a power tool. |
| Price/market data on explorer pages | **OOS** | Fiat context is not evidence; keep optional at most. |
| Account/wallet funnel around explorer | **REJECT** | Same neutrality argument as OKX/Magic Eden. |

---

## 12. Notable emerging / adjacent explorers (2025–2026)

### Ordpool (ordpool.space), the direct precedent
Open-source fork of mempool.space that decodes **Inscriptions, Runes (incl. Alkanes),
BRC-20, SRC-20 Stamps, CAT-21, Atomicals, Labitbu, and OpenTimestamps**, including
*while transactions are still in the mempool*. Built on `ordpool-parser`, a
zero-dependency TypeScript parser applied to raw transactions.

- **Validation:** proves the "protocol-aware mempool.space fork" concept Universe is pursuing, and that mempool-time metaprotocol decoding is feasible.
- **Key limitation:** parsing raw envelopes client/edge-side is *recognition*, not authoritative state, a decoded runestone doesn't tell you whether the mint was valid, within cap, or how balances resolve. That gap (parser output vs. indexer truth) is exactly Universe's differentiator.

| Feature | Verdict | Reasoning |
|---|---|---|
| Mempool-time metaprotocol decoding | **IMPROVE** | Adopt the capability, but pair every parse with authoritative indexer validation status ("decoded, pending validity"). |
| Standalone open-source parser library | **ADOPT** | A reusable, testable parsing layer separate from the UI is good architecture. |
| Meme/novelty protocol chasing (CAT-21, Labitbu) | **OOS** | Support protocols with real usage and maintained indexers; keep the parser extensible instead. |

### GeniiData (geniidata.com)
Analytics-first Ordinals platform: BRC-20/Runes/bitmap/SNS dashboards, holder
analytics, user-built dashboards, and a developer API. Closed source, hosted.
- **ADOPT** the principle of analytics dashboards over indexed asset events (mint trends, holder distribution) as a later-phase layer; **REJECT** dependence on hosted third-party indexers.

### Stamps ecosystem: Stampchain.io & OpenStamp (openstamp.io)
Stampchain publishes an open-source Bitcoin Stamps indexer + explorer + API (SRC-20,
stamp NFTs, SRC-101); OpenStamp adds marketplace/launchpad around the same assets.
- Stamps data lives in multisig/bare-data outputs, a fundamentally different encoding from ordinals envelopes, so per-output asset attribution is *natural* for stamps. **ADOPT** open-indexer integration if/when Stamps support is prioritized.

### Hiro Ordinals Explorer & API, deprecated
Hiro's Ordinals API and explorer (once ~150M requests/month) were **deprecated March 9,
2026**, with users pointed to Xverse's Ordinals API and Hiro's Bitcoin Indexer repo.
Another major hosted-Ordinals-data exit in 2026, reinforcing the self-hosting thesis.

### UniSat explorer (unisat.io)
Sibling to UniScan with Runes "hot map" of recent mints and marketplace integration; same closed-indexer caveats as UniScan.

---

## Cross-cutting conclusions for Universe Explorer

1. **The market gap is real and widening.** 2026 saw Ord.io die, Magic Eden abandon
   Ordinals/Runes, and Hiro deprecate its Ordinals API. Hosted, VC/marketplace-subsidized
   protocol data keeps disappearing; nobody offers a *self-hosted* protocol-aware explorer
   with authoritative asset accounting.
2. **No incumbent shows exact per-input/per-output asset flows.** mempool.space refuses
   metaprotocol interpretation; UniScan/OKX/Ordiscan show asset involvement and balances
   but not outpoint-level flow with evidence; Ordpool decodes envelopes without validity
   resolution. The only production precedent for per-output asset display is Esplora's
   *Liquid* view, consensus assets, not metaprotocols.
3. **Fork base is right.** mempool.space contributes the live mempool UX, RBF/CPFP
   machinery, audit mindset, API standards, and self-host packaging; Ordpool proves the
   fork approach; Esplora contributes the outpoint-navigation and privacy-default
   principles.
4. **Differentiator to protect:** every asset claim traceable to an authoritative
   indexer (ord, runes indexer, alkanes metashrew, stamps indexer) at a stated block
   height, decoded-but-unvalidated mempool data must be visibly distinguished from
   validated state. Nothing shipped today makes that distinction.
