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
- Touch targets clear 24 by 24 everywhere and 44 by 44 in the shell, in
  pagination, and anywhere a control repeats. See The adaptive window.
- Nothing the browser scrolls to lands under the header or the bottom bar.
  Each header shape states its own scroll padding.
- No field computes under 16px, so no phone zooms the page on focus.
- Zoom is never restricted.

`scripts/universe/visual-qa/capture.mjs` drives the whole route matrix across
themes, viewports, and data states, answering every request including the
WebSocket from fixtures so a difference between runs means the interface
changed rather than the chain moving.

## The adaptive window

The layout responds to the window it is in, never to the device it believes it
is on. There is no user-agent sniffing anywhere in the product, because the same
phone is four different windows depending on its orientation, its browser
chrome, whether it is sharing the screen and whether it is folded.

### Widths

| Range | Shape |
|---|---|
| under 600px | header wraps to two rows, search on its own beneath the brand and the pickers; bottom bar |
| 600 to 991px | header on one row; bottom bar |
| 992px and above | header and navigation on one row, navigation returns to the top |

The one shell breakpoint is 992px. Everything else is fluid, wraps, or uses a
minmax grid. New component rules should prefer a container query to a media
query: a component that reads its own width keeps working when it is moved into
a narrower column, and one that reads the viewport does not.

### Heights

Compact landscape, under 480px of height, is its own case and not an
afterthought. A phone on its side has less room than any other window in the
matrix, and both fixed layers eat into it. The header drops to 48px, the bottom
bar puts each icon beside its label instead of above it, and the scroll padding
comes down to match. No destination and no control is removed to buy the space.

### Reserving room for data that has not arrived

In a column with a viewport height, anything that grows moves everything below
it, and a panel that grows by a third of the screen is the whole layout-shift
budget on its own. So a block that will be filled from the network reserves its
room before the answer arrives, and the loading state fills that same box.

The reservation needs one height, and states that carry different content do
not have one by default. The transaction tracker is the worked example. Its
rows under the tracker bar settle at two sizes: a pending transaction shows a
first-seen time and an ETA, one line each; a confirmed one shows a timestamp
whose relative time goes to a second line below 992px, and a confirmation count
that is a button rather than a line of text. Reserving the smaller trades one
shift for another.

The rule that follows: give the row the reservation, not the block. Every row
in that panel is two lines of value tall, because the tallest of them is, so
both settled states are 4.5em a row, the block holds 9em with nothing in it,
and skeleton rows fill it while the transaction is being read. Nothing moves
when the answer arrives, and nothing moves again if a watched transaction
confirms. Rows taller than their content centre it, because a reservation that
shows as a gap under the text reads as a mistake.

### The safe area

`viewport-fit=cover` is set, so the page runs under the notch and the home
indicator rather than sitting in a letterbox. That is only safe because
everything that touches an edge reserves the inset:

| Token | Where it is spent |
|---|---|
| `--u-safe-top` | the header's own top padding, so its background reaches under the status bar |
| `--u-safe-bottom` | the bottom bar's padding, and everything reserving room for the bar |
| `--u-safe-left`, `--u-safe-right` | the header row, the bottom bar, and the content column |

Two rules go with them. Use them through `max()`, so a phone with no cutout
keeps its ordinary padding rather than losing it to an inset of zero. And put
them on the chrome and on the content column, never on `body`: padding the body
pulls the header and the bar in from the edges and leaves a strip of page colour
down the side of both.

`--u-bottom-nav-space` is the bar's height plus the bottom inset. Anything
clearing the bar reserves that, not a copied number. The reservation lives on
the shared parent of the router outlet and the footer, because the footer is a
sibling of `main` and a reservation inside `main` cleared the bar for every route
and not for the footer.

### Viewport units

- `100lvh` for a floor that must not move. The page column uses it to keep the
  footer below the fold: `dvh` there would reflow the column every time the
  browser chrome collapsed, which is the shift the floor exists to prevent.
- `100dvh` for a ceiling on a surface that must fit, such as a menu.
- `100vh` is kept underneath both as the fallback for engines without them.
- No layout depends on `100vh` alone.

Neither unit knows about the software keyboard. On iOS the keyboard is painted
over the page and every unit keeps reporting the full height, so
`UniverseViewportService` publishes `--u-visual-viewport-height` from
`visualViewport` where the browser has it. It is the only piece of adaptive
behaviour in the product written in TypeScript, it is used only as a cap
alongside a `dvh` value, and where it is absent the CSS fallback is the answer.

