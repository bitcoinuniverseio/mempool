# BIP327 public verification fixtures

These four JSON files are unchanged official Bitcoin BIP327 test vectors from
[`bitcoin/bips` commit `ccb5415095c5b096abc9bd72384a6db4b7c34bce`](https://github.com/bitcoin/bips/tree/ccb5415095c5b096abc9bd72384a6db4b7c34bce/bip-0327/vectors).
BIP327 v1.0.4 credits Jonas Nick, Tim Ruffing and Elliott Jin and specifies
BSD-3-Clause licensing. No private wallet material is involved: `sk` and
`secnonces` in the upstream signing fixture are published test-vector values;
this implementation does not use them or implement signing.

The tests execute all key aggregation, nonce aggregation and partial
verification vectors, including duplicate keys, ordering, point validation,
zero/infinity handling, and the reference's empty/long-message verification
cases. The HTTP contract accepts a 32-byte message hash only. Both untweaked
final aggregation vectors are also executed, together with service-level
complete transcript and corruption cases.

Tweaked aggregation and secret signing/nonce-generation cases are outside this
implementation's scope. The public API rejects unsupported tweak fields rather
than treating them as an untweaked transcript.

SHA256 of the downloaded bytes:

| File | SHA256 |
| --- | --- |
| key_agg_vectors.json | 03c02a97e4ef3f2edfbc8e6013c127496dfcfd5889cfca60ddf009a4e9091cab |
| nonce_agg_vectors.json | 8409e87b81ea769759598ad3ce53b277a78afffb3a490a86ce02c4d69984524b |
| sig_agg_vectors.json | 15f14c034fb2a5739d7ce638be94c5b37ea675a2e01159092dd93b59d69c3439 |
| sign_verify_vectors.json | 692eecc101f3e515c29137f05031935e1210d2a01bab91e674eb0234f095c15c |
