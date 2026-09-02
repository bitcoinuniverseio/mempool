# Live universe

Everything this deployment's stream delivers, on one honest page.

## The promise

**Show the arrivals as they come, let the visitor pause and walk through
them, and never imply the page remembers more than it does.**

## Route

| Route | Purpose |
| --- | --- |
| `/live` | The cross chain live view. |

## What streams here

The page subscribes to this deployment's Universe stream for every chain it
serves, across four channels: chain status, mempool snapshots, candidate
buckets, and confirmed protocol activity. Each arrival carries its chain,
its exact sequence number, its observation time, and its stated
completeness: complete, partial, or unavailable. A partial answer is shown
as partial. It is never padded out to look whole.

## Pause, scrub, replay, and what each one means

- **Pause** freezes the view, not the recording. Arrivals keep filling the
  buffer behind the frozen view.
- **Scrub** walks the buffer. The slider spans exactly what this page has
  received since it opened.
- **Jump to live** catches up to the newest arrival.

The buffer holds the last 500 arrivals. That is the whole of the replay
window, and the page says so at the bottom, with the count of duplicates
absorbed and the oldest arrivals dropped from the front. There is no
pretence of an archive; when the durable replay window exists, this page
will grow into it without changing its shape.

## Honesty machinery

- **Sequence numbers are exact.** They arrive as decimal strings and are
  compared as arbitrary precision integers, so nothing falls over beyond
  JavaScript's safe range and no gap hides in a rounding error.
- **Duplicates are absorbed.** A reconnect that redelivers shows once. The
  absorbed count is published, not hidden.
- **Gaps are reported.** If a channel skips, the board says how many
  sequence numbers are missing rather than presenting the surviving
  neighbours as if they were consecutive.
- **Quiet is quiet.** A channel with no arrivals says so, with its last
  arrival age in words, instead of showing a zero that could be mistaken
  for activity.

## The board and the feed

The **channel board** is one row per chain and channel: how much arrived
here, the last sequence, the stated completeness, how long ago the last
word came, and any reported gap.

The **feed** is the arrivals themselves, filtered by chain, channel, and
completeness. It is a table, always. The table is not an alternative to a
visualizer that visitors should prefer; it is the primary object, and any
visual dressing exists only on top of it.

## Accessibility

The feed is fully readable without the animation layer, which is exactly
why the feed is a table. Screen reader users get an optional announcement
channel (key events, or off) on an aria-live region, one line at a time,
silent while the view is paused. Reduced motion is honoured: the page has
no essential animation to disable, because nothing essential was ever
animation.

## What this product never does

- It never shows a partial arrival as complete.
- It never claims a replay window wider than its own buffer.
- It never lets a quiet channel wear the costume of activity.
- It never requires the animation layer to read the facts.
