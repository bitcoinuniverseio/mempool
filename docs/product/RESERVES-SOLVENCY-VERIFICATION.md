# Reserves and liability evidence

## Verified scope

The verifier separates mathematical inclusion, operator-pinned provider identity,
current reserve input ownership, and solvency. No implemented result establishes
complete liabilities, unencumbered assets or solvency. Unknown directory balances
and ratios display as unknown, not zero. The verifier runs on the backend.

### Liability inclusion

`POST /api/v1/intelligence/reserves/verify` accepts `proof_type: merkle_inclusion`
and a `merkle_proof` with:

- `scheme`: exactly `universe-liability-sha256-v1`.
- `leaf`: `account_id` (1–256 UTF-8 bytes), `nonce` (16–64 bytes, lowercase hex),
  and nonnegative integer `liability_sats` at most 2,100,000,000,000,000.
- `merkle_root`: 32-byte lowercase hex; `path`: at most 32 such sibling hashes;
  `index`: the leaf position, less than 2 raised to path length.

Leaf bytes are UTF-8 JSON of the array
`["universe-liability-sha256-v1", account_id, nonce, String(liability_sats)]`.
The leaf hash is SHA256(`0x00 || leaf_bytes`). Each parent is
SHA256(`0x01 || left_hash_bytes || right_hash_bytes`); index bits select sibling
orientation from the leaf upward. Hashes concatenate binary bytes, not their hex
text. This is an explicit liability commitment scheme, **not a Merkle-sum tree**.
An optional `leaf_hash` or `expected_liability_sats` must match the committed leaf.

`inclusion_verified` reports only the path calculation. `included_liability_sats`
is the amount in that included leaf, with root trust reported separately.
`verified`, `total_verified_sats` and `verified_items_count` remain false/zero
unless both inclusion and provider-root authentication succeed. Failed inclusion
always yields zero verified totals and counts. `solvency_verified` is false.

### Provider-root authentication

Only keys in the operator file `UNIVERSE_RESERVES_TRUST_STORE` establish trust:

```json
{"schema":"universe-reserves-trust-v1","providers":[{"provider_id":"provider-id","name":"Provider name","key_id":"key-id","public_key_pem":"Ed25519 public key PEM"}]}
```

The file is bounded to 256 KiB and 100 entries. No caller-supplied public key can
establish provider identity. Key selection and rotation require the operator to
verify the provider independently; this software cannot manufacture that trust.

An optional proof `attestation` contains `provider_id`, `key_id`, `network`,
`scheme`, `snapshot_id`, `merkle_root`, `total_liability_sats`, `issued_at`,
`expires_at`, and a 64-byte lowercase-hex Ed25519 `signature`. The signature covers
UTF-8 JSON of the fixed array:

```text
["universe-reserves-root-v1",provider_id,key_id,network,scheme,snapshot_id,
 merkle_root,String(total_liability_sats),issued_at,expires_at]
```

Network, root, scheme, nonnegative amount and validity window are checked. The
signed declared total must cover the submitted leaf amount, but signing a total
is not proof that all liabilities were included or that tree sums are correct.

`UNIVERSE_RESERVES_ATTESTATIONS` optionally names a 1 MiB file with schema
`universe-reserves-attestations-v1` and an `attestations` array of at most 500
signed roots. Every record must authenticate; duplicate snapshot IDs, expired or
invalid records reject the source. Directory and snapshot endpoints then expose
real configured identities and authenticated signed roots. Reserve amounts,
verified liability totals, block context and solvency remain unknown without
those observations. Missing or invalid sources return explicit 503 responses.

### BIP127 transactions

The BIP127 request contains `bip127_proof.expected_message` and
`bip127_proof.transaction_hex`, not ad-hoc per-address signature items. Verification
is read-only; the transaction is never submitted or broadcast.

Following [BIP127](https://github.com/bitcoin/bips/blob/master/bip-0127.mediawiki),
input zero commits to SHA256 of UTF-8 `"Proof-of-Reserves: " + expected_message`,
with vout zero and empty scriptSig/witness. The digest is interpreted as the
outpoint's displayed txid (reversed when serialized). Exactly one output must
equal the sum of reserve inputs; duplicate inputs and nonzero fees are rejected.

Current support is finalized native P2WPKH reserve inputs, compressed keys,
low-S ECDSA and SIGHASH_ALL without ANYONECANPAY. Version 1/2 transactions must
have zero locktime and final input sequences. Other spending or timelock templates
are explicitly unsupported. Signatures commit to the message input and all
outputs. The backend derives amounts and locking scripts from its owned Bitcoin
node, verifies genesis/network, requires confirmed unspent outputs (and mature
coinbase outputs), and checks a consistent current tip. Bounds are 100 reserve
inputs, 100 KiB transaction, 4 KiB message and a 15-second verification deadline.

Success proves only these submitted input signatures and current owned UTXO
observations. It does not establish the legal/provider identity named in a message,
historical ownership, all assets, complete liabilities or solvency. A positive
live provider proof requires the provider's actual signed transaction and owned
node evidence; deterministic local fixtures do not satisfy that requirement.

## Product routes

- `/intelligence/reserves`: configured identities, available signed snapshots,
  and explicit unknown aggregate balances/solvency.
- `/intelligence/reserves/providers` and `/provider/:providerId`: configured
  pinned identities and their available signed root records.
- `/intelligence/reserves/snapshot/:snapshotId`: signed root evidence and scope.
- `/intelligence/reserves/verify`: BIP127 transaction and liability inclusion tools.

## Local acceptance

Tests exercise signed roots, leaf amount/root/path tampering, untrusted keys,
network and expiry mismatch, actual local HTTP source loading, real generated
P2WPKH proof signatures with controlled UTXO fixtures, and stale UI responses.
This is local source/runtime evidence. Historical BIP127 validation, general
Bitcoin spending templates, Merkle-sum completeness, and real provider/chain
journeys remain separate acceptance requirements.
