# Offchain public transaction verification

The original statechain signature-text/count and CoinSwap numeric-timeout checks did not prove transactions or recovery. The replacement verifies explicitly scoped public transaction profiles against an owned Bitcoin Core checkpoint and the existing pinned btcd script engine.

- `bitcoin-backup-sequence-v1`: one confirmed unspent Taproot deposit; full key-path DEFAULT/ALL signatures; one input/output; sequence `fffffffe`; strictly decreasing height locktimes. Signed bytes, optional declared locktime/txid/outpoint/value/fee and owned amount are bound. The earliest possible inclusion height is `nLockTime + 1`. Mercury ownership handover, server signature counts and key rotation remain **unverified**.
- `teleport-p2wsh-contracts-v1`: two distinct confirmed funding outputs, fully signed ALL 2-of-2 P2WSH spends to the exact public Teleport HASH160/CSV contract, and fully signed timeout refunds spending those outputs. Both contract and refund execute in btcd. Shared hash commitment and forward/backward relative delay ordering are checked. The reference source/revision is in `teleport-reference.json`; the profile names this template, not an unsupported generic Teleport version claim.

Core must match configured network and be out of initial sync. The best header's double-SHA256 hash, active height mapping, verbose header height and before/after best tip agree. Confirmed unspent funding outputs are reread after script execution, including mempool spends. This trusts the operated Core's chain validation; it is not an independent full-chain consensus implementation. Each RPC has a five-second wait bound; at most two requests and 32 entries are processed. Transaction bytes and process input/output are bounded by the existing engine. Missing node/engine fails visibly.

Neither profile authorizes recovery. CoinSwap CSV ages start at each contract's confirmation; ordered delays do not establish cross-leg confirmation timing, relay policy, preimage transfer or full route safety. `protocol_verified` stays null and recovery remains unknown. Identifier/height-only planner requests return `insufficient_artifacts` and no PSBT. Original full Mercury/Teleport execution acceptance stays open.

The UI sends allowlisted public transaction fields to this explorer backend. It does not claim browser-only verification. Unknown fields are rejected before transmission, and edits/sample/network/destruction cancel stale requests. Sample transactions have synthetic regtest value only. Never supply wallet material.

## Reproduce actual owned-node proof

The isolated task used official Bitcoin Core 29.0 Windows ZIP, SHA256 `4c1780532031129fcacfc0e393c8430b3cea414c9f8c5e0c0c87ebe59a5ada1b`, verified against official SHA256SUMS and Wladimir's detached signature (primary fingerprint `71A3B16735405025D447E8F274810B012346C9A6`; public key from official bitcoin-core/guix.sigs). Runtime is outside the candidate under the task workspace `tools/bitcoin-core-29.0` and `regtest-proof`. No installed runtime was changed.

Supply `OFFCHAIN_REGTEST_DATADIR` pointing at an explicitly isolated regtest node with RPC `127.0.0.1:19483`. `generate-fixtures.cjs` refuses non-regtest, creates its own `offchain-proof` wallet, mines synthetic blocks, funds the public fixture outputs and writes `fixtures.json`. Only funding transactions are broadcast on that isolated regtest. Backups/contracts/refunds are not broadcast. It reads the node cookie without printing it. Do not run it against a shared/production node. Coordinate mining with other task checks.

Run backend Jest with `OFFCHAIN_REGTEST_DATADIR` set and paths `src/api/intelligence/offchain/package-verifier.test.ts` and `offchain.test.ts`, `--runInBand --coverage=false`. Live cases explicitly skip without that environment; they are not fake node acceptance. Static profile and legacy regression tests still run. Frontend Vitest: `src/app/universe/offchain/offchain-package-workspace.spec.ts`.

For browser acceptance, configure only the isolated candidate backend's owned Core reader to the task regtest and load the signed regtest sample on both verifier pages. An ordinary Signet backend must reject the regtest sample as a network mismatch. No credentials or cookies belong in browser configuration.

Manifest signatures now require an explicit signed `signature_scheme` (`schnorr` or low-S `ecdsa`), with no fallback, and a valid currently effective validity interval. This remains the explorer's defined top-level-key-sorted JSON signature format, not a claim of Mercury's native operator protocol.
