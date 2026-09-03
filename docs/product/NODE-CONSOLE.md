# Node console

The node this explorer runs on, described in public, read only terms.

## The promise

**Show what this deployment's node actually is, and make every method it will
not run be a method it cannot run.**

A public page that can reach a node's RPC is one accident away from being a
control panel. The interesting part of this product is not what it shows. It
is the shape of the path between a request and the node, and why nothing
sensitive can fit through it.

## Routes

| Route | Purpose |
| --- | --- |
| `/node` | The overview: chain, indexes, mempool policy, network, peers. |
| `/node/rpc` | The method catalog, and a form for calling one. |

| API | Purpose |
| --- | --- |
| `GET /api/v1/node/overview` | The overview, section by section. |
| `GET /api/v1/node/rpc/catalog` | The only methods this route will call. |
| `POST /api/v1/node/rpc` | Call one catalogued method with checked arguments. |

## Why an allowlist, and never a denylist

`rpc-allowlist.ts` holds the complete set of node methods the public route can
reach. A method absent from that file has no path to a call: the only way a
name from a request becomes a call is by matching an entry there and then
being invoked through the entry's own recorded client method. No request
string is ever interpolated into a method name.

The alternative, a denylist, has the opposite property. Every method Bitcoin
Core adds in future would be reachable until somebody remembered to forbid
it. Here, the future methods are unreachable by default, and adding one is a
one line change a reviewer sees.

The catalogue endpoint is the allowlist itself, so a reader can verify the
boundary from the outside rather than trusting a description of it.

## Two classes of read only method are still excluded

Read only is not the test. These two classes stay out:

1. **Methods that describe the process rather than the chain.** `getrpcinfo`
   names the log path and the commands in flight. `getmemoryinfo` describes
   the allocator. Neither says anything about Bitcoin and both say something
   about this host.
2. **Methods whose cost is unbounded.** `gettxoutsetinfo` walks the entire
   UTXO set. A public route that can be made to do that on demand is a way to
   stop the node. `scantxoutset`, `scanblocks` and `getrawmempool` fail the
   same test at scale.

A separate list of forbidden names (`stop`, wallet and key methods,
`sendrawtransaction`, mining control, and more) is held in the source next to
the allowlist, and the build fails its own check if one of those names ever
appears on the list. Broadcasting exists deliberately in the transaction
workbench; it does not exist here.

## What is trimmed before an answer leaves

Two answers are redacted, each next to its stated reason in the response:

| Method | Removed | Why |
| --- | --- | --- |
| `getnetworkinfo` | `localaddresses`, the node's own reachable addresses | On a node behind a tunnel they are exactly what the tunnel exists to keep private. |
| `getpeerinfo` | Every field that says where a peer is (`addr`, `addrbind`, `addrlocal`, `mapped_as` and kin) | Peer addresses are this node's topology rather than a fact about Bitcoin, and publishing them hands an attacker the list of peers to go after. |

What a peer *does* survives intact: direction, network, age, version, service
flags, relay behaviour. The overview's peer counts are computed from peers
whose addresses were removed before any code read them, so there is no point
in the pipeline where an address exists to be leaked by a later change.

## The rate budget

Each method may be called **30 times per minute** from the public route, with
a per method budget rather than one shared pool, so a loop over one expensive
method cannot consume the node's RPC capacity that every indexer on the host
shares. The budget is deliberately in memory and per process: it exists to
stop a page or a script from making the node's RPC budget its own, not to
stop a determined attacker. The overview endpoint is cached for ten seconds;
the catalog for an hour; answers to methods marked immutable for an hour,
with everything else `no-store`.

## What an argument can be

Every argument is checked against the specification recorded for its
position: shape, range, and count ceilings. Arguments past the last declared
parameter are refused rather than silently dropped, because a caller whose
fourth argument went nowhere has been told their request was understood when
it was not. A method that exists in Core but is not allowed and a method that
does not exist at all get the same refusal, so the route cannot be used to
enumerate the node's build.

## Honest sections

The overview is five independent sections. A node that answers about its
chain but not its peers produces a page with the chain on it and a stated
reason where the peers would have been. It never produces a peer count of
zero, an error page, or a blank panel: unavailable is stated as unavailable,
with what the node said.

## Routes from the original brief that are not built

`/node/capabilities`, `/node/peers` and `/node/relay` are specified in the
product brief and deliberately absent:

- **`/node/capabilities`** needs first-party, multi-vantage capability
  evidence this deployment does not produce yet. The overview carries the
  directly observable facts (versions, IBD, indexes, relay policy) without
  the claims that would need the missing evidence.
- **`/node/peers`** as a full page duplicates what the overview already
  reports about the peer set, minus the addresses this product will not
  publish. It exists in the overview rather than as its own route.
- **`/node/relay`** needs first-seen propagation observations across several
  first-party vantage points. One node is one observation point, and one
  observation point cannot honestly be called a relay map.

None of the three is shipped as an empty shell. They arrive when the
first-party data that would make them true arrives.

## What this product never does

- No write, sign, wallet, mining-control or node-control method, ever.
- No RPC credential, private hostname, cookie path or internal topology in
  any response.
- No broadcast. The transaction workbench does that deliberately; this
  surface reads.
- No claim about nodes it cannot see. This console describes this
  deployment's node, and says so.