### Touch targets

Two floors, because there are two rules.

- **24 by 24 CSS pixels** everywhere, which is WCAG 2.2 AA, with the standard
  spacing exception: an undersized target passes when nothing else falls inside
  the 24px circle around it. The exception is the substance of the rule, not a
  loophole. What makes a small target unusable is hitting the wrong one.
- **44 by 44** for anything in the application shell, in pagination, or repeated
  three or more times identically. That is Apple's number; Android asks for 48,
  and `--u-touch-target-comfortable` is there for controls that can afford it.

Both are measured by `mobile-check.mjs` against what is painted, so a control
shrunk by its container fails the same as one declared too small.

Box-like controls take a `min-height` and a `min-width`. Text links in dense
data take room on the block axis instead, and the row grows with them: pulling
the row back to its old height with a negative margin makes every target overlap
its neighbours, which is the fault the rule exists to prevent, reintroduced by
the fix for it.

Two mixins in `src/app/universe/_universe-tokens.scss` write both shapes, so a
component does not restate the numbers:

| Mixin | For |
|---|---|
| `universe-touch-box($min)` | a control that already has a background or a border |
| `universe-touch-line($line)` | a text link that is the whole value of a line |

Whole families of control are handled once in `styles.scss` rather than
component by component, because the pattern is what identifies them and not the
class they happen to wear: a link in a table cell, a link that is the value of a
`<dd>`, a link inside a `<nav>`, a link that is an entire heading, a `<summary>`,
and a link written as a direct child of a `.panel`, which is how a section's own
call to action is written here.

There are two exceptions, and both are in the standard. A link inside a run of
text is exempt, because enlarging a word inside a sentence breaks the sentence.
A control inside a `<label>` that itself clears the floor is not the target; the
label is, and measuring the 18px checkbox inside it describes the markup rather
than what a thumb hits.

Where a control cannot grow without changing what it means, the box grows and
the paint does not. The replacement timeline's markers are 24px because that is
what reads as one step on a timeline: they take a 10px transparent border with
`background-clip: padding-box`, and a negative margin hands the space back to
the layout, so the target is 44 and the marker is still 24. That is only safe
where nothing is beside it, which on that timeline is 220px across and 186 down.

### Room down the sides

Every page keeps its container's 15px of side padding. `.container-xl` is what
supplies it and a shorthand `padding` on a class written onto the same element
silently takes it away, which is how six Universe pages came to run their
headings and their prose hard against both edges of a phone. Set the block axis
by name: `padding-block: 1.25rem 3rem`.

### Form fields

Every field a software keyboard opens computes at `--u-text-field`, which is
16px. Below that, iOS Safari zooms the layout viewport in on focus and does not
zoom back out. It is an engine threshold, not a preference. Never solve it with
`maximum-scale` or `user-scalable=no`: taking zoom away breaks the page for
everyone who enlarges it to read.

### Horizontal scrolling

The page never scrolls sideways, at any tested width. A region may, on two
conditions: it says so, and a keyboard can reach past its edge.

Saying so means a `data-scroll-region` attribute, a `role` and an accessible
name, and a visible affordance. The block timeline is the one such region in the
product, because blocks are a sequence and stacking them would destroy the view.
The bottom bar is the other, and it uses the two-layer background technique for
its affordance: opaque covers that scroll with the content sitting over static
shadows, so a fade appears on exactly the side that has more and never when
everything already fits.

An edge shadow that a label can scroll under is held to the contrast floor like
any other painted surface. `--u-nav-scroll-shadow` is 14 percent rather than the
general 28 percent for that reason, and the number came from the measurement.

### Clipping is worse than scrolling

A box that scrolls sideways without saying so is a fault. A box that does not
scroll at all is a worse one: `overflow-x: hidden` and `clip` cut the excess
away and leave no scrollbar, no drag and no keyboard route to it, so the page
looks finished and part of it is simply gone.

`.page-shell` carries `overflow: clip`, which means nothing inside it can widen
the document. Every check that reads the document therefore passed while the
block page lost 120px of its details table, the source page lost 384px of
licence text, the address page lost the right-hand half of every address, and
both chain dashboards drew the lens 130px wider than the screen. The gate now
measures the clip itself, and attributes it: it names the box that is cutting
and the element sticking out of it.

Deliberate clipping is not a fault and the gate knows the difference. A box
under 40px wide is the visually-hidden pattern. `text-overflow: ellipsis` says
what it is doing on the screen. `app-truncate` shortens an identifier on
purpose, shows its head and its tail, links to the page carrying the whole
value, and keeps a hidden full copy so a selection copies the real thing.

