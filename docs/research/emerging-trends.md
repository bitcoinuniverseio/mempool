# Emerging trends brief

Compiled 26 August 2026. Sources and access dates are in `source-ledger.md`.

## 1. Data carriage stopped being policy-limited

Bitcoin Core v30, released 10 October 2025, raised the default
`-datacarriersize` from 83 bytes to 100,000, which removes any practical limit
on OP_RETURN because a transaction hits the 100,000 vbyte ceiling first. The
planned deprecation of the `datacarrier` options was reverted before release, so
operators can still filter. Bitcoin Knots keeps stricter defaults, and a
meaningful share of operators run it for that reason.

**What it means for an explorer.** Whether a data-carrying transaction relays now
depends on which software its peers run, not on consensus. A pending transaction
can be perfectly valid and still fail to propagate across part of the network.
No explorer currently shows that distinction.

**Position taken.** Protocols that carry instructions in data outputs are
described that way on their pages, so the reader understands where the meaning
comes from. Instrumenting relay-policy divergence is recorded as the next area
of work rather than claimed today.

## 2. Hosted protocol data keeps being withdrawn

The pattern of 2026: an explorer or API that many products depended on is
retired, and everyone downstream scrambles. It happened to Ordinals data more
than once this year.

**Position taken.** Every protocol figure comes from an indexer Bitcoin Universe
operates. The registry states which protocols have a running first-party
authority and which do not, so coverage is never overstated.

## 3. Protocol families keep multiplying, and none of them wins

Alkanes brought WebAssembly contracts to Bitcoin outputs via an open indexer;
Runes remains the dominant fungible standard; Stamps, Atomicals, TAP, DMT, and
CAT-20 each hold a niche. The population of standards is growing faster than any
one explorer's coverage.

**Position taken.** The registry is a first-class contract with an explicit
release status per protocol, so adding coverage is a data and adapter change
rather than a redesign, and absent coverage is visible rather than silent.

## 4. Agent-facing data access is becoming a category

Hosted blockchain data providers now ship agent interfaces alongside their REST
APIs. Bitcoin-specific coverage in those products is thin.

**Position taken.** Out of scope for this release. A stable, versioned,
same-origin public API is the prerequisite and it exists; an agent interface on
top of it is a later, additive step.

## 5. Speed and the absence of tracking are being sold as features

Explorers now advertise no third-party trackers and onion availability as
headline attributes rather than footnotes.

**Position taken.** Both are enforced by build gates rather than claimed in
copy, and the privacy page states exactly what the browser stores.

## 6. Explorers are still built for people who already know the answer

Across the whole competitor set, no product writes a sentence explaining what a
transaction did. They present fields and leave interpretation to the reader.

**Position taken.** Plain language first on every transaction, with the complete
technical detail directly underneath.
