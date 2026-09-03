# Offline and installed

The explorer, on a device, with the network gone.

## The promise

**Install it, lose the network, and keep working: the tools that run in the
browser keep running, and everything stored says when it was captured.**

An explorer that pretended to work offline would be worse than one that
admitted it could not. The line this product holds is narrow and deliberate:
interface and analysis survive the loss of the network; facts about the chain
do not, and a stored fact never poses as a live one.

## What is installed, and what it means

Installing (from the banner, from `/offline`, or from the browser's own
controls) puts three things on the device:

1. **The interface.** The application shell, including the transaction and
   privacy tools, which run entirely in the browser.
2. **Recent chain answers.** Up to 60 API responses the explorer fetched,
   each stamped with the time it was captured.
3. **Your own data.** Saved items, recents, and preferences, which never
   leave the device whether or not anything is installed.

## The three caches, and what each may hold

| Cache | Holds | Rule |
| --- | --- | --- |
| `universe.shell` | The document, `/offline`, icons | Captured at install. |
| `universe.static` | Hashed build files, fonts, images | Cache first: content addressed names cannot go stale. |
| `universe.api` | Up to 60 recent API answers | Network first. Stored only so an offline visitor sees the last captured truth, marked as captured. |

## What is never stored

Some surfaces are refused before the question of a cache even arises:

- everything under `/api/v1/admin`, the operator's own console traffic;
- `/api/v1/node/rpc`, the node console;
- websockets and streams;
- every non GET request, which is every request that could act on anything.

A method that is absent from the stored set is not throttled or trimmed. It
is unreachable from storage, and the test suite holds that line.

## How a stored answer admits it

Every API answer in the cache carries an `x-universe-snapshot` header with
the time it was captured. While the network is away, pages you already
visited open from the shell and their data comes from that cache, and the
banner states plainly that you are offline. What it never does is show you a
stored number in a way that reads as current. The refusal is structural: an
answer about the present is only replaced by an older truth when there is no
network to ask, and the older truth says what it is.

## The `/offline` page

This page is captured at install precisely so it opens with no network. It
carries:

- the storage the browser reports, in units a person can read, or the honest
  word when the browser reports nothing;
- **delete stored interface and chain data**, which empties the three caches;
- **delete saved items and preferences**, separate on purpose, because one
  unlabeled lever that erases a workspace is not consent;
- the update control, when a newer build is waiting.

## Updates, at the visitor's pace

A newer build downloads quietly and waits. The banner offers it; reloading
applies it; ignoring it finishes what you were reading first. Nothing
reloads itself. Old caches are removed only after the new worker takes over,
so an interrupted update leaves the last good build intact.

## Sharing in

The manifest names `/share` as the share target, so a transaction id, a
block height, an address, or a link to any page here can be sent to the
explorer from the operating system's share sheet. The receiver resolves it
with the same rules search uses, asks the chain when a 64 character hash
could be a block or a transaction, and states plainly when it recognized
nothing. It never opens a plausible looking wrong page.

## What this product never does

- No stored answer is ever presented as live.
- No private surface, operator route, or non GET request reaches a cache.
- No update applies itself, and no install prompt interrupts.
- No number about the chain is kept available offline as if it were a
  subscription to the truth; it is a snapshot, and it says so.