### Tables on a phone

Two answers, and which one is right depends on what the table is for.

**A list of things to open becomes a list.** The blocks list is one row per
block and each row is a thing to open, so below 576px `stacks-on-phone` turns it
into one card per row, each field on its own line with its column name beside
it. Nothing is hidden and nothing is clipped, and the columns that a desktop
breakpoint used to drop come back: at 320px the blocks list had been showing a
height, a broken logo, and a reward cut in half by the edge of the screen.

Two rules make it safe. The template MUST carry explicit ARIA roles, because
changing `display` away from the table values is what strips a table of its
implicit ones and a stack of unlabelled divs is worse than the table it
replaced. Every cell MUST carry `data-label` with its column's name, which is
what gets printed beside the value. The header row stays in the accessibility
tree and leaves the screen, so it is clipped rather than `display: none`.

**A ledger stays a ledger and the region scrolls.** A figure read under two
rulesets that are allowed to disagree is read across, so the chain pages keep
their columns inside `.table-wrap`, which declares itself with a role, a name, a
tab stop and the two-layer scroll shadow. That contract was a claim rather than
a fact until recently: the table took `width: 100%` and nothing else, so it
never grew past the screen and squeezed its columns instead, and the ZRC-20
token column came out 24px wide, one character per line, inside a wrapper
announcing itself as a scroller with nothing to scroll. `min-width: max-content`
is what makes it true.

## The mobile gate

`scripts/universe/visual-qa/mobile-check.mjs`, run by the `mobile` job in CI
beside the visual matrix rather than inside it.

It is built the opposite way round from the matrix: few page loads and many
assertions on each, because a page load costs seconds and an assertion costs a
millisecond.

It walks every route the matrix walks. It used to walk a chosen fifteen of them,
on the argument that the shell checks catch most faults wherever they are, and
the argument was wrong in a way worth writing down: running the same checks over
the other twenty-nine found thirty-six failures on the first pass, none of them
shell faults. Protocol tabs at 31px on seven routes, a select that zoomed an
iPhone in on the saved page and left it there, an output page with overlapping
targets, a replacement timeline scrolling sideways with nothing to say so. A
gate that measures the pages someone thought to list measures the author's
expectations.

The cost is paid where it buys something. Every route is measured at 320, at 390
and in landscape, which are the three windows that change the answer. The
fifteen that are one of each thing the product is made of add the other four,
so a breakpoint that goes wrong between the phone widths, or a wide layout
regressed by a mobile fix, is still caught. Forty-four routes comes to about ten
minutes, against the matrix's sixty.

| Window | Why it is in the set |
|---|---|
| 320 x 568 | narrowest width still in use; every reflow rule is written against it |
| 360 x 740 | the most common Android width |
| 390 x 844 | the most common iPhone width, and the one carrying a simulated cutout |
| 430 x 932 | the widest phone |
| 844 x 390 | a phone on its side: compact width, almost no height |
| 768 x 1024 | tablet, where the shell is still in its compact form |
| 1024 x 900 | the desktop control: a mobile fix that regresses the wide layout fails here |

Compact windows are run with `isMobile`, which is what makes Chromium and
WebKit report a coarse pointer. `hasTouch` alone does not, and without it every
`@media (pointer: coarse)` rule in the product goes unexercised while appearing
to be covered.

Three engines, with `--browser`, across two CI jobs. The `mobile` job runs
Chromium and the performance gate on the runner fleet. The `mobile-engines` job
runs WebKit and Firefox on a hosted runner, and that split is not a preference:
WebKit needs system libraries a Chromium-only host has never had, it refuses to
launch without them rather than degrading, and the fleet's runner user has no
passwordless sudo to install them. When the fleet image gains those libraries,
the two jobs should become one again.

WebKit is the engine Safari is built on, and Chrome on iOS with it, which is
the closest an automated run gets to an iPhone. Firefox cannot be put into
mobile emulation, so it reports a fine pointer and takes a narrower pass:
window sizes, overflow, fixed layers, safe areas and rotation are all still
measured there, and the run says so in its own header rather than leaving a
reader to assume otherwise.

That is also why every rule with a touch floor is written
`@media (pointer: coarse), (max-width: 991.98px)` rather than on the pointer
alone. Pointer reporting is not reliable across mobile browsers, desktop-mode
requests and emulation, and below the shell breakpoint the product is already
in its mobile shape, so it should have mobile ergonomics whatever the pointer
claims.

