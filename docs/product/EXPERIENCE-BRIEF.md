# Universe Explorer experience brief

Written 26 August 2026 to direct implementation. Every statement here is meant
to settle a build decision, not to describe an aspiration.

## The promise

**See what a Bitcoin transaction actually does, with the proof attached.**

Everything else follows from that sentence. If a screen cannot show what it
proves, it does not ship.

## Who it is for

| Group | Highest-value job | What they do here |
| --- | --- | --- |
| Protocol holders and traders | "What is on this output, right now" | Open an output, an address, or an asset and read exactly what the authority proves. |
| Builders on Bitcoin protocols | "Did my transaction do what I intended" | Read a transaction, see the action the authority reported, and follow it to the outputs it landed on. |
| Fee-sensitive Bitcoin users | "When does this confirm and what does it cost" | The upstream mempool machinery, unchanged and still excellent. |
| Analysts and researchers | "What is happening across protocols right now" | The pulse page, with a published denominator so the number can be checked. |
| Operators self-hosting | "Can I run this and trust it" | One documented stack, first-party data only, source published on the site. |

## The emotional outcomes to design for

1. **Oriented in seconds.** Live data above the fold, one dominant search field,
   no marketing hero.
2. **In control.** Every state is addressable and shareable. Nothing important
   hides behind a modal.
3. **Confident the data is real.** Each claim names its authority and the block
   it was proven at.
4. **Curious.** One page always suggests the next honest hop: transaction to
   output, output to asset, asset to protocol, protocol to live activity.
5. **Early.** The pulse shows protocol transactions while they are still pending.
6. **Able to explain it.** Plain-language first, technical detail underneath.

## What competitors cannot easily copy

1. **A mempool-grade explorer that also decodes protocol assets.** The strongest
   mempool explorer refuses metaprotocol interpretation as a matter of policy.
   The strongest protocol explorers are thin on the mempool. Both positions are
   deliberate, so neither moves quickly.
2. **First-party authorities.** The protocol data comes from indexers Bitcoin
   Universe runs. Hosted protocol data keeps disappearing from this market;
   infrastructure that is owned does not.
3. **Evidence as a product surface, not a footnote.** Proven, partly proven,
   outside coverage, pending, and unavailable are five distinct answers with
   five distinct treatments. Competitors show a value or an empty cell.
4. **Outputs as first-class pages.** Everyone else treats an output as a table
   row inside a transaction.
5. **Self-hostable and readable.** Full source, AGPL, no tracker, no account.
6. **An appearance nothing else in the category has.** Measured on 28 August
   2026, every explorer whose shell colour can be read from its own markup
   declares a dark, cool one: mempool.space `#1d1f31`, Blockchain.com black,
   Blockstream dark. Universe Explorer is light, warm, and hot pink. That is
   copyable in principle and expensive in practice, because it means adopting
   another company's brand rather than adjusting a hue.

## What makes it unmistakably Universe

The same anchor, secondary, and shell material as Core, Wallet and Inscribe,
applied to a denser product: `#ff0066` for identity, lavender for the secondary
and for focus, pearl on light and plum-black on dark.

One rule makes it work at this density. **Pink is identity and intent, never a
fact about Bitcoin.** It marks the mark, the primary action, active navigation,
selection, and live surfaces. It is never a status, a protocol, a fee band, or a
quantity, and CI fails the build if a brand role drifts within 25 dE of a state
or protocol colour.

That is why the pink can be loud without costing anything. A reader learns in
one screen that pink means "this is Universe, and this is where you act", so it
never competes with the green that means proven or the amber that means a fee.

## Why people come back

Real utility, not compulsion.

- The pulse changes every block, and it is the only place to see verified
  protocol activity before confirmation.
- Saved pages and recent history make the second visit faster than the first.
- Pinned protocols shape the views the visitor actually cares about.
- Deep links mean a colleague's link lands exactly where it should.

Explicitly rejected: fabricated scarcity, engineered urgency, notification
spam, streaks, gamified counters, and any metric that cannot be recomputed from
published numbers. Urgency in this product is allowed only when the chain
supplies it: a pending transaction, a live mint approaching its cap, a first
sighting, an unusual verified event.

## Boundaries

- **Read only.** The one write path is the transaction broadcast that already
  exists upstream.
- **No inference.** Ownership, transfers, trades, buyers, and sellers are never
  asserted from transaction shape. If the authority did not say it, the page
  does not say it.
- **No third-party data.** Not as a fallback, not behind a flag.
- **No profile.** Personalization is local storage, and one button erases it.
- **No advertising or paid placement.** Rankings cannot be bought.
- **Scope stays an explorer.** Not a wallet, not a market, not a custodian.

## The one-sentence position

Universe Explorer is the only self-hostable, mempool-grade Bitcoin explorer that
shows exactly which outputs carry which protocol assets, with first-party
evidence and a stated block for every claim.
