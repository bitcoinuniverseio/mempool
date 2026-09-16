// Public upstream test-only incoming keys and ciphertexts. No user wallet material.
export const ZCASH_SCANNER_SAMPLES = {
  "sapling": {
    "network": "mainnet",
    "mode": "compact-artifact",
    "key_type": "sapling-incoming-hex",
    "viewing_key": "b70b7cd0ed03cbdfd7ada9502ee245b13e569d54a5719d2daa0f5f1451479204",
    "outputs": [
      {
        "pool": "sapling",
        "ephemeral_key": "ded68f05c658fcae5ae218646ff844406f84426784040d0bef2b09cb3848c4dc",
        "commitment": "635572f572a8a1a0b7acbc0afc6d66f14a02efacde7bdf03443ed4c3e551d470",
        "ciphertext": "8d6b27e7eff59bfba01d6588badd366ce59b4d5b0ef93bebcbf211417c56ae700ae18244bac2fb6437db01f83dc149e2786ec4ec",
        "zip212": "off"
      }
    ],
    "expected_zatoshis": "100000000"
  },
  "orchard": {
    "network": "mainnet",
    "mode": "compact-artifact",
    "key_type": "orchard-incoming-hex",
    "viewing_key": "1039d8e64a80902e105947817df3bdfb7df7030e68739f9c533a36bf5a6a807243106de9a7ec54dd36dfa70bdbd9072dbddab5e066aaeffcf9bba320d4fff712",
    "outputs": [
      {
        "pool": "orchard",
        "ephemeral_key": "8a5e132c3a0704f2456fbd777a13d6ec57655671db072a7d276ad969f5ec4517",
        "commitment": "23757c515821cbc1843c9a457b7e6ae601add2ea10b9c86d6b317ce2f17bd921",
        "ciphertext": "93e04874b5837c261daf1a27b783ec4865d3bb728eb161daedb8446ab38f078ea8662e4d2e9d00a39527dcde517ac3dbf9d27e3c",
        "nullifier": "ca1feb30ca111776c0417466bd69b3d213882eef55e60b6d9e2a98e705eef327"
      }
    ],
    "expected_zatoshis": "8567075990963576717"
  }
} as const;
