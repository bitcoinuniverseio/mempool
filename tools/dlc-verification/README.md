# DLC oracle verification references and fixtures

The verifier supports two explicit profiles. Callers must set protocol_revision; no fallback signature algorithm is attempted.

| Profile | Signed announcement bytes and digest | Numeric base | Attestation digest |
| --- | --- | --- | --- |
| dlcspecs-tagged-v0 | Complete oracle_event TLV; BIP340 tagged hash with DLC/oracle/announcement/v0 | BigSize | BIP340 tagged hash DLC/oracle/attestation/v0 over NFC UTF8 outcome bytes |
| rust-dlc-legacy-sha256 | Event payload without outer event TLV; plain SHA256 | big-endian u16 | Plain SHA256 of NFC UTF8 outcome bytes |

The first profile implements the tagged signing algorithm and TLV encoding described by the specification. The second matches rust-dlc's implemented validator and the published historical enum/numeric announcement vectors. This explicit distinction is necessary because current spec prose and deployed library serialization/signing differ. Reference commit IDs are recorded in reference-revisions.json; no profile auto-detection is performed.

Primary references:
- https://github.com/discreetlogcontracts/dlcspecs/blob/master/Oracle.md
- https://github.com/discreetlogcontracts/dlcspecs/blob/master/Messaging.md
- https://github.com/p2pderivatives/rust-dlc/blob/master/dlc-messages/src/oracle_msgs.rs
- Published vectors from https://github.com/discreetlogcontracts/dlcspecs/tree/master/test (CC-BY-4.0 specification; preserve attribution).

The backend uses installed tiny-secp256k1 2.2.4 BIP340 verification. Keys/nonces must be valid 32-byte x-only points. Event descriptors bind every serialized field and reject extraneous unsigned fields. Enums require unique normalized outcomes and one nonce; numeric events explicitly declare base/sign/precision/unit/digits and the exact nonce count. Supported resource bounds:64 nonces,256 enum outcomes,1024-byte normalized event/outcome strings,128-byte units,bases2..65535.

Attestation requests must include the full signed announcement, not just an opaque announcement ID. The announcement is reverified first; every outcome must be allowed by the descriptor, every R value must match its announced index, and every Schnorr signature must verify under the same key and declared digest profile. Negative zero is rejected; hexadecimal-base digits are expressed as decimal strings per the spec. Signatures authenticate statements, not real-world truth. has_conflict is null and conflict_state is not_checked because no cross-announcement conflict evidence is supplied.

The frontend verifier at /contracts/dlc/oracles and event detail accepts public announcement/attestation JSON independently of the unavailable registry. It submits no private keys and clears stale results on edits/sample/navigation. Optional original_bytes_hex must exactly equal the reconstructed complete announcement TLV.

`node tools/dlc-verification/generate-fixtures.mjs` generates synthetic public enum and signed numeric fixtures using an independent noble BIP340 signer. The fixed scalar in the generator is public test material and never used for funds or an actual oracle. The dlc_schnorr_test.json file likewise contains published test-only scalar inputs; these are not operational credentials. Other files retain official unmodified vectors. Backend tests check the two independent official announcement vectors, all five official Schnorr vectors, all Unicode vectors, independent tagged signatures and malicious alterations. Registry, crawler, cross-event conflict discovery, contract adaptor signatures and execution/simulation remain separate OPEN acceptance gates.
