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

## The brand

Universe Explorer is part of Bitcoin Universe, and it looks like it. Core,
Wallet and Inscribe are all built on the same pink-forward system, so an
explorer in ultramarine read as a different company's product wearing our name.

### Personality

A precision instrument finished to a high standard. Editorial, confident,
technical, and adult. The reference is a control room designed by people who
also design magazines, not a fashion site with charts bolted on.

What that rules out, explicitly: bubblegum, cyberpunk neon, glass everywhere,
galaxy wallpaper, floating shapes, decorative gradients, rainbow fills, and
anything that would make a person hesitate to open this on a work screen.

### The pink rule

**Pink is the brand, and only the brand.** It marks identity and intent: the
mark, the primary action, active navigation, selection, focus offset, live
surfaces, and display type. It never carries a status, a protocol, a fee band,
or a quantity.

That is the whole reason the pink can be loud. A reader learns in one screen
that pink means "this is Universe, and this is where you act", so it never has
to compete with the colours that mean something about Bitcoin.

**Filling a bar is not carrying a quantity.** A progress bar, a block fullness
bar, or a single-series area chart may be brand pink, because the value is
carried by the length or the height and the fill is just the mark. What is
forbidden is colour that *encodes* the value: a fee band, a status, a protocol,
a heat scale. If changing the number would change the colour, the colour is not
allowed to be the brand.

One consequence worth stating, because it is the only place the system bends:
the fee scale runs to a deep magenta at its expensive end, and that band sits
about 10.7 dE from the light brand fill. Both values are load bearing. It is
recorded in `check-palettes.mjs` at the distance it actually has, so nudging
either one closer fails the build.

### Colour roles

| Token | Value, light | Value, dark | Role |
|---|---|---|---|
| `--u-brand` | `#c40059` | `#ff8ab8` | The working pink. Readable as text and as a fill. |
| `--u-brand-hover` | `#a80049` | `#ffb3d1` | Hover of the above. |
| `--u-brand-contrast` | `#ffffff` | `#2a0a18` | The foreground every brand fill declares. |
| `--u-brand-accent` | `#ff0066` | `#ff2a85` | The identity anchor. Borders, rings, rules, display type. |
| `--u-brand-subtle` | `#fde9f1` | `#2e1226` | Brand-tinted surface. |
| `--u-magenta` | `#a3006b` | `#ff6fd0` | Second stop of the house sweep. |
| `--u-fuchsia` | `#8b2fb5` | `#d98cf5` | Third stop of the house sweep. |
| `--u-lavender` | `#5b2fa6` | `#c4a7ff` | The secondary accent, and the focus ring. |
| `--u-chrome` | `#6b6280` | `#b9bed6` | Metal, as readable ink. |
| `--u-chrome-rim` | `#c9cddf` | `#4a4560` | Metal, as a hairline. Carries no text. |
| `--u-pearl` | `#fff6fa` | `#fff6fa` | The light ground, and ink on brand tiles. |
| `--u-blush` | `#ffd8e7` | `#ffd8e7` | The softest brand tint. |

`#ff0066` is the value the rest of Bitcoin Universe is built on, and it is the
value this product uses for identity. It is not a button fill: white on it
measures 3.85:1 and misses AA. That is the entire reason `--u-brand` and
`--u-brand-accent` are two tokens rather than one.

### The foreground contract

Every strong fill declares what goes on it. A component never guesses.

```scss
background-image: var(--u-gloss), var(--u-gradient-brand);
color: var(--u-brand-contrast);
```

`check-palettes.mjs` measures that foreground against **every stop** of the
gradient, **through** the gloss layer. That check is not decorative: a 0.24
gloss put a white label at 4.06:1 on the violet end of the sweep, which is why
the gloss is 0.16.

### Gloss, glow, and the sweep

Three finishes, and a rule for each.

| Token | What it is | Where it is allowed |
|---|---|---|
| `--u-gradient-brand` | hot pink to magenta to fuchsia | The mark, the primary action, live surfaces |
| `--u-gloss` | a top specular highlight | Filled brand controls only |
| `--u-glow-brand` | a soft brand shadow | The primary action, and singleton surfaces |
| `--u-gradient-chrome` | pearl to chrome to steel | Metallic frames, never behind body text |
| `--u-gradient-pride` | a refined spectrum | At most one rule per screen, never a fill |

The pride rule is a rule, not a wash. It appears as a hairline under a single
divider and nowhere else. Applied broadly it stops meaning anything.

### Surfaces

Light runs pearl to white: the page floor carries a violet cast so it belongs to
the same material as the pink on it, and a raised card is pure white, so
elevation reads without a shadow and dense tables stay crisp.

Dark runs plum-black, the same shell the rest of Bitcoin Universe uses. That is
what makes hot pink read as lacquer rather than as neon on grey.