The cutout is injected by overriding the four safe-area properties, because
headless Chromium has no notch and `env()` is zero everywhere. What is being
tested is whether the layout reserves room when the numbers are not zero.

What it fails a run for:

- the page scrolling sideways, naming the outermost elements responsible
- a region scrolling sideways without declaring it, or with nothing focusable in it
- a box clipping its content sideways with no way to reach it, naming both the
  box and the element sticking out of it
- a field computing under 16px
- a target under either floor
- content resting behind the header or the bottom bar, saying whether the
  element is in flow or pinned, because those are different faults
- focus resting entirely behind either layer, which is WCAG 2.2 AA. Focus
  landing partly under a layer is the AAA rule: it is counted and printed every
  run and does not fail it, because the stylesheet aims for it and Chromium and
  WebKit reach it while Firefox does not re-scroll something already partly in
  view. Printing it is what keeps that difference visible
- the header or bar not reserving a simulated inset
- a menu taller than the window that does not scroll
- the bottom bar scrolling with no affordance, or the current destination scrolled out of sight
- a rotation and a rotation back changing the route or losing the reading position

Run it against any served build:

```
node scripts/universe/visual-qa/mobile-check.mjs --base=http://127.0.0.1:8080
```

`--routes` and `--viewports` narrow it while working on one thing. Passing
`--viewports` also turns off the tiering, because a run with it is someone
chasing one thing and should measure exactly what was asked for. Route ids come
from the same list the visual matrix walks, so the two gates cannot disagree
about what the product is.

## Performance budgets

`scripts/universe/visual-qa/mobile-perf.mjs`, in the same job, on a 390 by 844
window with the processor throttled four times and the network at slow 4G.

Two numbers are gated, and they are the two that are properties of the build
rather than of the machine:

| Budget | Value | Why it is gateable |
|---|---|---|
| eager payload, compressed | 480kB | the same commit gives the same number anywhere |
| cumulative layout shift | 0.1 | mostly the stylesheet, and the load can only add to it |

The eager payload is runtime, polyfills, main and styles: what a browser must
have before the shell exists. Measured at `bea93c1ec`, develop was 463kB
compressed and 1655kB raw; with the first mobile work it was 464kB and 1659kB,
and with the tables, the touch floors and the reachable tooltips it is 465kB
and 1664kB. The ceiling is set where a real regression trips it and ordinary
drift does not. Raise it deliberately, and say what bought the bytes.

Four kilobytes of headroom is not much, and it is worth knowing where the last
of it went: a stylesheet rule costs bytes whether or not any page uses it, so
the shared patterns above are cheaper than the same rules written out per
component, and that is part of why they are shared.

Layout shift is less deterministic than a stylesheet property sounds. The same
tree measured 0.042, 0.046 and 0.069 on the blocks route across three machines,
because a busier machine delivers content later and a shift that lands after
the first paint counts while the same shift before it does not. Load can only
add shifts, never remove one, so a route over its ceiling is measured again, up
to twice, and judged on the smallest reading. The table says when a route was
measured more than once, because a gate that quietly retries until it passes is
worse than one that fails.

Largest contentful paint is printed and not gated. The 2.5 second target is a
field number for a real device on a real network, and this is a throttled
headless browser on a runner that is also building and serving. The same commit
measured twelve seconds and twenty on two routes whose shells are identical. A
number that swings by eight seconds between runs of the same code cannot gate
anything; used as one it fails honest changes and passes slow ones depending on
what else the machine is doing. The paint is waited for rather than read once,
and when it still has not arrived the page is asked what is on it: a screenful
of text with no paint entry is a measurement problem and is reported as one,
while a page with nothing on it is the fault the check exists for. That
distinction does not move with the load.

### Real devices

Emulation is the gate; devices are the proof. Before a mobile change is
promoted, check on current Safari on iPhone and iPad, Chrome on Android, Samsung
Internet and Chrome on iPhone: the header and search, a chain switch, a search
with the software keyboard open, a transaction, a table, the bottom bar, a
rotation, back navigation, and a live update arriving.

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
| `scripts/universe/visual-qa/mobile-check.mjs` | the mobile gate: windows, insets, targets, fixed layers, rotation |
| `scripts/universe/visual-qa/mobile-perf.mjs` | the payload, the layout shift, and the table for recording a route that is over budget |
| `frontend/src/app/universe/universe-viewport.service.ts` | the visual viewport, published as CSS, for the software keyboard |
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
