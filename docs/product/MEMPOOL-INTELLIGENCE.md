# Mempool intelligence

The unit a miner actually chooses from is not a transaction. It is a group of
them. These pages show that group.

## The promise

**See the mempool the way the mining code sees it: clusters, the groups
inside them, and the fee rate curve that ordering actually produces.**

## Routes

| Route | Purpose |
| --- | --- |
| `/mempool/clusters` | Clusters in the mempool, best fee rate first. |
| `/mempool/clusters/:clusterId` | One cluster in full, as a graph and as a table. |
| `/mempool/packages` | The clusters that are packages, meaning more than one transaction. |
| `/mempool/feerate-diagram` | The cumulative fee rate curve, against the curve a naive ordering would draw. |
| `/tx/:txid/package` | The package around one transaction. |

## API

| Route | Answers |
| --- | --- |
| `GET /api/v1/mempool/clusters` | Clusters, best fee rate first. `minTxCount=2` narrows to packages. |
| `GET /api/v1/mempool/clusters/:reference` | One cluster, by cluster id or by any member txid. |
| `GET /api/v1/mempool/feerate-diagram` | Both curves. |
| `GET /api/v1/mempool/packages/:txid` | The package around one transaction. |

`/api/v1/capabilities` carries a `mempoolIntelligence` entry. A deployment
with the mempool switched off reports `disabled`; one where the routes were
never mounted reports `unavailable` with the reason, rather than answering
with an empty mempool, which is the same shape as a quiet mempool and cannot
be told apart from one.

## What the pages show

### Clusters and their groups

A cluster is a set of mempool transactions connected by unconfirmed spends.
Within it, the linearization is the ancestor set algorithm a node's mining
code uses, so a group here is a group a node would take together.

Every cluster page carries ancestors and descendants, edges, group
boundaries, individual and effective fee rates, fees, weight and virtual
size, unconfirmed inputs, and each member's position.

Fee rates are compared by cross multiplication rather than by division. Two
groups whose rates differ past the precision of a double still order the same
way on every run, which a division would not guarantee. The tests assert that
group rates never rise through a cluster, which is the property the whole
diagram rests on.

### The fee rate diagram

Two curves. The real one is what the ordering above produces. The naive one
orders by each transaction's own fee rate, which puts a rich child above its
unconfirmed parent and describes a block no miner can build.

Drawn together, the gap between them is the claim that naive ordering makes
and cannot keep. That gap is the point of the page.

## Freshness

Three states, not two. Inside the budget, aged past the budget, and old
enough that nothing should be claimed at all. Collapsing the middle state
into either neighbour would misreport a real answer as either fresh or
absent.

## Cost

Everything is derived from the mempool this process already holds. No page
here makes an RPC call. A page that recomputed clusters from `getrawmempool`
would take a share of the shared RPC budget away from indexers that have no
other source for it.

## Accessibility

Every graph has a table beside it carrying the same numbers, not a reduced
fallback. The cluster graph marks a group boundary with a dash as well as a
colour, and the two diagram curves differ in dash pattern, so neither reads
by colour alone. Wide tables and both charts scroll inside their own boxes.
The diagram table is capped and states how many groups it left out.

## What it does not claim

A position in a projected template is a projection. Nothing on these pages
says a transaction will confirm in a given block, because nothing can.
