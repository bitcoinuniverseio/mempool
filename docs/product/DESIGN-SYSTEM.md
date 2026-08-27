# Universe Explorer design system

What the product is, how it is built, and the small number of rules that keep it
coherent. This is a working reference, not a style showcase: every rule here is
enforced somewhere in the code or in CI.

## The promise

**Universe Explorer shows Bitcoin activity while it is still forming, and tells
you exactly how much of it is proven.**

Two halves, both load-bearing:

- *While it is still forming* is the reason to open it. The mempool and the
  projected blocks are the part of Bitcoin that has not become history yet.
- *How much of it is proven* is the reason to trust it. The product reads
  protocol assets through named authorities with stated coverage, and it says
  when it cannot prove something rather than filling the gap.

Nothing in the interface may claim more than the second half allows.

## The organising idea

The word *Universe* is expressed through **scale, relationship, and motion**,
never through galaxy imagery, star fields, or cosmic gradients.

The axis the whole product turns on is **arriving to settled**:

| | Arriving | Settled |
|---|---|---|
| What it is | in the mempool, projected, provisional | confirmed, in a block, history |
| How it looks | lighter, unfinished, in motion | deep, solid, still |
| Where you see it | projected blocks, the Lens, incoming feed | confirmed blocks, transaction status |

A visitor should feel which side of that line something is on before reading a
word. That is why confirmed and projected blocks differ in weight and depth, not
only in a label.

## Colour

Defined in `frontend/src/styles/_universe-tokens.scss` and emitted as CSS custom
properties. A theme swap is a variable swap.

### The two rules

1. **Colour carries evidence state, never protocol identity on its own.**
   Protocol hues live in their own scale and only ever appear beside a protocol
   name. Evidence states always carry a word as well as a colour. That
   separation is why a protocol's colour can never be mistaken for "confirmed"
   or "failed", even where the hues are close.

2. **Green and red are reserved.** Green means proven. Red means unavailable or
   broken. Neither is spent on anything else. A block epoch running behind
   schedule is amber, because being late is a fact about timing rather than a
   failure. Not using an optional upgrade is neutral, because it is not an
   error.

### Evidence states

| Token | Means |
|---|---|
| `--u-state-proven` | An authority proved this, with coverage |
| `--u-state-partial` | Partly proven; a stated gap remains |
| `--u-state-pending` | Not settled yet; the answer may change |
| `--u-state-unavailable` | The authority could not be reached or has no answer |
| `--u-state-neutral` | A fact with no evidence claim attached |

Every state token comes with a `-surface` and a `-border` so a status treatment
is a tinted, bordered, worded object rather than coloured text. That keeps it
legible in greyscale, in print, and under forced colours.

### Themes

**Light is the primary experience.** It is defined on `:root` in `styles.scss`,
so it paints on the first frame with no stylesheet fetch and no flash of a
colour the visitor did not choose.

`theme-dark.scss` and `theme-contrast.scss` restate the same token names. They
are held to the same contrast floor. Dark is not a lesser version of the
product: same features, same density, same components.

Because the inherited Bootstrap 4 layer is compiled once and carries literal
colours no theme file can reach, `styles/_universe-bootstrap-bridge.scss`
restates every surface it paints in terms of tokens and is included last. That
bridge is what makes a theme swap repaint cards, tables, dropdowns, and form
controls instead of leaving dark rectangles on a light page.

### Blocks are objects

The chain visualisation keeps the same ink in every theme, the way a photograph
does (`--u-block-*`). This is deliberate: it gives the light page a solid focal
anchor rather than a washed-out outline, and it means a fee colour reads
identically whichever theme someone is using. Text printed on a block face takes
block ink, never page ink.

## Type

A system text face and a system data face, both resolved from the platform.
Nothing is fetched from a third-party font host, ever.

Identifiers use `--u-font-data` and wrap on any character, so a 64-character
hash can never widen a layout.

## Motion

Every animation reports a fact: something arrived, confirmed, was replaced, or
moved. Durations are short (`--u-duration-*`) because nothing decorative may
delay reading the number underneath it. Anything that cannot name the fact it
reports is removed rather than slowed down.

`prefers-reduced-motion` is honoured.

## Hierarchy

On a detail page the **identifier is the subject** and the category is a label
above it. A transaction page leads with the hash, not with the word
"Transaction".

Panels state what they are, where they lead, and one line on why it matters. The
note is what turns a number into something a newcomer can act on.

## Writing

Precise, direct, calm under uncertainty. Say what is true and no more.

- Explain a term at the moment it matters, not in a glossary.
- Never restate a status the reader can already see. If a chip says the evidence
  is incomplete, the sentence beneath it says what that means for *this*
  transaction.
- Distinguish "there is none" from "we could not tell". These are different
  facts and the interface must never collapse them.
- Exact figures stay exact. Grouping digits is presentation; rounding is not.
- No superlatives, no manufactured urgency, no claims that cannot be checked.

Banned outright: "next generation", "revolutionary", "cutting edge", "seamless",
"unlock the future", "powerful platform", "all-in-one", "game changing",
"supercharged", "effortlessly", "welcome to the future".

Also banned: the em dash (U+2014). Use a colon, a comma, or two sentences.
`scripts/universe/check-text.mjs` fails the build if one appears.

## Accessibility

WCAG 2.2 AA is the floor, checked automatically rather than remembered.

- Every interactive element has an accessible name.
- Focus is always visible, and the focus ring is deliberately not the brand
  colour so a brand-coloured control still shows one.
- Colour is never the only signal.
- No critical route overflows horizontally at 320px.
- Touch targets clear the minimum on the mobile navigation bar.

`scripts/universe/visual-qa/capture.mjs` drives the whole route matrix across
themes, viewports, and data states, answering every request including the
WebSocket from fixtures so a difference between runs means the interface
changed rather than the chain moving.

## Where things live

| Path | What |
|---|---|
| `frontend/src/styles/_universe-tokens.scss` | every token, light and dark |
| `frontend/src/styles/_universe-bootstrap-bridge.scss` | the inherited Bootstrap layer, repainted |
| `frontend/src/theme-dark.scss`, `theme-contrast.scss` | the alternate themes |
| `frontend/src/app/universe/_universe-tokens.scss` | Universe surface mixins, delegating to the tokens above |
| `scripts/universe/check-text.mjs` | the em dash gate |
| `scripts/universe/check-branding.mjs` | the upstream mark gate |
| `scripts/universe/visual-qa/` | the visual, accessibility, and cross-browser matrix |
