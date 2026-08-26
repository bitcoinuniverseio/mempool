# Source ledger

Traceability for the research that shaped this release. Access date for every
entry is 26 August 2026 unless stated otherwise.

Evidence classes: **primary** (the product, its repository, or its own
documentation), **secondary** (reporting or analysis), **observed** (behaviour
seen while using the product), **inference** (reasoning from the above, always
labelled as such where it is used).

## Search strategies and closure

Discovery ran in four passes, each using a different strategy, so that closure
means something beyond query rephrasing.

| Pass | Strategy | Queries |
| --- | --- | --- |
| 1 | Category and comparison | Bitcoin block explorer 2026 comparison mempool explorer protocol aware ordinals runes |
| 2 | Protocol family | Alkanes protocol explorer metashrew oyl indexer; Bitcoin Stamps SRC-20 explorer stampchain openstamp; Atomicals ARC-20 realms explorer; Runes explorer Ordiscan Best in Slot GeniiData Luminex mint progress; CAT-20 / TAP protocol / Digital Matter Theory bitcoin explorer |
| 3 | Adjacent capability | live bitcoin transaction visualizer TxStreet Bitfeed mempool animation; privacy Bitcoin explorer no javascript Tor self-hosted BTC RPC Explorer 3xpl Bitaps; blockchain explorer MCP server AI agent API bitcoin data; bitcoin address watchlist alerts explorer notifications on-chain activity tracker |
| 4 | Directory and closure | awesome bitcoin block explorers list open source self-hosted directory; bitcoin explorer UX accessibility WCAG mobile search identifier detection; Bitcoin Core v30 OP_RETURN datacarrier limit removed mempool policy impact explorers; mempool explorer user complaints missing features |

Passes 3 and 4 produced new product names but no new competitor category,
capability class, user expectation, or trend. That is the closure condition
recorded in `market-lessons.md`.

## Claim to source

| Claim used in a decision | Source | Class |
| --- | --- | --- |
| v3.3.1 is the latest stable upstream release; v3.4.0 exists only as an alpha | upstream releases page, github.com/mempool/mempool/releases | primary |
| v3.3.0 added taproot script-tree visualization, sighash icons, stale-block comparison, sub-1 sat/vB support | upstream release notes | primary |
| Upstream declines to integrate an asset indexer | upstream project statements and issue history | primary |
| Bitcoin Core v30 released 10 October 2025; default `-datacarriersize` raised from 83 to 100,000 bytes | bitcoin/bitcoin release material and analysis of it | primary, secondary |
| Deprecation of `datacarrier` options was reverted before release | bitcoin/bitcoin pull request 33453 discussion | primary |
| Knots retains stricter data-carriage defaults and gained operators for that reason | comparison analyses published 2025 to 2026 | secondary |
| UniScan covers Ordinals, BRC-20, Runes, Alkanes on Bitcoin and Fractal; closed source | product surface | primary, observed |
| Ordiscan covers inscriptions, runes, rare sats, BRC-20, collections; has explicit rare-sat tooling | ordiscan.com | primary, observed |
| GeniiData leads with mint progress, holder counts, volume, activity | geniidata.com | primary, observed |
| Luminex is widely used for rune minting and etching | product and its documentation | primary, secondary |
| Stampchain publishes an open-source Stamps indexer, explorer, and API; OpenStamp adds a marketplace and explorer | stampchain-io repositories; docs.openstamp.io | primary |
| Alkanes launched at block 880000 and is indexed by the open-source Metashrew stack | kungfuflex/alkanes-rs; Alkanes documentation | primary |
| Atomicals ecosystem has several third-party explorers, and ARC-20 is backed one unit per satoshi | docs.atomicals.xyz; community tool lists | primary |
| TAP supports DMT deploy and mint operations and bitmap assets | Trac Systems TAP protocol specification | primary |
| TxStreet and Bitfeed are the reference live mempool visualizers | txstreet.com; bitfeed | primary, observed |
| 3xpl positions on speed, no third-party trackers, and a Tor hidden service | 3xpl.com | primary, observed |
| BTC RPC Explorer and Esplora are the established self-hostable base-chain explorers | janoside/btc-rpc-explorer; Blockstream Esplora | primary |
| Third-party wallet trackers log watched addresses and collect technical data | those products' own descriptions | primary |
| Agent-facing blockchain data interfaces are an emerging category with thin Bitcoin coverage | Bitquery and Blockscout agent-interface documentation | primary |
| WCAG 2.2 is the current standard, with touch-target and cognitive additions over 2.1 | W3C Web Accessibility Initiative | primary |

## Environment evidence, gathered directly

| Claim | How it was established |
| --- | --- |
| The public origin returned 502 before this release | HTTP request to the production origin |
| The gateway tunnel had never authenticated | gateway service journal, restart counter above 7500 |
| Ord 0.29 is the only healthy Bitcoin protocol authority | probes through the production tunnels to each configured authority |
| No explorer service existed on the target host | service listing and listening-socket inventory on that host |
| Release payloads were staged and built but never started | directory and build-artifact inspection on that host |

Recorded in full in `audits/2026-08-26-go-state-baseline.md` in the project
workspace.
