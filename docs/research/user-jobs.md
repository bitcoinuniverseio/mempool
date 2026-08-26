# User jobs and recurring pain points

Compiled 26 August 2026 from product testing across the competitor set, public
documentation, community discussion, and support material. Evidence class is
marked on every line: **observed** means the behaviour was seen in the product
itself, **reported** means it comes from public user discussion, and
**inferred** means it follows from the other two and is labelled as reasoning.

## Jobs, ranked by how often they are the reason someone opens an explorer

| # | Job | Who | Where it is served badly today |
| --- | --- | --- | --- |
| 1 | "Will my transaction confirm, and what will it cost" | everyone | Served well by mempool-first explorers, badly by asset-first ones (observed: asset explorers show a txid and a status, with no fee-market context). |
| 2 | "What exactly is on this output" | protocol holders | Served by nobody at output granularity with evidence. Asset explorers answer per address or per asset (observed). |
| 3 | "Did my transaction do what I meant" | builders, minters | Requires reading raw fields and knowing the protocol (observed across the whole set). |
| 4 | "What does this address hold across protocols" | holders | Served by closed hosted explorers, with no statement of coverage (observed). |
| 5 | "Is this mint still open, and how far along" | minters | Served on asset pages, methodology rarely stated (observed). |
| 6 | "What is happening on chain right now" | everyone | Served by live visualizers for base Bitcoin, by nobody for protocol activity (observed). |
| 7 | "Was my transaction replaced, and what happened to what it carried" | RBF users | Replacement timelines exist upstream; what the replacement did to a pending asset transfer is shown nowhere (observed). |
| 8 | "Give me a link that shows exactly this" | everyone | Deep links exist for transactions, blocks, and addresses; rarely for a state within them (observed). |
| 9 | "Watch this thing for me" | holders, operators | A separate product category, usually with an account and a server-side list (observed). |
| 10 | "Can I trust this data, and can I run it myself" | operators, researchers | Self-hosting is served by base-chain explorers only; no self-hostable protocol-aware explorer existed (observed). |

## Recurring pain points

1. **An empty cell that could mean two different things.** Explorers show
   nothing both when an asset is absent and when the indexer failed to answer.
   *(observed across the set; the single most consequential failure in this
   category.)*
2. **Balances with no coverage statement.** A portfolio view that silently
   truncates the outputs it scanned reads as complete. *(observed.)*
3. **Interpretation asserted as fact.** Pages describe transfers and sales that
   the underlying data does not establish. *(observed.)*
4. **Precision lost on large amounts.** Token supplies beyond the safe integer
   range render wrongly when passed through floating point. *(inferred from
   the arithmetic; guarded against here with decimal strings and BigInt.)*
5. **Protocol coverage overstated.** A registry entry with no working indexer is
   presented as supported. *(observed.)*
6. **Metaprotocol activity invisible until confirmation.** Pending protocol
   operations are the moment that matters most and are the least visible.
   *(observed.)*
7. **Hosted APIs disappearing.** Products built on them break with little
   notice. *(reported, repeatedly, through 2026.)*
8. **Trackers on tools people use for financial privacy.** *(observed;
   acknowledged in third-party tracker products' own documentation.)*
9. **Mobile treated as a narrowed desktop.** Dense tables scroll horizontally
   and identifiers overflow. *(observed.)*
10. **Jargon with no on-ramp.** Terms are used without a one-line explanation
    anywhere on the page. *(observed.)*

## How this release answers each

| Pain | Answer |
| --- | --- |
| 1 | Five distinct evidence states with distinct wording and colour, defined once in `universe-evidence.ts` and asserted in tests. |
| 2 | Every panel that samples publishes what it covered: outputs checked, outputs not checked, transactions checked. |
| 3 | The plain-language summary is generated only from reported actions and never uses trade vocabulary. |
| 4 | Decimal strings end to end; sums use BigInt; a malformed quantity is dropped rather than coerced. |
| 5 | Release status per protocol, with the reason a protocol is unavailable stated on its own page. |
| 6 | The pulse resolves pending transactions and labels them pending. |
| 7 | First-party authorities only, enforced by a build gate. |
| 8 | No analytics, no third-party requests, local-only personalization, one erase button. |
| 9 | Every new surface has its own mobile grid layout, tested from 320 pixels up. |
| 10 | Protocol pages explain what the protocol is and how to read its evidence in plain language. |
