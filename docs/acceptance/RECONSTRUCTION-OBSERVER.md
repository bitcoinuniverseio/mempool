# Bounded reconstruction observation and continuation

The prepared state-only route is `GET /api/v1/address/:address/utxo-reconstruction/v4/:sessionId?network=signet&releaseSha=<40hex>&configurationSha256=<64hex>`.
It reads the existing session map and cached artifact/configuration descriptors.
It never creates a reconstruction service/session, acquires source data, returns
outputs, slides the fixed 60-minute expiry, or claims current-chain freshness.
Legacy short/absent version metadata does not disable the existing create/next
source-proof path. Such sessions remain unbound and inspection returns503; it
cannot upgrade them later just because artifact metadata appears. A session
created with a full artifact/profile binding cannot lose that guard on resume.
The accepted successor must carry a full40-character release binding.

Missing state, expired state and wrong address are unavailable; wrong network,
artifact or source profile cannot resume a different context. Busy state does
not admit another page. Original confirmed-anchor data is fingerprinted using
SHA256 of its unchanged UTF-8 JSON encoding (object key order preserved).

`lastSuccessfulObservation` retains the exact previously returned operation
response/local progress delivery timestamp (`observedAt`), source checkpoint
verification time (`checkpoint.verifiedAt`) and committed progress. The response
delivery timestamp is not a new native source observation. An inspection
at a later wall-clock time does not update those fields. `lastOperationError`
contains only bounded classified lifecycle information; its `failedAt` is not
source observation time. `resultAvailable` describes a stored historical
completion. Inspection does not provide current output eligibility or the full
result. The existing explicitly invoked next/replay operation still performs
all native source, original-anchor, mempool, output and deadline fences.

The original 100-row page, 10-second history HTTP acquisition, 20-second route,
32-MiB retained work, eight-session, read-only Core batch and output guards are
unchanged. Inspection adds fixed-size metadata only. The ordinary UTXO path
still refuses lists above its existing 500-row validation limit.

The explicit observer is `backend/scripts/reconstruction-v4-observer.py`. It
uses only the existing private Signet API on `127.0.0.1:17997`; it accepts no
external origin, alternate source, timeout, row or RPC override. Its state and
receipts stay in the implementation audit root. `start` needs a new state file
and exact qualified release/configuration fingerprints. `resume`, `inspect`
and `cancel` refer to that existing handle. Every invocation requires an
explicit action; there are no background polls or automatic retries.

Each observation is bounded by 650 next operations and 600 seconds. Reaching
that observer boundary retains the handle for explicit continuation before its
original expiry. A native deadline/error stops immediately and retains the
exact pending input cursor for operator review. A lost successful response can
replay only that original input when state confirms the matching last input;
it cannot advance an unrelated cursor. Cancellation is explicit. Process
replacement, expiry, profile drift or missing inspection cannot silently create
a replacement. A create response lost before its session ID is received is an
unknown resource outcome; do not automatically create again or assert that no
session exists. Inspection is not a global session counter.

The earlier f77 large-address run remains PARTIAL at 2,800/13,545 transactions,
then stopped on a 10-second confirmed-history acquisition deadline and was
explicitly cancelled. API1501 retains the same reconstruction source code.
The successor here is source-only: current native API1501 does not expose this
new inspection contract. No large run or native service/profile change occurs
as part of these changes. Large reconstruction and independent exact output
parity remain required and unqualified.

Native UTXO paging is a separate prerequisite. The pinned upstream Electrs
v3.3.0 source has confirmed-history/summary transaction cursors, but no UTXO
cursor. Its confirmed UTXO map folds script history under `utxos_limit` and can
populate a native cache; the REST endpoint materializes a vector and adds the
mempool overlay. Summary rows contain transaction net values, not outpoints,
so they cannot substitute for a complete output list. A legitimate native
successor must bound the script-history fold/cache decoding and mempool overlay
before allocation, bind continuation to source/network/anchor/epoch, produce
bounded deterministic output pages, preserve reorg/capacity/unavailable states,
and reuse the existing producer/read pools. Slicing an already-materialized
vector, raising the ordinary 500 cap or scanning global Core UTXOs is excluded.
Native source/build parity and ownership must be established first.
