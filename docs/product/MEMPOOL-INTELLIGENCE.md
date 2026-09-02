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
| `/tools/package` | The package simulator. Ask the node about a package you hold, without sending it. |
| `/tx/:txid/bump` | What it would cost to make an unconfirmed transaction confirm sooner. |

## API

| Route | Answers |
| --- | --- |
| `GET /api/v1/mempool/clusters` | Clusters, best fee rate first. `minTxCount=2` narrows to packages. |
| `GET /api/v1/mempool/clusters/:reference` | One cluster, by cluster id or by any member txid. |
| `GET /api/v1/mempool/feerate-diagram` | Both curves. |
| `GET /api/v1/mempool/packages/:txid` | The package around one transaction. |
| `POST /api/v1/mempool/simulate` | What this node would do with a package, given `{ "rawTxs": [...] }`. |
| `GET /api/v1/mempool/bump/:txid?targetFeerate=N` | Both routes to a higher fee rate, priced. |

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

## The package simulator

`testmempoolaccept` answers the question that matters: would this be accepted,
and if not, why not. What it gives back is a short string. It says
`insufficient fee` without saying how much is missing, `txn-mempool-conflict`
without saying which transaction is in the way, and nothing about the shape of
the package that produced either. Someone holding that string still cannot
act on it.

So the simulator carries the node's verdict through unchanged and adds
everything it leaves out:

- **Topology.** Which member spends which, ordered so every parent comes
  before its children. A set of transactions that spend each other in a loop
  is reported as one, because no node will relay that.
- **Conflicts.** The exact outpoint two transactions both want, the mempool
  transaction that already has it, and everything descended from that
  transaction, all of which leaves with it.
- **The replacement arithmetic.** What the package has to pay is everything it
  evicts plus the relay cost of its own size at this node's incremental rate,
  read from the node rather than assumed. The result is the exact shortfall in
  satoshis, not the observation that there is one.
- **Grouping.** The package run through the same linearizer the cluster pages
  use, so a package is described in the terms everything already in the
  mempool is described in.
- **Position.** How many virtual bytes of the current mempool pay better than
  the package's best group. A projection, labelled as one.

A fee the node did not report and this process cannot work out is unknown, not
zero. No group is claimed while any fee is missing, because a group's rate is
a sum and a sum with a hole in it is not a sum. No total is claimed either.

The route is the only one here that costs an RPC call, and the only one that
is not cached: a cached verdict on a replacement is a verdict about a conflict
that may already be gone. `/api/v1/capabilities` names Bitcoin Core as a
dependency of this route alone.

The simulator does not broadcast. Testing a package and sending one are
different actions, and it does only the first.

## The fee bump planner

There are two ways to make an unconfirmed transaction confirm sooner, and
which of them is open is not a matter of taste. `/tx/:txid/bump` prices both
against this node's own policy and says which is cheaper, or which is closed
and why.

**Replacing it.** The price is whichever is higher of two floors: the rate you
asked for, or everything the replacement evicts plus the relay cost of its own
size at the node's incremental rate. When the second floor is the binding one
the page says so, because asking for a lower rate would then not make it any
cheaper. A replacement always costs something even when the transaction
already pays the target, since it still has to beat the fee it removes.

The route is closed when no input signalled for replacement and this node does
not accept unsignalled ones. Both values are read from the node rather than
assumed: an incremental relay fee that is wrong makes every figure wrong by
exactly the amount that matters, and guessing the replacement setting would
open a route the node would refuse or close one it would take. On a node old
enough not to have the setting at all, its absence is read as off, because
that is what it meant on those releases.

**Attaching a child.** The price is what a child has to pay to lift the whole
unconfirmed group to the rate you asked for. The group is the transaction,
everything unconfirmed above it, and the child, because that is the set a
miner takes at one rate.

The child's size is worked out from the script it would spend, and only for
the four types where the type settles the spend. For a bare script hash, a
multisig or a raw pubkey it does not: the spend depends on a script the node
has not been shown, and a plausible size for it would be a number with nothing
behind it. That route is reported as closed with that reason rather than
priced on a guess. It is also closed when every output is already spent in the
mempool, and when the output a child would spend is worth less than the fee
that child would owe.

**Warnings** are facts, not advice. An output pushed below the dust line, a
child left with dust, and the transactions a replacement takes with it are
each stated with the number that makes them true. Nothing here says what to do
about them, because that depends on a wallet this page cannot see.

**Every output is listed for an asset check.** This process reads the base
chain only, so it cannot say which outputs carry an inscription, a rune or
anything else. Naming a subset would imply it can, so it names all of them and
links each to its outpoint page.

The planner builds nothing and signs nothing. It produces the numbers a wallet
needs and stops.

## Freshness

Three states, not two. Inside the budget, aged past the budget, and old
enough that nothing should be claimed at all. Collapsing the middle state
into either neighbour would misreport a real answer as either fresh or
absent.

## Cost

Every reading page is derived from the mempool this process already holds. No
such page makes an RPC call. A page that recomputed clusters from `getrawmempool`
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
