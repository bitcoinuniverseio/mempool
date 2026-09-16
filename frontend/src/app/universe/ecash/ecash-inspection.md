# Offline ecash inspector scope

The inspector parses Cashu A (V3 JSON), Cashu B (V4 definite-length CBOR), and Fedimint `fed11` Bech32/Bech32m or `fedimint` little-bit-order base32 consensus invites locally. It performs no HTTP requests, persistence, mint redemption, or guardian connection. Inputs are limited to64KiB; Cashu depth16,4096items,1024proofs; Fedimint128parts. Unsupported representations fail without a result. Clear/edit/destroy discard displayed results; destruction clears the input.

Cashu checks required fields, positive bounded amounts, encoded keyset IDs and valid secp256k1 points. V4 integer quantities and sums use BigInt decimal strings. It does not verify mint signatures, DLEQ, witnesses, resolve short keyset IDs, or establish unspent status. Amounts are declared quantities, not spendable balances. Secrets are excluded from returned summaries; URL credentials/query/fragments are removed. Multiple V3 mint groups are preserved.

Fedimint checks checksums where present, canonical BigSize lengths, exact end-of-input, required federation ID/API endpoint, unique peer IDs, bounded UTF8 URL fields, and optional API-secret omission from output. Included peer count is not total guardian count. Unknown bounded extension fields are counted and skipped. Configuration authentication and federation state require separate authoritative evidence.

## Pinned primary references and fixtures

- [Cashu NUT00](https://github.com/cashubtc/nuts/blob/58f2d244803c5e81fb37a8a3ed7fbe699ddcadb4/00.md): official V3 example has2proofs totaling10sat; V4 example3proofs totaling4sat. `ecash-reference-fixtures.ts` copies those public non-funding examples.
- [Fedimint native invite code](https://github.com/fedimint/fedimint/blob/3b471f592e896c39f50177c5919ae65108ffd1ac/fedimint-core/src/invite_code.rs): native test vector expects federation `bea7ff4116f2b1d324c7b5d699cce4ac7408cee41db2c88027e21b76fff3b9f4`, one peer at `wss://fedimintd.mplsfed.foo/`.
- [Consensus numeric/string encoding](https://github.com/fedimint/fedimint/blob/e5de721dea27c702e7f7105516b8ebc7fa31a4ed/fedimint-core/src/encoding/mod.rs) and [derived enum encoding](https://github.com/fedimint/fedimint/blob/94c7ddb123e60098631136c550bbb057edec8f1f/fedimint-derive/src/lib.rs).
- [Fedimint base32 encoding](https://github.com/fedimint/fedimint/blob/32b31bb0014f494959492fd705c6c4cc033723e6/fedimint-core/src/base32.rs).

Regression tests compare these independent public vectors, reject malformed/trailing/duplicate/oversized inputs and invalid curve points, verify optional-secret redaction, and exercise component stale clearing without network calls. Full native wallet interoperability and live spendability are not established by these tests.
