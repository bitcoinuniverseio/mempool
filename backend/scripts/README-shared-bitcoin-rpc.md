# Existing shared RPC relay and negotiated gzip preparation

The relay source is copied from the existing first-party I2 `/opt/universe-shared-rpc/shared-bitcoin-rpc-relay.py`, original SHA256 `8afab26901e78fd478f8ff302bcab8d6b6cd3b57679da9c7ea202b23f9558ac9`. Source staging does not update that live process or the valid native Mempool reader.

The native JSON-RPC client advertises gzip and accepts identity responses with no encoding header. Gzip is decoded as a stream under the same absolute operation deadline and AbortSignal as headers/body/JSON validation. Both compressed wire bytes and decoded bytes are capped by the existing response limit (default64MiB); the wire cap may be lowered independently. Invalid CRC/truncation/unsupported encodings fail without retry or encoding fallback. Complete framing, matching/unique request IDs, batch ordering, TLS settings, cookie refresh on401 and safe Core error messages remain. Only valid matching200/500 RPC envelopes may supply a Core domain error; non-RPC503 and authentication statuses remain safe HTTP errors. Writes are never automatically retried.

The relay retains loopback binding, existing protected settings, existing node-cookie namespace lookup, client authentication and exact scoped method list. It retains the4MiB request cap, rejects ambiguous/truncated framing, and uses the existing120s maximum with absolute timers and a bounded64MiB upstream read. Unexpected upstream compression is rejected. Clients that explicitly accept gzip receive gzip for large successful replies; no-header and q=0 clients receive identity. No cookie/password/header/transaction data is logged.

Validation commands:

- `node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --coverage=false --runTestsByPath src/__tests__/rpc-lifecycle.test.ts src/__tests__/rpc-gzip.test.ts` from backend.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json` from backend.
- `python -m unittest discover -s backend/scripts -p test_shared_bitcoin_rpc_relay.py -v` from repository root.

The real owned-node block response benchmark reduced11,668,226bytes to2,569,687bytes with gzip1 in0.0766s. An ephemeral test-only proposed relay and actual proposed native client read that same real feed in1001ms with negotiated gzip and intact result shape. This was a component test, no live application deployment or functional PASS. Existing uncompressed I1 route took8.67s in a bounded observation, while direct node took0.155s. These measurements motivate throughput improvement; they do not establish the precise cause of live fee unavailability.

The existing native reader was still validly indexing and reported92%mempool loading. REST fees correctly return503 until `mempool.isInSync()`; partial WS fee objects must never bypass that guard or become acceptance evidence. Preserve its PID, current valid indexing/reorg work, source/network context and naturally activated probe overlay.

Before rollout, root independently reviews source, tests and actual feed receipts. Qualify a protected parallel transport candidate with the same canonical node/settings and bounded reads only; a transport fixture is not another indexer. Preserve active reads on the existing owner, use the established owner-drain/forwarding handoff only when it can preserve availability, and retain both configurations/artifacts for rollback. No native reader restart, active-read interruption, unqualified retarget, source-auth rotation, public source change or ledger mutation is authorized by this file. If the owner cannot drain without interruption, keep live software unchanged and report that actual blocker. Real synchronized fee/tip availability and source identities must be verified separately after any authorized handoff.