### The mark

Two squares on a diagonal: one still forming, one settled. That is the product's
own axis, and it is the only idea the mark carries. It is deliberately not a
hexagon, an orbit, a globe, or a planet, because those are the defaults of this
category and none of them says anything about this product.

It is drawn in `currentColor` plus one brand token, so it is correct on either
theme, survives a monochrome favicon, and never depends on a font.

The wordmark is live text in the interface's own font stack, so it always
matches the product around it. Exported assets that cannot rely on a font are
rendered to raster by `scripts/universe/brand/render-brand-assets.mjs`.

### Icons and the tab strip

The favicon is inverted on purpose: a pearl mark on a hot-pink tile, rather than
a pink glyph on white. Every explorer in this market ships a dark or a white
favicon, so a solid pink tile is the one that can be found in a strip of twenty
tabs. Pearl on `#c40059` measures 5.7:1, so the mark is still legible at 16px
rather than relying on the tile colour alone.

### Relationship to the rest of Bitcoin Universe

Same anchor, same secondary, same shell material, same discipline about status
colour. Not the same product: this one is denser, quieter, and light by default,
because it is read for minutes at a time rather than glanced at.

## Colour

Defined in `frontend/src/styles/_universe-tokens.scss` and emitted as CSS custom
properties. A theme swap is a variable swap.

### The three rules

1. **Pink is the brand, and only the brand.** It is never a status, a protocol,
   a fee band, or a quantity. `check-palettes.mjs` measures that every brand
   role sits at least 25 dE from every state colour and every protocol colour,
   under normal vision.

2. **Colour carries evidence state, never protocol identity on its own.**
   Protocol hues live in their own scale and only ever appear beside a protocol
   name. Evidence states always carry a word as well as a colour. That
   separation is why a protocol's colour can never be mistaken for "confirmed"
   or "failed", even where the hues are close.

3. **Green and red are reserved.** Green means proven. Red means unavailable or
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

**The distinction has to survive the trip to get here.** These five states are
the product's whole claim, and an interface can only show a difference the code
feeding it preserved. On 29 August 2026 this shape was found again and again
through a single release, across the product, the infrastructure, the release
tooling and these gates: somewhere, "I do not know" and "I know, and the answer
is no" were the same value. The count is deliberately not given, because it
kept rising while this was being written, which is the more useful fact about
it.

An indexer publishing `block_count` where the reader expected `blockCount` was
read as publishing no checkpoint. A WebSocket handshake sent with no `Origin`
header was read as permitted, so every probe passed and every browser was
refused. A field-name pattern matching `supply` read a token quantity as a coin
amount. A Bitcoin node answering "no such block" was read as a failure, so a
healthy chain was reported unavailable on every search.

The worst of them were in the machinery meant to protect all of this, which is
where the shape is most expensive because its failure mode is silence. GitHub
reports a pull request as `CLEAN` whether its checks passed, failed, or never
ran, and a promotion waiter reading that would have pushed an unvalidated commit
to `main`. The contrast probe in `scripts/universe/visual-qa` recorded an empty
result when it threw, which is what a clean page also produces, so a run that
measured nothing printed the same zero as a run that measured everything. And
`check-text.mjs` and `check-branding.mjs`, pointed at a `frontend/dist` that
exists and is empty, which is its state for the whole of a build, read no files
and printed the sentence a clean output prints. Those two guard the release
artifact.

All three now say when they measured nothing, and fail rather than pass. A gate
is allowed to find nothing. It is not allowed to look at nothing and report it
the same way.

So the rule is not only about rendering. Anywhere this product reads something
it does not fully control, a payload, a header, a field name, a status, it must
be able to say which of the five it has. If an unrecognised input and a
definitive negative produce the same value, the interface downstream cannot
recover the difference, and it will state one of them as the other with the
full confidence of a measured colour and a word.

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

### Chains carry a mark, not a meaning

A chain gets a small round mark beside its name, drawn from the protocol scale
(`--universe-protocol-*`). That scale is already held apart from every evidence
state and from the brand, and it is measured rather than judged, so a chain mark
can never be mistaken for a verdict. The mark never appears without the chain's
name beside it, which is the same rule protocol hues follow.

Chain identity is otherwise carried by words and by the chain selector, not by
repainting the product. Dogecoin does not turn the interface gold and Zcash does
not turn it yellow: the tokens are the same on all three chains, because the
evidence vocabulary has to mean the same thing everywhere.

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

## The status rail

Every chain page opens with the same instrument: five readings, always the same
five, always in this order.

| Reading | Answers |
|---|---|
| Chain | Is this chain answering at all |
| Chain tip | Which block is the present |
| Behind tip | How far back the figures on this page are true as of |
| Last observed | When the reading was taken |
| Pending coverage | How complete the unconfirmed set is |

Three rules hold it.

