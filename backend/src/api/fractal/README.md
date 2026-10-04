# Fractal native read source

These readers require explicit startup wiring. The default service remains unavailable.
Only the independently qualified Fractal v0.4.0 testnet context is implemented here.
The optional route query `network` must be the scalar string `testnet` when
present; mainnet, Signet and ambiguous queries fail before source IO. When absent,
the explicitly configured Fractal testnet identity remains visible in the response.
Its `bc` address HRP and Bitcoin mainnet genesis do **not** establish network identity:
each attempt checks native `chain=test`, version 400, `/Satoshi:0.4.0/`, genesis, and
Fractal testnet block one `000000000021b22bb6a9718e5db62fca1eb2ac6e34535e70c67b374dcb29c570`.

Construct `FractalNativeReader(profile, createFractalRpc(loopbackUrl, credentials))`
and optionally `Cat20Projection(native, readPool, trackerProfile, cursorKey)`, then
call `configureFractalSource(native, projection)`. Credentials must be acquired
from the protected owned configuration/cookie; never put them in public profiles.
The transport permits only the eight implemented read RPC methods, refuses redirects
and foreign origins, caps response bytes, and uses one total deadline of at most 15s.
Public native profile commitments must be measured independently from the operated
binary and selected configuration before wiring, not learned from a first response.
`sourceRevision` is the official release's pinned source declaration; the release
binary has not been reproduced from source merely by checking its hash/version.

The pg-compatible pool must target the qualified native CAT 8d5 schema, with a
dedicated SELECT-only role, one connection and a bounded connection timeout.
Measure its schema commitment with `CAT_SCHEMA_SQL` and `catSchemaDigest`, and
commit the exact database/schema, role, native context, worker/SDK artifact bindings
and source revision into the independently measured selected configuration digest.
The runtime source must use the unchanged CAT covenant locks and source-built SDK
whose official 1.0.17 artifacts match the governing sCrypt 1.19.4 compiler output.
Native source/artifact acquisition evidence remains separate from a read response.
The cursor key must be at least 32 independently generated protected bytes; retain
it across a restart to preserve valid continuation, or explicitly restart pagination.

CAT reads use a READ ONLY, REPEATABLE READ transaction with an explicit public
schema, a checked full schema fingerprint and canonical node/tracker checkpoint.
Initial node IBD or tracker lag returns unavailable, never an empty catalogue.
At selected height H, creations after H are absent and spends after H remain
unspent. Both current and archived native output tables participate. A spend
reference without its tx row is an incomplete native write and rejects the read.
Token-page balances are aggregated in bulk. Limits are 1..500; token ID/owner PKH
ordering uses deterministic C collation. HMAC cursors bind height/hash, scope,
limit, both source configurations, tracker revision/schema and a ten-minute expiry.
Canonical checkpoints are bracketed with fresh native identity reads; a reorg,
foreign scope, schema drift or changed context requires a new initial page.

Wire schemas are `fractal-tip-v1`, `fractal-block-v1`, `fractal-transaction-v1`,
`fractal-mempool-v1`, `cat20-token-v1` and `cat20-page-v1`. Pages expose `items`,
actual `total`, `nextCursor`, checkpoint and source observation; routes also retain
the `tokens`/`holders` aliases. Transaction fees stay null without complete prevouts;
confirmed-only CAT projections do not invent pending CAT mempool counts or join
transaction operations. Native aggregate mempool bytes/count do not establish
weight/fee distributions. Holder PKH is not a recovered Taproot address. Supply
limits, minter classification/state and transfer totals remain null until their
specific governing contracts are validated. Frontend consumers must handle these
versioned nullable observations and pagination before joint acceptance.

Component/native read checks do not complete BE007. Full genuine testnet node and
tracker replay, accepted CAT deployment/mint/transfer/spent state, restart/reorg,
large sets and all seven API-to-UI journeys remain required. Preserve the handoff
annotation and failure evidence until those checks pass.
