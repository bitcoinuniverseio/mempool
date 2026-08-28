# Visual language benchmark

**Pass completed 28 August 2026.** The August 26 research pass covered
positioning, features, and user jobs. It did not look at what these products
*look like*, which is the question this pass answers, because the brand decision
it feeds is the one thing a visitor judges before reading a word.

Evidence classes, as in `source-ledger.md`: **primary** (the product's own
output), **observed** (measured directly from the live product), **secondary**
(reporting or research), **inference** (labelled where used).

## Method

Rather than describe screenshots, this pass reads each product's declared shell
colour from its own markup. `<meta name="theme-color">` is the value the product
tells the operating system to paint its browser chrome with, so it is the
product's own statement about its ground, not an interpretation of one.

```bash
curl -sS -L https://<host> | grep -oiE 'theme-color[^>]*content="[^"]*"'
```

## What the market actually looks like

| Product | Declared shell | Class |
| --- | --- | --- |
| mempool.space | `#1d1f31` dark navy | observed, 28 Aug 2026 |
| Blockchain.com Explorer | `#000000` page background | observed, 28 Aug 2026 |
| Blockstream Explorer | dark, no declared value | observed, 28 Aug 2026 |
| Bitfeed | `#ffffff` | observed, 28 Aug 2026 |
| 3xpl | no declared value | observed, 28 Aug 2026 |
| Ordiscan, UniScan, Bitaps | behind a bot check, not measurable this way | observed, 28 Aug 2026 |

**Finding.** The reference product for this entire category, and the one this
product is forked from, declares a dark blue-grey shell. Every other explorer
measurable this way is dark or neutral. Not one is warm, and not one is
chromatic.

Secondary sources agree about the intent behind it: crypto dashboard palettes
are described as running "mostly muted saturation (lower chroma)" with
temperatures "leaning cool" (produkto.io palette analysis, secondary).

**Inference.** A light, warm, chromatic explorer is not a crowded position. It
is an empty one. That is unusual enough to be worth checking for a reason it is
empty, and the next section is that check.

## Is the position empty for a good reason?

Two reasons a serious data product might avoid it, and what the evidence says.

**"Dense financial data needs a dark ground."** Not supported. The
counter-example is the whole of financial and operational software outside
crypto, and the constraint that actually matters is measured contrast, which is
a property of the pairing rather than of the direction. This product holds every
pairing to WCAG 2.2 AA and measures it in CI, on all three themes.

**"A saturated brand colour competes with data colour."** Supported, and it is
the real risk. A pink applied to statuses, fee bands, or protocol chips would
destroy the product's ability to say "proven" or "expensive" in colour. The
answer is not a quieter pink. It is a strict rule about what pink is allowed to
mean, enforced by a gate. See `docs/product/DESIGN-SYSTEM.md`.

## What users say they want

A usability survey reported by CoinLedger's 2026 explorer guide found **72% of
block explorer users value clear data presentation over additional features**
(secondary). The same reporting describes the common complaint as explorers
presenting large amounts of data without indicating what matters.

CHI 2023 accessibility research on crypto technologies found that **every
audited exchange site had critical issues limiting keyboard-only or screen
reader use**, with poor labelling and poor colour contrast throughout navigation
(secondary, Bournemouth University / ACM).

**Inference.** Accessibility is not a compliance cost in this market. It is an
open differentiator, because the incumbents measurably do not have it.

## What changed at the top of the market

mempool.space incorporated in El Salvador in November 2025 and raised roughly
$17M led by Fulgur Ventures in January 2026 (secondary, Wikipedia summary of
reporting). Its newest published release remains v3.3.1, April 2025 (primary,
GitHub releases).

**Inference.** The incumbent is now funded to move faster, and its policy of not
decoding metaprotocols is a stated position rather than a resourcing gap. Both
readings point the same way: compete on the axis it has ruled out, not on the
axis it is about to spend money on.

## Decisions this pass produced

| Finding | Decision |
| --- | --- |
| Every measurable competitor ships a dark, cool shell | Light-first stays the primary experience, and the light ground moves from cool grey to pearl so it is warm as well as light. A visitor can tell the products apart from a thumbnail. |
| Saturated brand colour genuinely can corrupt data colour | Pink is confined to identity and intent. `check-palettes.mjs` measures every brand role at 25 dE or more from every state and protocol colour, and the build fails otherwise. |
| 72% of users prefer clarity over features | No feature was added in this pass. The work went into the colour system, the foreground contracts, and the gates. |
| Incumbent accessibility is measurably poor | The AA floor is held on all three themes and measured on the built bundle across 13 routes, 7 widths, and 6 data states, rather than asserted. |
| Every explorer's favicon is dark or white | The icon inverts: a pearl mark on a hot-pink tile. It is findable in a strip of tabs, which is where an explorer actually competes for a return visit. |
| Palettes in this category are low chroma and cool | The gloss, glow, and sweep are the differentiator, so they stay. They are confined to the primary action and singleton surfaces, so the density that makes the product usable is untouched. |

## Rejected

| Pattern | Why not |
| --- | --- |
| Recolouring the fee scale into the brand family | A fee band means a fee rate, and green to amber to red is the reading every Bitcoin user already has. Brand colour would overwrite a meaning to gain nothing. |
| Pink success and error states | The one thing that must never be ambiguous. Green and red stay. |
| Glass and blur as the house surface | Two always-on blur layers over a scrolling list is the standard cause of scroll jank, and this product's main view scrolls live data. |
| A downloaded display font | It would be a third-party fetch, or a self-hosted payload on the critical path, to buy an effect that weight and tracking already deliver. |
| Rainbow as a fill | Applied broadly it stops meaning anything. It survives as one rule, once per screen. |
| Following the category into dark-first | It is the position every competitor already holds. |

## Closure

Two further passes, using different strategies from the four recorded in
`source-ledger.md`, ran on 28 August 2026:

| Pass | Strategy | Result |
| --- | --- | --- |
| 5 | Brand and palette direction: crypto explorer brand identity colour palette differentiation dark mode default 2026 | No new competitor, capability class, or trend. Confirmed the low-chroma cool convention. |
| 6 | Accessibility and reading preference: block explorer accessibility WCAG contrast audit crypto dashboard light mode preference | No new competitor or capability class. Produced the CHI accessibility finding above, which confirmed an existing decision rather than changing one. |

Two consecutive passes with different query sets and different source sets
produced no new material competitor, capability category, user expectation, or
design pattern. That is the closure condition.

## Sources

- mempool.space, live markup, 28 August 2026 (observed)
- Blockchain.com Explorer, live markup, 28 August 2026 (observed)
- Blockstream.info, live markup, 28 August 2026 (observed)
- Bitfeed, live markup, 28 August 2026 (observed)
- 3xpl, live markup, 28 August 2026 (observed)
- mempool/mempool GitHub releases, v3.3.1 and earlier (primary)
- Wikipedia, Mempool.space, incorporation and funding summary (secondary)
- CoinLedger, Blockchain Explorers guide 2026, usability survey figure (secondary)
- Bournemouth University / ACM CHI 2023, Exploring the Accessibility of Crypto Technologies (secondary)
- produkto.io crypto palette analysis, chroma and temperature convention (secondary)
- FallingBrick, dark mode design guide 2026, semantic token guidance (secondary)