- **The rail never loses a reading.** A reading whose fact is missing says so in
  its own place. A rail with a hole in it reads as a page still loading, which
  is exactly the wrong thing to communicate when the answer is that a fact is
  unavailable.
- **Any lag at all is `partial`, never `proven`.** Zero blocks behind is the
  only reading that earns the proven treatment, because a page describing a past
  state of the chain is a partly proven page whatever its other figures say.
- **Not offered and not stated take different treatments.** A capability the
  chain declined is `unavailable`; a capability nobody could ask about is
  `neutral`. Collapsing them would report an unreachable authority as one that
  answered.
- **The Chain reading is the chain's own verdict, not its node's.** A chain
  publishes `ready` for everything the explorer needs and `sync.state` for the
  node's view of its own blocks, and they disagree: a chain whose node is
  caught up while a protocol indexer is silent publishes `sync.state: ready`
  and `ready: false`. The reading takes the stricter of the two, so the rail
  can never say Ready about a chain that has just said it is not.

### Saying why

The rail states a verdict in one word. Directly beneath it, and only when the
chain says it is not ready, the page states the evidence for that verdict: the
codes from `degradedReasons`, read into sentences by
`multichain-explorer/chain-reasons.ts`.

- The table there is an **allowlist**, not a pattern. A pattern would match a
  code it has never seen and assert a meaning for it.
- A code carried by a source that is **ready** is a stated edge of its
  coverage, not a fault, and appears under its own heading rather than in the
  colour that means something is broken. `tap_doge` publishes two while ready
  and complete.
- A code with **no sentence in this build** keeps its own words and is marked
  as one this build has no description for.
- A chain that withholds readiness and **states no reason** is reported as
  having stated none. An empty space where the explanation belongs reads as a
  chain that is fine.

## Numbers

Amounts cross the API as exact decimal strings and are never parsed into a
JavaScript number anywhere in the presentation path. Grouping and the decimal
shift are string operations, and every rendered figure keeps the exact source
string on its `title`, so the value a reader copies is the value the authority
sent.

The rule that decides whether a figure may be shifted at all is an allowlist of
the fields that carry the chain's own coin, not a pattern over field names. A
pattern that matched `supply` once printed a DRC-20 token supply of
`100000000000` as `1,000 DOGE`, because a token's units are its own and have
nothing to do with koinu. Anything not on the allowlist is shown as the exact
integer it arrived as. Shifting an unknown quantity by eight places does not make
it more readable, it makes it wrong.

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
- A region that scrolls with a mouse takes focus and shows it, so a wide table
  is reachable from a keyboard. Three chain routes shipped without that.
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
| `frontend/src/app/universe/multichain-explorer/multichain-view.ts` | the chain presentation model: exact numbers, evidence tones, shape readings |
| `scripts/universe/visual-qa/chain-fixtures.mjs` | the chain states the matrix holds: at tip, behind tip, authority unreachable, object missing |
| `scripts/universe/check-text.mjs` | the em dash gate, over source and over the built output |
| `scripts/universe/check-colors.mjs` | no raw interface colour, including in style and attribute bindings |
| `scripts/universe/check-palettes.mjs` | every dynamic palette, role separation, theme parity, retired values |
| `scripts/universe/check-fills.mjs` | every filled surface that carries text declares its ink |
| `scripts/universe/check-branding.mjs` | the upstream mark gate |
| `scripts/universe/visual-qa/capture.mjs` | the route matrix: themes, widths, and data states |
| `scripts/universe/visual-qa/modes-check.mjs` | forced colours and 200 percent zoom |
| `scripts/universe/visual-qa/fixtures.mjs` | the data every reviewed route renders from |

## A note on the fixtures

They are part of the design system, not a test detail. Five defects on this
product were invisible for as long as they existed because the surface that
showed them had no fixture and rendered as a skeleton, an error, or a flat
shape in every screenshot ever taken: a green at 2.37:1 on the mining
dashboard, a red button at 3.21:1 on the address page, the address page itself
throwing on a response of the wrong shape, the release identity page rendering
blank, and a depth chart whose entire palette collapsed into one band because
the numbers were four orders of magnitude too small.

A route that renders nothing passes every automated check. When a fixture is
missing or wrong, the review it feeds is not weaker; it is absent, and it
reports success.

The sixth case was a whole surface rather than a defect. The Dogecoin and Zcash
routes shipped with no fixture and no route entry, so eleven pages reached
production without one screenshot, contrast probe or unfinished-page check ever
looking at them. They are in the matrix now, and the states they hold are the
ones the interface has to be honest about rather than the ones that are easy to
produce: a chain at its tip, a chain behind its tip, an authority that cannot be
reached, and an object that simply does not exist. Chain states are scoped to
chain routes, so the matrix does not pay for combinations that measure nothing.
