# Bootstrap fixtures

`regtest-105.snapshot.base64` is the exact `dumptxoutset` output of an offline
Bitcoin Core 28.0 regtest node (no peers, no network) at height 105 with 107
coins covering P2WPKH, P2PKH, P2SH-P2WPKH, P2TR, compressed P2PK, uncompressed
P2PK, a raw OP_TRUE script and a three-output transaction. Core reported:

- base_hash `0be30936f2332969e5dd82fe06d0c4d8d25d86351442ec813c2f70aa132c2acb`, base_height 105
- coins_written 107
- `gettxoutsetinfo hash_serialized_3` = `2fff9d5b75bf5539b20a99cbae5639819995d0b560d2cfda171aafed870418fc`
- file sha256 `facbe9af2dede0a3322ec7b9c46328f4f86cfc4764cab11b90b3821104cceb7e` (6349 bytes)

The tests decode it with the streaming parser and must reproduce those values.
