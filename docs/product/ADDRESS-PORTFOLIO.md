# Address portfolio

What an address holds, what it is worth, how it got there, and how much of
that answer is actually proven. Read only, no wallet, no account.

## The promise

**Enter any address and see everything the Universe protocol authorities
can prove it holds, with the state of every source shown next to what it
answered.**

The second half is the product. A portfolio that quietly shows zero when
a source did not answer is indistinguishable from a wrong one, and it is
worse than showing nothing, because the reader has no way to tell.

## Routes

| Route | Purpose |
| --- | --- |
| `/portfolio` | Entry. Paste an address; every chain that can read it is offered. |
| `/portfolio/:chain/:network/:address` | The portfolio. Tab state lives in `?tab=`. |

Chain and network are always in the path. There is no route that guesses
a chain from the shape of an address.

### Chain disambiguation

A Taproot-style string is valid on both Bitcoin and Fractal. They are
separate ledgers with separate holdings, so the entry page offers both,
side by side, with a plain sentence saying so. It never picks one. A
D-prefixed base58 string offers Dogecoin only; a `t1`, `zs`, or `u1`
string offers Zcash only.

## Tabs

- **Overview**: largest holdings, protocols holding something, and the
  warnings from every source that could not answer in full.
- **Tokens**: native coins and fungible protocol assets, with available
  and transferable quantities where the protocol defines them.
- **Collectibles**: inscriptions, NFTs, names, realms, bitmaps, rare sats.
- **Protocols**: every protocol on the chain with the state its source
  reported, whether or not the address holds anything there.
- **Activity**: the classified base-chain ledger. Amounts are exact, the
  fee is shown only for the party that paid it, a counterparty appears
  only when the transaction shape identifies exactly one, and pending is
  kept visibly distinct from confirmed.
- **Performance**: the balance series as a chart, with the same data in a
  table underneath so nothing is chart-only.
- **Profit and loss**: FIFO figures with the disposals and lots behind
  them, so every number can be traced to the events that produced it.
- **Sources**: what each authority said, its block, and how far behind
  the tip it is.

## The rules the interface follows

**Every number names its own coverage.** The summary carries a sentence
saying how many sources did not answer in full, or how many holdings are
unpriced and therefore excluded from the displayed value. There is no
state in which a total appears without that sentence.

**An empty list is never self-describing.** A protocol showing nothing
says which it is:

| What happened | What the reader sees |
| --- | --- |
| The source answered fully and found nothing | Nothing held |
| The source answered partly | Answered in part, so this list may be incomplete |
| The source failed | This source did not answer, so the portfolio may be incomplete |
| No source serves it yet | Not served by any configured source yet, naming the authority |
| Outside what the source can see | Outside what this source can see |

**Unknown is written as unknown.** An unpriced holding shows no value
rather than zero. A lot with unknown cost says unknown. Unrealized profit
is withheld entirely when no fresh price exists, rather than computed
against a stale one.

**Totals grow honestly.** A large address loads in pages. While pages
remain, the page says so and the totals do not pretend to be final.

**Nothing is chart-only.** The balance chart is accompanied by its own
data table. The chart carries an `aria-label` naming its range and point
count. Gains and losses are named in the cell text, not only toned.

## Alerts

A watched address is compared, on each visit, against what you last
saw. What changed is listed above the summary, and can also raise a
browser notification once you ask for one.

The rule the alerts follow is the same one the rest of the product
follows, and it is the reason they can be trusted:

**A source going quiet is never reported as assets leaving.** An asset
missing from a protocol that has stopped answering has not been sent
anywhere. So a departure is only reported when that protocol answered
both times, and an arrival is only reported when the protocol was
answering before as well, since otherwise the asset may have been held
all along and simply unseen. A source that degrades is reported as
exactly that, once, when it degrades.

Quantities are compared exactly, so a change larger than a JavaScript
number can hold is still seen. Every alert is raised once and never
repeated.

## What stays in this browser

Labels, groups, and the watchlist live in local storage and are never
sent anywhere. They do not appear in a shared portfolio link. Every
stored entry is validated on read as strictly as an authority response,
because local storage is writable by anything on the origin.

## Exports

The summary panel links to an assets CSV, an activity CSV, and an
evidence JSON. The JSON carries the whole evidence envelope, so an
exported portfolio can be read back with the coverage that makes its
numbers meaningful rather than as bare figures.

## Where the data comes from

The versioned portfolio API in the Universe Explorer overlay, under
`/api/v1/universe/portfolio`. The frontend never talks to a protocol
indexer directly. Architecture and operations for that service live in
the `backend-apis` repository under `docs/universe-portfolio/`.
