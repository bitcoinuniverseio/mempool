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
- `ExplorerOutpointPosition` - outpoint, vout, valueSatsAtomic, asset, quantityAtomic?, satRanges?, positionOffsetAtomic?, ownerAddress?, state, evidence
- `ExplorerProtocolAction` - eventId, protocolId, actionType, asset?, quantityAtomic?, inputOutpoints?, outputOutpoints?, evidence
- `ExplorerTransactionAssetFlow` - schemaVersion, chain, network, txid, status, checkpoint?, inputs, outputs, actions, sourceEvidence, complete, unknownAttachmentCount

## Protocol semantics

Protocols are not forced into a uniform transfer model:

- Ordinals: a specific inscription or sat moved to an output (sat-range proven)
- RUNES: exact atomic quantity allocated to outputs
- BRC-20: protocol operation plus the indexed resulting balance state
- OP_RETURN: a data event, not an asset transfer unless its protocol defines one
- Name protocols: registration or update
- Deploy or etch: a new protocol asset created
- Burn: shown only with exact authority-proven destruction
- Unknown: unclassified or incomplete evidence, surfaced as such

## Checkpoint bracketing

Confirmed evidence reads follow the bracket procedure: read source checkpoint,
fetch evidence, read source checkpoint again, require identical height and
block hash, reject mixed-checkpoint results. See CHECKPOINTS-AND-REORGS.md.
