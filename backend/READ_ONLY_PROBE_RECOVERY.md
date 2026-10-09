# Optional address-probe cancellation

The source-checkpoint verifier compares the selected address index to the owned
Bitcoin node. Its caller has an eight-second deadline, while the verifier has
its own bounded deadline. A synchronous index callback could throw while the
`Promise.all` input array was being constructed, after two Core requests had
already started. Cancellation then rejected those unowned promises and caused
an unhandled rejection that restarted the backend.

The verifier now starts each read through a promise callback, so every read's
failure is owned before it executes. Caller cancellation reaches the existing
RPC controller and the listener is removed after settlement. An already
cancelled caller enqueues no work. A later fresh probe can retry normally.
Network, challenge, genesis and stable-checkpoint comparisons remain in effect.

Validation at `87859cf9f69e4166bdd783a4472c6674a2ef24c3`: 44 focused tests,
TypeScript validation and the backend build passed. The old verifier's fatal
`EABORTED` was reproduced under strict unhandled-rejection handling. Emission of
base `81ab0f1` matches the two deployed module hashes; the prepared overlay
replaces only those modules and retains the existing Linux dependencies and
separately qualified RPC override.

Runtime adoption uses an immutable release with an atomic overlay pointer.
Active indexing is not stopped or restarted; a naturally recovered process
must be checked through its actual mounted module hashes before activation is
claimed. Retain the previous overlay for pointer rollback. Fee availability
still requires the real mempool cache to synchronize. This repair does not
alter the fee readiness guard, cache data, credentials or shared RPC budgets.

The overlay naturally activated on INDEXERS-1 at 2026-10-09 04:26:34 UTC.
Actual process-mounted module hashes and the unchanged RPC override were
verified at 04:49 UTC. At 05:39:31 UTC the same process remained active;
bounded native and public Core reads returned matching fee estimates
(`2/1/1/1/1`) and chain tip `970589`. This later observation supersedes the
earlier guarded fee response. The cache became ready naturally. These two
read operations do not establish complete explorer or Core acceptance.
