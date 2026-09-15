# Bounded consensus conformance campaigns

The four routes execute repository-controlled deterministic corpora against real, pinned local engines. They do not certify full consensus equivalence.

| Target | Actual execution | Scope |
| --- | --- | --- |
| transaction_parse | Bitcoin Core29 decoderawtransaction, rust-bitcoin0.32.102, bitcoinjs-lib6.1.7 | Deserialization, txid/wtxid and byte roundtrip; no spend validity claim |
| compact_size | rust-bitcoin VarInt and varuint-bitcoin | Actual acceptance/value differences, including nonminimal encodings and JavaScript integer limits |
| block_parse | rust-bitcoin and bitcoinjs-lib against an isolated Core regtest genesis corpus | Deserialization, Merkle/witness commitment and embedded-target PoW checks; no chain-context block acceptance |
| script_verify | btcd txscript1c55c7c18179 StandardVerifyFlags and Core29 testmempoolaccept | An actual mature P2WPKH spend and independently corrupted signature; Core policy and selected-input script scopes differ |

Each Core process has a unique task-owned datadir, loopback RPC port, cookie and regtest chain with peer networking disabled. Script campaigns mine only their own regtest wallet. Transactions are tested but never broadcast. The runner stops only its own child. This process isolation is not an OS security sandbox.

## Operator configuration

Build the native Rust parser from the repository lockfile:

```
cargo build --release --locked --offline --manifest-path rust/conformance-engine/Cargo.toml
```

Provision verified Bitcoin Core29.0 and the existing pinned btcd script-trace binary separately. Generate a local manifest with `node rust/conformance-engine/create-manifest.cjs <absolute-bitcoind> <absolute-output-directory>`. The generator records the actual executable SHA256 values, the Node runtime hash and the installed JavaScript transitive package byte hashes. It creates a separate32-byte HMAC key and random operator execution token. Protect both files with operating-system ACLs; do not serve the output directory or commit its contents. On Windows, explicitly restrict its ACL to the backend operator account. File mode0600 alone does not enforce Windows ACL isolation.

Set `UNIVERSE_CONFORMANCE_MANIFEST` to the generated manifest path for a dedicated local runner process. This is opt-in; no manifest means no executed evidence. There is no fallback to a production Core connection. Only one process can own a campaign store: a second process fails closed with storage unavailable. Deploy this capability on one dedicated runner and route its reads and writes consistently; it is not a shared cluster campaign database.

POST campaigns with `{ "target_id": "compact_size", "seed": 42 }`. POST replay to `cases/:caseId/replay`. Both require `X-Conformance-Execution-Token` matching the operator manifest hash. Read endpoints expose evidence but not the token, HMAC key, RPC cookie or arbitrary executable paths. Never expose this operator token to anonymous browser visitors.

## Evidence and recovery

Campaigns are persisted as running before execution and atomically replaced with measured results. Reports are HMAC authenticated using the separate operator key, then checksummed and gzip encoded. Restart validates authentication and record/input bounds; unfinished campaigns become interrupted, never completed. Replay verifies case input digests, executable/dependency pins and the exact harness digest, then reruns the actual engines. Script replay reopens only the original authenticated campaign UUID datadir and checks its recorded chain tip.

Retain the task-owned datadirs for script replay. Stop the runner before operator archival. Limits are20 campaigns,640 cases,64 replays,32 inputs per campaign,4096 bytes per input,16MiB serialized report storage,30 seconds per native process and bounded RPC responses/timeouts. Capacity exhaustion fails explicitly; reports are not silently deleted. Native process failure aborts the campaign; it is not normalized to a parser rejection. A successful campaign means the bounded inputs were executed, not that every implementation agreed. Inspect `expectation_failures`, actual per-engine outcomes and scope.

Timing is either per-input measurement or explicitly labeled batch wall time divided by input count. No minimization is claimed. Engine catalog health means pinned/configured, not a fabricated fleet heartbeat. No machine-proved formal artifacts are currently published by this runner.

## Remaining acceptance

Full chain-context block differential validation, sustained coverage-guided fuzzing, automatic testcase minimization, OS/container sandboxing, distributed scheduling, responsible-disclosure workflow and machine-checked formal theorem execution remain unimplemented here. Library parser differences are not proof of a consensus split. Full release GO must retain those original requirements.
