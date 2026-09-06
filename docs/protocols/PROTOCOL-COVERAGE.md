# Protocol coverage

The roster is owned by `bitcoinuniverseio/backend-apis`, in
`src/universe-explorer/registry/explorer-protocol-registry.ts`, and served by
`/api/v1/universe/protocols`. This file and `PROTOCOL-COVERAGE.json` are the
copy this repository pins. Do not edit rows by hand: record a new manifest with

```
node scripts/universe/protocol-contract.mjs --record --from <manifest url or file>
```

`node scripts/universe/protocol-contract.mjs --check` holds this repository's
own surfaces to the pinned roster, and
`node scripts/universe/protocol-contract.mjs --against <origin>` fails when a
deployment serves a roster that differs from it.

Release status semantics: every protocol starts BLOCKED and is upgraded only when
its explorer integration is completed and verified against its Universe authority.
A protocol never silently disappears from this table: `PROTOCOL-ROSTER.lock`
records every id that has been published, and the gate fails when one of them
stops appearing.

Pinned from bitcoinuniverseio/backend-apis at commit 04ff6efd3ea2dd841742ecf48932f0b10a8b5dd0,
manifest schema universe-explorer-protocol-manifest-v1, registry version 1.1.0,
recorded 2026-09-05T22:45:43.323Z.

39 protocol identities are retained. 7 carry historical readable declarations; these are not current runtime or E2E passes. Operation descriptors identify implemented public reads and their owned authority routes; configuration and acceptance are separate. The registry is not the complete application operation inventory.

| id | family | chain | authority | historical declaration | coverage | implemented reads |
|---|---|---|---|---|---|---|
| ordinals | ORDINALS | bitcoin | ord | VERIFIED READ ONLY | complete | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, inscription, block-inscriptions |
| rare_sats | ORDINALS | bitcoin | ord | VERIFIED READ ONLY | complete | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, sat |
| names | ORDINALS | bitcoin | index-names | BLOCKED | unknown | registry, objects |
| bitmap | ORDINALS | bitcoin | index-bitmap | BLOCKED | unknown | registry, objects |
| unat | ORDINALS | bitcoin | index-unat | BLOCKED | unknown | registry, objects |
| runes | RUNES | bitcoin | ord | VERIFIED READ ONLY | complete | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, rune |
| alkanes | ALKANES | bitcoin | index-alkanes | BLOCKED | unknown | registry, activity |
| mezcal | ALKANES | bitcoin | index-mezcal | BLOCKED | unknown | registry, activity |
| stamps | STAMPS | bitcoin | index-stamps | BLOCKED | unknown | registry, activity |
| src20 | STAMPS | bitcoin | index-stamps | BLOCKED | unknown | registry, activity |
| src101 | STAMPS | bitcoin | index-stamps | BLOCKED | unknown | registry, activity |
| atomicals_nft | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown | registry, activity, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings |
| realms | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown | registry, activity, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings |
| subrealms | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings |
| arc20 | ATOMICALS | bitcoin | index-atomicals | BLOCKED | unknown | registry, activity |
| op_return | OP DATA | bitcoin | index-op20 | BLOCKED | unknown | registry, activity |
| op_names | OP DATA | bitcoin | index-op20 | BLOCKED | unknown | registry, activity |
| op_inscriptions | OP DATA | bitcoin | index-opinscriptions | VERIFIED READ ONLY | complete | registry, objects |
| op_drop | OP DATA | bitcoin | index-drops-and-opdrop | BLOCKED | unknown | registry, activity |
| drops | OP DATA | bitcoin | index-drops-and-opdrop | BLOCKED | unknown | registry, activity |
| brc20 | OTHER | bitcoin | index-brc20 | BLOCKED | unknown | registry, activity |
| tap | OTHER | bitcoin | index-tap | BLOCKED | unknown | registry, activity |
| dmt | OTHER | bitcoin | index-dmt | BLOCKED | unknown | registry, activity |
| dust20 | OTHER | bitcoin | index-dust20 | BLOCKED | unknown | registry, activity |
| block20 | OTHER | bitcoin | index-block20 | BLOCKED | unknown | registry, activity |
| chainbloom | OTHER | bitcoin | index-chainbloom | BLOCKED | unknown | registry, objects |
| patina | OTHER | bitcoin | index-patina | BLOCKED | unknown | registry, objects |
| witness_circles | OTHER | bitcoin | index-witness-circles | BLOCKED | unknown | registry, objects |
| tandem | OTHER | bitcoin | index-tandem | BLOCKED | unknown | registry, objects |
| cat20 | OTHER | fractal | index-cat20 | BLOCKED | unknown | registry, activity |
| ordex | OTHER | bitcoin | index-ordinals | BLOCKED | unknown | registry |
| anima | OTHER | bitcoin | index-anima | BLOCKED | unknown | registry, status, transitions, transition, items, item, item-history |
| doginals | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown | registry, chain-list, chain-detail |
| drc20 | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown | registry, chain-list, chain-detail, holders |
| tap_doge | OTHER | dogecoin | index-doge-tap | BLOCKED | unknown | registry, activity |
| dunes | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown | registry, chain-list, chain-detail |
| zerdinals | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete | registry, chain-list, chain-detail |
| zrunes | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete | registry, chain-list, chain-detail |
| zrc20 | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete | registry, chain-list, chain-detail |
