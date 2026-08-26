# Asset evidence model

The explorer never states a protocol fact without authoritative evidence. This
document defines the shared evidence shapes served by the Universe Protocol
Overlay (implemented in `backend-apis`, `src/universe-explorer/contracts/`).

## Principles

- Amounts, heights, ordinal numbers, and supplies are decimal strings
  end-to-end. Unsafe JavaScript numbers are never used for atomic quantities.
- A transaction id alone is never a protocol event key. Events use the
  deterministic identity `chain:network:protocol:txid:event-index:sub-index`,
  which supports several protocol actions in one transaction.
- Every protocol claim carries `ExplorerSourceEvidence`: the authority id, its
  release SHA, its schema version, its coverage class, whether it can prove
  absence (`negativeCompleteness`), and the exact checkpoint the evidence was
  read at.
- Missing data is never rendered as zero. "No supported assets" appears only
  when the responsible authority reports a complete negative proof at the same
  checkpoint. Otherwise the UI states: evidence incomplete, enrichment
  pending, source not synchronized, or unknown attachments may exist.
- Buyer/seller/trade language never appears without marketplace settlement
  evidence. Default actor language is input address / output address, with
  sender/recipient only when the authority proves it.

## Coverage classes

| Class | Meaning |
| --- | --- |
| complete | Authority proves all applicable events and positions through the checkpoint, including truthful empty results |
| partial | Positive findings proven; absence not provable |
| positive-only | Known assets reported; no negative completeness guarantee |
| demand-populated | Source contains only previously queried or observed objects |
| unknown | Source cannot currently support a reliable claim |

A protocol card showing zero activity must not imply complete absence unless
`negativeCompleteness = true`.

## Shapes

The authoritative TypeScript definitions live in
`backend-apis/src/universe-explorer/contracts/explorer-evidence.ts`:

- `ExplorerCheckpoint` - chain, network, heightAtomic, blockHash, reorgEpoch, observedAt
- `ExplorerSourceEvidence` - authorityId, protocolId, releaseSha, schemaVersion, coverage, negativeCompleteness, checkpoint, checkedAt
- `ExplorerAssetRef` - protocolId, canonicalAssetId, displayName?, ticker?, collectionId?, contentId?, assetKind
- `ExplorerOutpointPosition` - outpoint, vout, valueSatsAtomic, asset, quantityAtomic?, satRanges?, notableSats?, notableSatsTruncated?, positionOffsetAtomic?, ownerAddress?, state, evidence
- `ExplorerNotableSat` - satAtomic, rarity, heightAtomic
- `ExplorerProtocolAction` - eventId, protocolId, actionType, asset?, quantityAtomic?, inputOutpoints?, outputOutpoints?, evidence
- `ExplorerTransactionAssetFlow` - schemaVersion, chain, network, txid, status, checkpoint?, coinbase, inputs, outputs, actions, sourceEvidence, complete, unknownAttachmentCount, outOfCoverageCount

## Protocol semantics

Protocols are not forced into a uniform transfer model:

- Ordinals: a specific inscription or sat moved to an output (sat-range proven)
- Rare sats: satoshis whose Rodarmor rarity is above common (see below)
- RUNES: exact atomic quantity allocated to outputs
- BRC-20: protocol operation plus the indexed resulting balance state
- OP_RETURN: a data event, not an asset transfer unless its protocol defines one
- Name protocols: registration or update
- Deploy or etch: a new protocol asset created
- Burn: shown only with exact authority-proven destruction
- Unknown: unclassified or incomplete evidence, surfaced as such

## Known coverage limits

**Spent input outpoints.** The deployed Ord authority prunes its outpoint
inventory when an output is spent: `/output/:outpoint` answers `indexed:
false` for a spent outpoint even when that outpoint carried inscriptions or
rune balances while it was live. The explorer therefore cannot prove the
protocol contents of a spent input from this authority alone.

Behaviour: such inputs produce no fabricated positions. They are counted in
`outOfCoverageCount`, kept apart from `unknownAttachmentCount` so a coverage
boundary can be told from an authority that failed to answer. Both leave the
flow `complete: false`, because an authority that discarded its inventory
cannot prove the outpoint carried nothing.

The interface reads the two counters together. When the only unproven
outpoints are out of coverage the section says the outputs are proven and the
inputs are no longer retained by the authority. When any outpoint failed to
resolve, that is the more serious fact and it wins: the section reports
unresolved outpoints instead. A transaction whose outputs are fully proven and
whose inputs are unprovable never reads as "no assets on the inputs".

Closing this gap requires an authority that retains historical output
inventory: either an Ord deployment configured to keep spent-output data, or
a bounded read endpoint over an indexer that already stores per-outpoint
positions historically. Until then the limit is stated rather than hidden.

## Rare sats are derived, not asserted

Every Bitcoin output holds satoshis, so the sat ranges an Ord index reports for
an output are not by themselves an asset. A `rare_sats` position is emitted
only for satoshis whose Rodarmor rarity is above common:

| Rarity | Rule |
| --- | --- |
| mythic | the first satoshi of the genesis block |
| legendary | the first satoshi of a cycle (every 1,260,000 blocks) |
| epic | the first satoshi of a halving epoch (every 210,000 blocks) |
| rare | the first satoshi of a difficulty period (every 2,016 blocks) |
| uncommon | the first satoshi of every other block |
| common | every other satoshi |

Rarity is a pure function of the ordinal number, so it is computed from the
authority's exact sat ranges rather than requested from any service
(`backend-apis/src/universe-explorer/outpoints/sat-rarity.ts`). Because only
the first satoshi of a block can be anything but common, a range is scanned by
block boundary; the work is proportional to the blocks a range spans, not to
the satoshis it holds. The evidence attached to the position is the sat index
evidence the ranges came from: a derivation over exact input is exact.

An output with sat ranges and no notable satoshi produces no position at all,
and the sat index proves that negative. This is what makes "No supported
assets detected on this transaction" a meaningful statement rather than one
that never appears.

Positions carry `notableSats` (each with its ordinal number, rarity, and the
block that minted it) instead of the raw ranges. A single coinbase output can
span thousands of ranges, none of which a reader can use; the notable
satoshis are the finding. `notableSatsTruncated` marks the rare case where an
output holds more notable satoshis than the scan limit returns.

## Checkpoint bracketing

Confirmed evidence reads follow the bracket procedure: read source checkpoint,
fetch evidence, read source checkpoint again, require identical height and
block hash, reject mixed-checkpoint results. See CHECKPOINTS-AND-REORGS.md.
