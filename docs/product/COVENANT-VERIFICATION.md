# Covenant verification scope

The previous simulator ignored its script, keys and deposit, returned `valid: true`, and invented three successful transitions plus a constant witness weight. It now requires actual transaction bytes and the exact bare BIP119 covenant script. The template hash is computed from exact serialized bytes, including signed 64-bit output encodings without JavaScript number rounding. Every published CTV hash vector passes, including arbitrary uint32 hash indexes; the spending checker separately requires an existing input.

`template_matches` is a hash equality result. `valid` remains null for a match because it is not complete script or vault execution. A mismatch returns false. No state transitions or witness weight are invented. The current bounded checker accepts `PUSH32 <hash> OP_CHECKTEMPLATEVERIFY`; other script programs require a complete hypothetical interpreter.

The designer constructs real witness scripts for an immediate recovery branch, a hot-key/CTV branch, and a delayed hot-key unvault branch. Compressed keys, distinct key roles, the supplied 32-byte template hash and a minimally encoded block delay are validated. This constructs scripts; it does not prove that the supplied hash commits to a transaction paying the intended next script. A complete vault transaction graph, signature authorization, timelock context, recovery tests, hypothetical consensus interpreter and chain activation evidence remain acceptance requirements.

The registry identifies BIP443 as OP_CHECKCONTRACTVERIFY, rather than the unrelated OP_TXHASH name previously assigned to it. Specification status is distinct from network activation. Unmeasured expressiveness/security scores and unselected activation mechanisms are reported as unknown.

Primary specifications, checked 2026-09-15: [BIP119](https://github.com/bitcoin/bips/blob/master/bip-0119.mediawiki), [BIP347](https://github.com/bitcoin/bips/blob/master/bip-0347.mediawiki), [BIP443](https://github.com/bitcoin/bips/blob/master/bip-0443.mediawiki). Published [CTV vectors](https://github.com/bitcoin/bips/blob/master/bip-0119/vectors/ctvhash.json) are retained in the backend test directory.
