// Synthetic public oracle data, signed with independent noble BIP340. No funds.
export const ORACLE_SAMPLE = {
  "announcement": {
    "protocol_revision": "dlcspecs-tagged-v0",
    "oracle_public_key": "2bda68b3aa0239d382f185ca2d8c31ce604cc26220cef3eb65223f47a0088d87",
    "event_id": "Synthetic NFC event",
    "event_descriptor": {
      "type": "enumerated",
      "outcomes": [
        "Å",
        "sunny"
      ]
    },
    "event_maturity_epoch": 1700000000,
    "nonces": [
      "30e8a4b5a96ae2d4b8a64c7764c317bb017da8ce398d6bcb2f6887d6f71d2584"
    ],
    "announcement_signature": "c0e039ff212dfa9bbe95cc1bd6d6da968ff4489e6f6859993278c7d85b454f0b041ea0bb39cb96e1699bc2206cb91a29ec3e69b022aad9e0ae65364682bfc82e"
  },
  "attestation": {
    "announcement": {
      "protocol_revision": "dlcspecs-tagged-v0",
      "oracle_public_key": "2bda68b3aa0239d382f185ca2d8c31ce604cc26220cef3eb65223f47a0088d87",
      "event_id": "Synthetic NFC event",
      "event_descriptor": {
        "type": "enumerated",
        "outcomes": [
          "Å",
          "sunny"
        ]
      },
      "event_maturity_epoch": 1700000000,
      "nonces": [
        "30e8a4b5a96ae2d4b8a64c7764c317bb017da8ce398d6bcb2f6887d6f71d2584"
      ],
      "announcement_signature": "c0e039ff212dfa9bbe95cc1bd6d6da968ff4489e6f6859993278c7d85b454f0b041ea0bb39cb96e1699bc2206cb91a29ec3e69b022aad9e0ae65364682bfc82e"
    },
    "oracle_public_key": "2bda68b3aa0239d382f185ca2d8c31ce604cc26220cef3eb65223f47a0088d87",
    "event_id": "Synthetic NFC event",
    "outcomes": [
      "Å"
    ],
    "signatures": [
      "30e8a4b5a96ae2d4b8a64c7764c317bb017da8ce398d6bcb2f6887d6f71d258427ed61f95187e19cc3d021cc1aa04644b7d96632f7406f60c8ea012e80e37f96"
    ]
  },
  "event_hex": "fdd82249000130e8a4b5a96ae2d4b8a64c7764c317bb017da8ce398d6bcb2f6887d6f71d25846553f100fdd8060b000202c3850573756e6e791353796e746865746963204e4643206576656e74"
};
