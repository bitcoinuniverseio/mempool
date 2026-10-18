# Explorer authority read contract (`universe-explorer-authority-read-v1`)

The read every Bitcoin protocol authority (index-names, index-bitmap,
index-brc20, index-tap, index-dmt, index-unat, index-dust20, index-block20)
serves so the Universe Protocol Overlay can show the complete protocol
inventory of a transaction, a block and an address.

It extends [`universe-block-events-v1`](BLOCK-EVENTS-V1.md). Every v1 field
and rule still holds; the additions below are optional for a v1 consumer and
required for a v1 producer that claims this contract in `/v1/checkpoint`.

The authority reads its own accepted store only. It never scans the chain,
never triggers indexing, never calls a third-party API and never returns
anything it has not applied on its own branch.

## Common rules

- Authentication: the same bearer token the authority already requires for
  its existing explorer/feed reads (`requireBearer`). No new credential.
- `503` with the authority's readiness body while it is not ready. Never a
  `200` with an empty list in that case.
- `400 { "error": "wrong_network" }` when an address or id belongs to another
  network than the one the authority is configured for.
- `409 { "error": "cursor_stale" }` when a cursor was issued for another
  checkpoint (hash or generation). The overlay then restarts from page one.
  A cursor this authority did not issue is `400`.
- `limit`: default `200`, maximum `500`.
- Every `200` body carries `chain`, `network`, `signetChallenge` (lowercase
  hex of the configured Signet challenge, `null` on any other network) and a
  `checkpoint`:

  ```json
  { "height": "840100", "hash": "<64 lowercase hex>", "generation": "17" }
  ```

  `generation` is this authority's own publication/reorg counter as a decimal
  string, `null` when it keeps none. It is source-local: the overlay compares
  it only with earlier answers from the same authority.
- Quantities are decimal strings of atomic units. Never JSON numbers, never
  floats, never rounded.

## 1. Block and transaction events

```
GET /v1/explorer/blocks/{height}/events?limit=&cursor=&txid=
```

`txid` (optional, 64 lowercase hex) restricts the answer to the events of one
transaction in that block. `complete` then means "every applied event of this
transaction". The overlay uses it for the transaction view.

Additional event fields:

| Field | Type | Meaning |
|---|---|---|
| `subprotocolId` | string or null | The classification inside the protocol (table below). |
| `unit` | string | What `amountAtomic` counts (table below). |
| `scope` | `transaction` or `block` | `block` for protocol-defined block effects with no operation of their own (TAP/DMT miner rewards, BRC-20 module refunds). Those use the coinbase `txid` and `txIndex: 0`. |
| `balanceEffect` | string or null | `credit`, `debit`, `reserve`, `release`, `burn` or `null`. `reserve`/`release` move an amount between available and transferable inside one address; they never change its overall balance. |
| `fromScript` / `toScript` | string or null | Lowercase hex output script when no display address exists. |

Optional page field `checkpoint.generation` as above.

## 2. Address holdings

```
GET /v1/explorer/addresses/{address}/holdings?limit=&cursor=
```

The address's current holdings at the authority's checkpoint, every asset of
every protocol this authority serves, including balances bound to the address
rather than to any output.

```json
{
  "schemaVersion": "universe-explorer-address-holdings-v1",
  "chain": "bitcoin",
  "network": "signet",
  "signetChallenge": "<hex> | null",
  "address": "<as requested>",
  "protocols": ["brc20"],
  "checkpoint": { "height": "230100", "hash": "<hex>", "generation": "4" },
  "holdings": [
    {
      "protocolId": "brc20",
      "subprotocolId": "brc20-token",
      "assetId": "ordi",
      "assetKind": "fungible",
      "ticker": "ordi",
      "displayName": null,
      "decimals": 18,
      "unit": "token-atomic",
      "overallAtomic": "1000000000000000000000",
      "availableAtomic": "900000000000000000000",
      "reservedAtomic": "100000000000000000000",
      "inscriptionId": null,
      "outpoint": null,
      "semantics": "brc20-address-ledger"
    }
  ],
  "nextCursor": null,
  "complete": true
}
```

Rules:

- Ordered by `(protocolId, subprotocolId, assetId, inscriptionId)`; keyset
  cursor bound to `checkpoint.hash` and `checkpoint.generation`.
- `overallAtomic` is the address's whole balance. `availableAtomic` and
  `reservedAtomic` are its two parts when the protocol has transferable
  reservations (BRC-20, TAP, BLOCK20), else `null`. They are never added to
  `overallAtomic`.
- Unique assets (a name, a district, a UNAT, an inscription a protocol
  classifies) are one holding each with `overallAtomic: "1"` and
  `inscriptionId` / `outpoint` set to their current location.
- Zero balances are not listed. An empty `holdings` list with
  `complete: true` is the authority's statement that the address holds none
  of its assets at the checkpoint; `complete: false` never is.
- A protocol the authority cannot answer completely for (a profile it has
  not activated, a backfill still running) is left out of `protocols`. The
  overlay then reports that protocol as unavailable rather than empty.

## Classification table

| protocolId | subprotocolId | assetKind | unit | Notes |
|---|---|---|---|---|
| `names` | `sns-name`, `sns-namespace` | `name` | `name` | First accepted claim only. |
| `bitmap` | `district`, `parcel` | `non-fungible` | `district`, `parcel` | A parcel needs its own accepted inscription. |
| `brc20` | `brc20-token`, `brc20-self-mint`, `brc20-module` | `fungible` | `token-atomic` | Deployment precision in `decimals`. |
| `tap` | `tap-token`, `tap-dmt` | `fungible` | `token-atomic` | Excess fractional input digits truncated by the TAP rule. |
| `dmt` | `dmt-element`, `dmt-deployment`, `nat` | `fungible` / `non-fungible` | `token-atomic`, `inscription` | NAT miner rewards are `scope: "block"`. |
| `unat` | `unat` | `non-fungible` | `inscription` | Independent of any NAT balance. |
| `dust20` | `dust20-token` | `fungible` | `token-atomic` | Follows colored sat groups through every spend. |
| `block20` | `block20-token` | `fungible` | `token-atomic` | Anchor/window rules of the pinned profile. |

Ord-native identities (`ordinals`, `rare_sats`) are read from owned Ord by
the overlay and are not part of this contract.

## 3. Inscription classification

```
GET /v1/explorer/inscriptions?ids=<id>,<id>,...
```

For authorities whose assets are inscriptions (Names, Bitmap, UNAT, DMT
elements and deployments). At most 100 ids, each `<txid>i<index>`. The
overlay finds which inscriptions a transaction moved from owned Ord and asks
here which of them are this authority's accepted assets, so an ordinary
transfer of a name, district or UNAT is shown without the authority having to
record transfers itself.

```json
{
  "schemaVersion": "universe-explorer-inscription-classes-v1",
  "chain": "bitcoin",
  "network": "signet",
  "signetChallenge": "<hex> | null",
  "protocols": ["names"],
  "checkpoint": { "height": "230100", "hash": "<hex>", "generation": "4" },
  "items": [
    {
      "inscriptionId": "<txid>i0",
      "protocolId": "names",
      "subprotocolId": "sns-name",
      "assetId": "satoshi.sats",
      "assetKind": "name",
      "unit": "name",
      "displayName": "satoshi.sats"
    }
  ],
  "complete": true
}
```

An id absent from `items` is not an accepted asset of this authority at the
checkpoint (rejected duplicate claims are absent). `complete: false` when the
authority cannot answer for every requested id (for example a membership
range that does not start at the protocol start).
