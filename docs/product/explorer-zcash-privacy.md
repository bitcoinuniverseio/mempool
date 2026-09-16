
## UI-F10 local scanner correction

The viewing-key workspace now parses real UFVK/UIVK/Sapling extended and explicit incoming-key formats and decrypts Sapling/Orchard notes in a bounded local WASM worker. Keys stay in browser memory and never enter source requests or application storage. Public owned-node requests carry only network, interval and prior block hash; raw blocks are checked locally for header/height/predecessor/transaction commitments. Offline official test vectors exercise actual decryption and are visibly separate from chain evidence.

The scanner reports received notes in the selected interval. Complete history, nullifier/spend tracking and spendable balance remain open; no owned Zcash source was verified in this remediation task. An absent source is an explicit error. See [scanner scope, operator setup and evidence](../../tools/zcash-scanner/README.md).
