# ANIMA Evidence Explorer

The ANIMA product shows the ANIMA protocol state machine as its first-party
authority sees it. index-anima follows the Bitcoin chain, applies blocks to
the protocol state with undo records, and serves organisms, lineage, and the
logged transition list. The explorer reads only from that authority. It never
infers state, ownership, or balances from transaction shape.

## What it does

- `/protocols/anima` - the protocol landing page in the common registry shell:
  identity, authority, readiness, and the same availability model every
  protocol uses.
- `/anima/transitions` and `/anima/events` - the logged transition list,
  oldest first, cursor-free positional paging. One component serves both
  paths so the two names cannot drift.
- `/anima/event/:eventId` - one logged transition with its Bitcoin anchor and
  the organisms it touched. Event ids look like `aHEIGHT:txIndex` and are
  issued by the explorer.
- `/anima/items` - the organism list with created height, status, and origin.
- `/anima/item/:itemId` - one organism: identity, current vessel, genome,
  waymarks, and achievements.
- `/anima/item/:itemId/history` - the organism's transition history beside
  the lineage document (parents, children, ancestors, descendants).

On every protocol detail page, a "Recent activity from its authority" panel
serves the protocol's own feed when the authority publishes one.

## Data source authority

| Fact | Source |
| --- | --- |
| Protocol parameters, tip, supply | index-anima `/anima/status` |
| Logged transitions | index-anima `/anima/events` |
| Organism records and lineage | index-anima `/anima/organism`, `/anima/lineage` |

index-anima is an open authority: it serves public, chain-derived data with
no authentication, and the explorer sends no credential to it.

## Verification semantics

The single-transition lookup is served honestly over a positional surface:
the event id encodes its block height, so the backend binary-searches the
authority's list and reports a proven miss rather than paging blindly. A
404 from `/anima/event/:id` means the authority logs no such event.

## Failure states

- An unconfigured authority is a served document with an explicit
  `unconfigured` state and a plain-language reason. It is never rendered as
  an empty protocol.
- An authority that cannot answer is a 502 on the API and a stated degraded
  panel on the page. It is never rendered as zero activity.
- An organism or transition that provably does not exist is a 404.

## Privacy boundary

index-anima sees hashes, never contents. The explorer adds no collection of
user data: these pages are accountless, and nothing typed into them is sent
anywhere beyond the read requests described above.

## Self-hosting

Deploy index-anima against a Bitcoin Core node with transaction indexing,
then add it to the explorer backend's source registry:

```
[{"authorityId":"index-anima","origin":"http://127.0.0.1:8788",
  "protocols":["anima"],"network":"bitcoin:mainnet"}]
```

No bearer token is needed. The value above matches the authority's default
port; change it to match the deployment.

## Release status

The registry entry ships BLOCKED. It is upgraded to verified only after the
authority answers in a deployed release and the explorer reads live data
through it, following the same evidence bar as every other protocol in the
registry.
