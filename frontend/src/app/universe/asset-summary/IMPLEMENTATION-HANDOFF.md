# Asset summary panels: what this directory is, and what is still open

This directory holds what the transaction asset summary and the address asset
holdings panel share: the quantity presenter, the layout mixins, and the test
helper that makes their real templates renderable under the unit runner.

The two panels state different facts and are deliberately not merged. What is
shared is everything that would otherwise drift: how a quantity is scaled and
shortened, how an identity block is laid out, how wide a bounded numeric column
is, and at what panel width the table stacks.

## Why the shared presenter exists

Each panel had its own quantity formatting, and they disagreed. One scaled by
divisibility and one did not; one wrapped long digits and one let them set the
column width. A reader moving between a transaction page and an address page saw
the same authority fact rendered two ways, and in one of those ways a balance
could be split across two lines, where a wrapped number is indistinguishable
from two numbers.

`asset-summary.presentation.ts` is therefore the only place a quantity becomes
text. It never constructs a `Number` from a quantity: an asset amount is an
unsigned integer of arbitrary size and a rune supply exceeds what a double can
hold exactly, so every operation is string surgery. Three cases are kept
separate rather than collapsed into a falsy check: an exact decimal, true digits
whose scale is unknown, and an unknown quantity. Zero is none of those.

## Implemented on 2026-09-19

Both panels were rebuilt against the plan pinned at
`bitcoinuniverseio/mempool` `prep/asset-summary-ui-20260919`, whose eight source
markers are resolved and removed. The backend repairs the plan depended on
landed alongside, on `bitcoinuniverseio/backend-apis`
`impl/asset-summary-ui-20260919`.

- The decoder validates the coverage enum, rejects duplicate protocol coverage
  and coverage from another context, requires the asset and coverage arrays
  rather than treating an absent one as empty, and refuses a stated total that
  conclusive coverage does not support or that disagrees with the identities
  listed. Effect evidence and the reading's checkpoint are preserved.
- The transaction panel builds one display model per response instead of mapping
  in template bindings, seeds the optional protocol registry so an optional
  display name cannot gate a proven amount, states each coverage gap with its
  own state and reason, and offers a retry only where one could change the
  answer.
- Both panels keep a real table with a row header on desktop, put flex inside
  the header cell rather than on it, bound their numeric columns, and stack by
  the panel's own width through a container query.
- The address panel keys holdings by the whole identity, carries divisibility
  and ruleset, separates a known quantity from the scope it was read over,
  states a checked and a total denominator, distinguishes a proven empty address
  from one that could not be fully checked, and routes its outpoint links
  through the active network.

## Still open

Live functional acceptance against a first-party test network, and the public
mainnet release, are not covered by anything in this repository. They are
operational steps with their own evidence, recorded outside the source tree.
