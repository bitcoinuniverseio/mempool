# Portfolio workspace

A whole watchlist as one picture, and the picture stays on this device.

## The promise

**Turn the visitor's own list of addresses into exact totals, name every
address that failed rather than counting it as zero, and keep every
identifying detail in the browser.**

## Route

| Route | Purpose |
| --- | --- |
| `/portfolio/workspace` | The private multi address workspace. |

The watchlist itself is shared with the single address portfolio surface:
watching an address from its portfolio page puts it here too.

## What the page adds up to

- **Native balances per chain**, summed as arbitrary precision integers.
  Atomic quantities are exact; nothing passes through floating point on the
  way to the screen.
- **Valuations per quote currency**, added as scale aligned decimals. Two
  answers in different currencies are never merged into one number.
- **Group subtotals**, in the groups the visitor named, for the same sums
  on their own terms.

Every total states how many addresses contributed, because a total without
its denominator invites a wrong reading.

## How failure looks

An address whose summary did not answer appears in the table as **did not
answer**, with the reason. It contributes nothing to any sum, and the panel
says how many addresses were excluded. A missing source never disguises
itself as an empty address or a zero balance.

## Bringing a list in

CSV (with or without a header) and JSON lists import: address, chain,
network, label, group, with sensible defaults for what is absent. Every
rejection is named with its row and reason, and two are absolute:

- text that looks like key material is never read in at all, with the
  refusal saying so;
- rows past the 200 row limit are stated as unread rather than silently
  cut.

Exports answer in kind: one CSV row per address, or versioned JSON with
the failures and their reasons included.

## Privacy model

- The list, its labels, and its groups are local storage under keys this
  explorer owns, validated on every read, deletable from this page and
  from `/offline`.
- The server sees only the ordinary per address summary reads any
  portfolio page makes. There is no workspace upload, no account, no
  server side profile of what a visitor watches.
- Refreshing is rate bounded: at most 25 addresses per pass, a pause
  between reads, cancellable mid pass, so a large list cannot turn into a
  burst.

## What this product does not do yet

Extended public keys and output descriptors are not derived here yet; the
workspace watches addresses, and says so rather than implying derivation
support. When local derivation arrives, it lands inside this page with the
same refusal-first rule that guards it today: nothing secret-shaped is
ever accepted, logged, or sent.
