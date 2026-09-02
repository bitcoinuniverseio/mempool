# Provenance graph

Where one transaction's value came from, and where it went.

## The promise

**Draw only what the chain proves about a transaction, state what could not
be read, and hand the same facts to everyone: as a drawing, as a table, and
as data.**

## Route

| Route | Purpose |
| --- | --- |
| `/graph/tx/:txid` | The provenance of one transaction. |

## What is drawn

Every node is an object the chain knows:

- the prevouts the transaction spends, on the left;
- the transaction itself, in the middle, marked pending or confirmed;
- each output it creates, with **spent** or **unspent** taken from the
  chain's own outspend data, not inferred;
- the transaction that spent a spent output, on the right, when one has.

Every edge carries its exact value in sats. Two further kinds of edge appear
when the node actually reported them:

- **replacement**: a transaction and the version it superseded, from the
  node's replacement history. A dashed edge: a different version of intent,
  not a value flow.
- **package**: relatives of an unconfirmed transaction, from the cluster
  engine. Also dashed: they share a package, nothing more.

No address is merged with another address. No ownership is inferred. Two
outputs going to the same address stay two outputs, because the chain says
nothing about who owns either.

## What the notes say

A missing extra is not a missing graph. When replacement history or package
data did not answer, the value flow still draws, and a note above it names
exactly what did not. When a transaction has more prevouts than the drawing
holds, the graph states how far it went and where the full list lives. A
reader always knows whether they are seeing everything.

## The same facts, three ways

1. **The drawing**, for orientation. Nodes are keyboard focusable, each one
   a link to its transaction or outpoint page, each labelled in words as
   well as position.
2. **Two tables**: one row per object, one row per relationship. The tables
   carry precisely what the drawing carries, for anyone who reads tables,
   uses a screen reader, or wants to check the drawing against the data.
3. **Exports**: the edge list as CSV, the whole graph as versioned JSON.

The layout is deterministic: the same data always draws the same picture,
in the same places, so a returning reader is never re-learning the map.

## What this product never does

- It never draws an edge the chain or the node did not report.
- It never merges addresses into entities or infers common ownership.
- It never shows a partial graph as if it were complete; boundaries are
  stated in notes on the page.
- It never lets the drawing carry information the table does not.
