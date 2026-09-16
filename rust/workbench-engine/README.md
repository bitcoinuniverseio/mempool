# Workbench native engines

The backend uses two bounded, read-only child processes. Neither engine signs,
broadcasts, accesses wallets, or connects to a node. Node descriptor/disassembly
reads use the existing backend Core configuration separately.

## Reproducible build

From this directory, with Rust/Cargo available:

```sh
cargo build --release --locked
cargo test --locked
```

`Cargo.lock` pins dependencies. The direct compiler is rust-miniscript 12.3.7.
Use `--offline` when all locked crates are cached. The executable is
`target/release/universe-workbench-engine` (`.exe` on Windows).

From `../script-trace`, with Go 1.23.2 or newer available:

```sh
go mod download
go build -mod=readonly -trimpath -o script-trace .
go test -mod=readonly ./...
```

On Windows use `-o script-trace.exe`. `go.mod` and `go.sum` pin btcd txscript
commit `1c55c7c18179` and dependencies. The temporary audit build used the official
Go 1.27.1 Windows archive, verified against the SHA256 published by go.dev.

## Runtime packaging

Native engines are separate build artifacts, not TypeScript output. Package both
executables for the deployment's OS/architecture. Configure absolute paths:

```text
UNIVERSE_WORKBENCH_ENGINE=/absolute/path/universe-workbench-engine
UNIVERSE_SCRIPT_TRACE_ENGINE=/absolute/path/script-trace
```

The development fallback paths are these source directories' compiled outputs.
Do not assume a backend-only tarball contains them. Set executable permissions on
Unix. Include the applicable upstream license files with distributed binaries
(rust-miniscript CC0-1.0, Bitcoin Rust dependencies CC0-1.0, btcd ISC and the Go
dependency licenses). The build commands perform no deployment.

Each adapter uses `execFile` without a shell, hidden windows, a five-second
deadline, bounded output and a maximum of two active jobs. Input is passed through
stdin, not a command-line argument. Missing/timed-out binaries return explicit
503 errors; unsupported or malformed input returns 400. No substitute result is
generated.

## Exact supported scope

- Compiler: concrete compressed public-key policies, Segwit v0 P2WSH Miniscript,
  safety properties and upper-bound witness sizing. This is not a spend verdict.
- `--taproot`: public `tr(...)` descriptor derivation, leaf/control-block
  commitments and output key. The backend reconciles the result with the
  independent Core-derived output script. One derivation index per branch is
  inspected; the response identifies that index explicitly.
- Stack tracer: standalone legacy scripts and initial stack data, using the
  established btcd interpreter. Signature and timelock opcodes, witness programs,
  and P2SH wrappers require transaction context and are explicitly rejected.
  Trace completion/success does not claim transaction or consensus validity.

Workbench PSBT analysis supports BIP174 v0 and BIP370 v2 in-process, including
all 47 official BIP370 container/locktime vectors. Its BIP370 adapter reconstructs
the unsigned transaction with actual sequences and separately exposes the
sequence-zero `psbt_id`. Unknown UTXO fees remain null. Silent Payment outputs
whose scripts have not yet been computed are explicitly rejected. Final scripts
are structural completion only; on-chain availability and final-signature
verification remain separate.

## Transaction-context verification

The Go helper additionally supports `--transactions`, used by the Ark backend and
available through backend/src/api/intelligence/workbench/transaction-script-verifier.ts.
The legacy single-input shape remains supported. The selected-input shape is
`{transaction_hex,input_index,previous_outputs:[{txid,vout,script_hex,amount_sats}]}`.
Supply every previous output in transaction-input order. The engine validates
count/outpoint bindings, monetary bounds and duplicate inputs, builds a full
previous-output fetcher, then executes the selected input with StandardVerifyFlags.
This covers signature and script-path conditions, not chain maturity/unspentness,
whole-transaction relay policy or network acceptance. Maximum512 contexts per
bounded2.1MB request,256 inputs per transaction, five-second child deadline.
