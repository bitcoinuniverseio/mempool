# Indexer block events contract (`universe-block-events-v1`)

The bounded read every protocol indexer exposes so the Universe Protocol
Overlay can show one block's protocol activity. It reads the indexer's
existing canonical tables. It never scans the chain, never triggers indexing,
and never returns anything the indexer has not already applied.

## Route

```
GET /v1/explorer/blocks/{height}/events?limit={1..500}&cursor={opaque}
```

- `height`: unsigned decimal, at most 10 digits. Anything else is `400`.
- `limit`: default `200`, maximum `500`. Out of range is `400`.
- `cursor`: opaque string returned by the previous page. A cursor this
  indexer did not issue is `400`.
- `503` when the indexer is not ready to answer (same rule as its readiness
  route). Never a `200` with an empty list in that case.

## Response `200`

```json
{
  "schemaVersion": "universe-block-events-v1",
  "chain": "bitcoin",
  "network": "mainnet",
  "protocols": ["brc20"],
  "height": "840000",
  "blockHash": "<64 lowercase hex> | null",
  "indexed": true,
  "checkpoint": { "height": "840100", "hash": "<64 lowercase hex>" },
  "events": [
    {
      "eventId": "<unique and stable within this authority>",
      "protocolId": "brc20",
      "txid": "<64 lowercase hex>",
      "txIndex": 12,
      "operation": "transfer",
      "assetId": "ordi",
      "ticker": "ordi",
      "displayName": null,
      "assetKind": "fungible",
      "amountAtomic": "1000",
      "decimals": 18,
      "fromAddress": null,
      "toAddress": null,
      "inputOutpoint": null,
      "outputOutpoint": null,
      "inscriptionId": null
    }
  ],
  "nextCursor": null,
  "complete": true
}
```

Field rules:

- `protocols`: every protocol id this authority answers for at this height,
  including those with no events. An empty event list for a listed protocol
  is a statement that it had no applied events in this block.
- `blockHash`: the hash the indexer itself recorded for `height`. `null` only
  when the indexer does not store per-height hashes; the overlay then cannot
  bind the answer to a branch and marks it partial.
- `indexed`: `false` when the indexer's checkpoint is below `height`. Then
  `events` is `[]`, `nextCursor` is `null` and `complete` is `false`.
- `checkpoint`: the indexer's current tip, the same values its
  `/v1/checkpoint` (or status) route reports.
- `complete`: `true` only when `indexed` is true, this is the last page, and
  the list is every applied event the indexer holds for this height.
- `events` are ordered by transaction position in the block, then by the
  order the indexer applied them. `txIndex` is `null` when not stored.
- `operation` uses the shared vocabulary: `deploy`, `mint`, `transfer`,
  `burn`, `etch`, `inscribe`, `register`, `update`, `lock`, `unlock`,
  `consume`, `unknown`. Map protocol-specific names onto it; use `unknown`
  rather than guessing.
- Only events the indexer **applied** on its **canonical** branch are
  returned. Rejected, invalid, reverted or orphaned operations are never
  returned: a payload is not proof of a state transition.
- Amounts are decimal strings (`amountAtomic`, atomic units), never JSON
  numbers. `decimals` is the asset's divisibility when the protocol defines
  one, else `null`.
- Addresses and outpoints are filled only when the indexer recorded them.
  Never derive a sender or recipient that the indexer did not store.
- `assetKind`: `fungible`, `non-fungible`, `inscription`, `name`, `data` or
  `protocol-event`.
