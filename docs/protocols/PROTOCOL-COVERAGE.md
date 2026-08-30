# Protocol coverage

Generated from the explorer protocol registry in backend-apis
(src/universe-explorer/registry/explorer-protocol-registry.ts), as served by
`/api/v1/universe/protocols`. Do not edit rows by hand: regenerate with

```
node scripts/universe/generate-protocol-coverage.mjs --from <manifest url or file>
```

and verify with `node scripts/universe/generate-protocol-coverage.mjs --check`.

Release status semantics: every protocol starts BLOCKED and is upgraded only when
its explorer integration is completed and verified against its Universe authority.
A protocol never silently disappears from this table.

Registry version 1.0.0. 6 of 38 protocols are readable today; the rest are recorded here but not yet served.

| id | family | chain | authority | release status | coverage |
|---|---|---|---|---|---|
| ordinals | ORDINALS | bitcoin | ord | VERIFIED READ ONLY | complete |
| rare_sats | ORDINALS | bitcoin | ord | VERIFIED READ ONLY | complete |
| names | ORDINALS | bitcoin | index-names | BLOCKED | unknown |
| bitmap | ORDINALS | bitcoin | index-bitmap | BLOCKED | unknown |
| unat | ORDINALS | bitcoin | index-unat | BLOCKED | unknown |
| runes | RUNES | bitcoin | ord | VERIFIED READ ONLY | complete |
| alkanes | ALKANES | bitcoin | index-alkanes | BLOCKED | unknown |
| mezcal | ALKANES | bitcoin | index-mezcal | BLOCKED | unknown |
| stamps | STAMPS | bitcoin | index-stamps | BLOCKED | unknown |
| src20 | STAMPS | bitcoin | index-stamps | BLOCKED | unknown |
| src101 | STAMPS | bitcoin | index-stamps | BLOCKED | unknown |
| atomicals_nft | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown |
| realms | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown |
| subrealms | ATOMICALS | bitcoin | index-atomicals-nfts-and-realms | BLOCKED | unknown |
| arc20 | ATOMICALS | bitcoin | index-atomicals | BLOCKED | unknown |
| op_return | OP DATA | bitcoin | index-op20 | BLOCKED | unknown |
| op_names | OP DATA | bitcoin | index-op20 | BLOCKED | unknown |
| op_inscriptions | OP DATA | bitcoin | index-opinscriptions | BLOCKED | unknown |
| op_drop | OP DATA | bitcoin | index-drops-and-opdrop | BLOCKED | unknown |
| drops | OP DATA | bitcoin | index-drops-and-opdrop | BLOCKED | unknown |
| brc20 | OTHER | bitcoin | index-brc20 | BLOCKED | unknown |
| tap | OTHER | bitcoin | index-tap | BLOCKED | unknown |
| dmt | OTHER | bitcoin | index-dmt | BLOCKED | unknown |
| dust20 | OTHER | bitcoin | index-dust20 | BLOCKED | unknown |
| block20 | OTHER | bitcoin | index-block20 | BLOCKED | unknown |
| chainbloom | OTHER | bitcoin | index-chainbloom | BLOCKED | unknown |
| patina | OTHER | bitcoin | index-patina | BLOCKED | unknown |
| witness_circles | OTHER | bitcoin | index-witness-circles | BLOCKED | unknown |
| tandem | OTHER | bitcoin | index-tandem | BLOCKED | unknown |
| cat20 | OTHER | bitcoin | index-cat20 | BLOCKED | unknown |
| ordex | OTHER | bitcoin | index-ordinals | BLOCKED | unknown |
| doginals | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown |
| drc20 | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown |
| tap_doge | OTHER | dogecoin | index-doge-tap | BLOCKED | unknown |
| dunes | OTHER | dogecoin | ord-dogecoin | BLOCKED | unknown |
| zerdinals | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete |
| zrunes | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete |
| zrc20 | OTHER | zcash | index-zcash-metaprotocols | VERIFIED READ ONLY | complete |
