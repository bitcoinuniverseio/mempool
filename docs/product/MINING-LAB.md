# Mining and consensus lab

How blocks get built, and what it looks like when they stop going to plan.

## The promise

**Measure the mining the deployment actually sees, state the window and the
method next to every number, and never explain a pool's private choices
beyond what the chain shows.**

## Routes

| Route | Purpose |
| --- | --- |
| `/labs/mining` | The lab's front door. |
| `/labs/mining/bitcoin` | Bitcoin block intervals, empty blocks, pool shares. |
| `/labs/mining/dogecoin` | The AuxPoW proof viewer, Dogecoin intervals and empties. |
| `/labs/mining/reorgs` | Displacements this node observed. |

## The Bitcoin module

Thirty recent blocks, and every statistic names that window:

- **intervals** against the ten minute target: mean with its drift, median,
  fastest, slowest, and the heights of blocks slower than twice the target;
- **empty blocks**: how many carried nothing but their subsidy, with the
  heights listed. An empty block is a miner's choice; the page counts them
  and explains nothing further;
- **pool shares** in the window, with unknown attribution kept visible as
  unknown rather than folded into a leader.

## The Dogecoin module and the AuxPoW viewer

Merge mined Dogecoin carries its proof of work inside the block. The viewer
takes a raw block in hexadecimal and works entirely in this browser:

- the Dogecoin header hash and the parent chain header hash, derived the
  way the chains derive them, so the parent linkage is shown as computed
  fact;
- the parent coinbase transaction, its hash, and the readable text inside
  its script;
- the chain merkle branch and chain index;
- **the commitment check**: the coinbase's two pushed hashes must XOR to
  the Dogecoin header hash. A verified block states it; a mismatch is a
  mismatch, stated; an absent commitment is reported as absent.

Attribution stops at the readable text, shown as text and claimed as
nothing more. The page does not validate parent chain signatures, and says
so rather than implying it.

Alongside the viewer: block intervals against the one minute DigiShield
target, and the empty block share, with the window stated.

## The reorg module

The stale tips this node observed: each stale block paired with the block
that displaced it, the height, and the moment. A quiet list says what one
witness saw, and the page states exactly that: one node's observations are
not the chain's whole history. When the tips source does not answer, the
page says so instead of showing a silence that could be misread.

## What this lab never does

- It never presents a sample statistic as a claim about the network.
- It never attributes a pool beyond what the chain and the pool's own
  published text show.
- It never lets a quiet source wear the costume of a clean record.
- It never sends pasted raw blocks anywhere; the AuxPoW viewer is browser
  only.
