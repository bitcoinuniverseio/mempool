# Design review, 2026-08-27

Before and after for the light-first redesign of Universe Explorer.

`before/` is the interface as it stood once the light palette was first applied
and before any surface was redesigned. It is the honest starting point: the
token layer was already in place, which is why it is light at all, and every
other problem is still visible.

`after/` is the same routes at the end of this pass.

## What the pictures show

| | Before | After |
|---|---|---|
| Header | mark, one nav tile, a large dead gap, search pushed to the edge | brand lockup, labelled navigation, search taking the width it deserves |
| Navigation | icon only, no visible labels, several links with no accessible name at all | labelled at every width, a thumb-reachable bar below the breakpoint |
| Chain strip | confirmed blocks in flat saturated brand, projected blocks in mud; fee ranges and pool credits unreadable | blocks as objects with their own ink: projected light and unfinished, confirmed deep and settled |
| Homepage | seven Bootstrap cards, each with a centred 10px uppercase caption | one composition with a stated reading order and a line on why each panel matters |
| Universe Lens | four `btn-xs` toggles above a grey square | a segmented control and the block actually drawn, on its own ground |
| Difficulty | blue and alarm-red bar | brand for mined, amber for behind schedule; red kept for things that are broken |
| Transaction | a 2.5rem "Transaction" over a small hash, Taproot marked in error red | the identifier leads, feature chips are neutral facts, evidence states carry words |

## How these were produced

    node scripts/universe/visual-qa/capture.mjs --base=<url> \
      --routes=home,tx,protocols --themes=default,dark --viewports=320,1280

Every request, including the WebSocket, is answered from
`scripts/universe/visual-qa/fixtures.mjs`, so a difference between two runs
means the interface changed rather than the chain moving.

## Measured at the end of this pass

Across 13 routes, 3 themes, 320px and 1280px, in Chromium, Firefox, and WebKit:

- 0 accessibility violations (axe, WCAG 2.2 A and AA)
- 0 contrast failures measured against rendered pixels, including text over
  painted surfaces and canvases
- 0 horizontal overflow at 320px
- 0 broken images, 0 navigation failures
- 0 keyboard stops without an accessible name or a visible focus indicator
- nothing animating under `prefers-reduced-motion: reduce`
