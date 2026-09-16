# RGB browser validation engine

Pins official rgb-protocol consensus/ops/schemata Git revisions in Cargo.toml and
Cargo.lock. It supports RGB0.11.1-rc.11 consignments with five pinned official
schemata (NIA, UDA, CFA, IFA, PFA), strict hexadecimal and official ASCII armor.
Unknown schemata are unresolved. Other incompatible RGB versions are not accepted
as this version. Contract IDs/schema IDs are recomputed, not copied from armor.

The same Rust function runs native fixture tests and a WASM browser worker. It
executes the real schema type check, genesis/transition business logic, transition
history, single-use seal and Bitcoin commitment validator. Network and public
transaction ID bindings are mandatory. Missing anchor evidence is unresolved.
Successful validation does not authenticate issuer identity, prove current terminal
ownership/spendability, or establish wallet recovery. Schema-specific signature
rules execute in the pinned RGB VM; there is no invented global signature verdict.

## Build and packaging

Install Rust's wasm32-unknown-unknown target, LLVM clang/llvm-ar and
wasm-bindgen-cli exactly0.2.114. Run `node build.mjs` here, with CARGO and
WASM_BINDGEN absolute paths if needed. On Windows the script configures LLVM only
for its child process. It uses cargo --locked and ships JS/WASM under
frontend/src/resources/rgb-engine, with SHA256 engine-manifest.json. Angular copies
these resources. The browser worker has a30-second lifetime limit and256MiB WASM
memory maximum. Import limit2MB,256bundles/anchor witnesses. Only public txids are
sent to `/api/v1/intelligence/rgb/anchors`; no consignment upload API exists.

## Decoder hardening

Vendored rgb-strict-encoding from exact7feb0f2986a49cf3fa084e7030c8aa162356779d;
all copied Rust sources retain upstream licenses. The sole algorithm change in
rust/src/embedded.rs caps initial Vec/VecDeque reservation at1024 items instead
of allocating the entire untrusted encoded length before reading input. Growth
occurs only after successfully decoded items. Wire format and validation rules
are unchanged. An adversarial mutation caused the upstream decoder to panic on
capacity overflow in WASM; this patch removes that preallocation path. Any other
engine trap remains an unresolved operation, never a valid result.

## Evidence scope

Public fixtures in tests/public-fixtures.json originate from official rgb-tests
bf782d5172a0bd1b39c033a91edb81e9fd6387e3 scenariosA-D, with transaction bytes
independently serialized and TXIDs checked. Their mined positions are upstream
fixture assumptions, not live chain observations. Live owned Signet resolver
checks are separate. A valid live Signet RGB consignment and its altered
seal/transition counterparts remain an explicit acceptance gate.
