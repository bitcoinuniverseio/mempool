# Backend metadata checkpoint

`GET /api/v1/backend-info` adds a nullable `checkpoint` to the existing metadata
response. The endpoint returns `Cache-Control: no-store`.

```json
{
  "chainSync": {
    "blocks": 965768,
    "headers": 965768,
    "initialBlockDownload": false,
    "verificationProgress": 1,
    "checkedAt": "2026-09-06T12:59:45.000Z"
  },
  "checkpoint": {
    "chain": "bitcoin",
    "network": "mainnet",
    "heightAtomic": "965555",
    "blockHash": "0000000000000000000060674d14febd35d92e54e491a858fac08d7e552f70bb",
    "observedAt": "2026-09-06T13:00:00.000Z"
  }
}
```

The numbers and timestamps above illustrate distinct node and index progress;
they are not a live readiness claim.

The checkpoint reads `height` and `id` from the same last `BlockExtended` in
the completed block cache, synchronously and without a second cache read. It
does not use Core's height or the collector's in-progress height. An empty
cache, invalid hash, negative or non-integer height, or unsafe numeric height
produces `checkpoint: null`. Height zero is valid. The configured Bitcoin
network is explicit, including Signet and testnet4. Liquid configurations retain
their own chain and network context.

`observedAt` records when that cache entry was read. It is separate from the
block's mining time and Core's `chainSync.checkedAt`. A fresh cache observation
can still describe an index behind the node. Consumers must assess observation
staleness and index lag independently. This checkpoint does not claim full
address coverage, historical database completeness, or mempool completeness.

For the Universe explorer source client, configure the owned `mempool-backend`
source with `readyPath: "/api/v1/backend-info"` and `chainReference: false`.
The checkpoint belongs to the index; only the independently observed Core
`chainSync` may supply the node reference. Its existing checkpoint parser
accepts the nested height, hash, context, and observation time. Do not configure
a `blockHashPath` to pair `/api/blocks/tip/hash` with `chainSync.blocks`: they
describe independent progress and can differ by hundreds of blocks. Core
`chainSync` remains independent node evidence, with its own sampling time and
sync fields.

This configuration requires a backend actually serving the patched metadata
endpoint. The public backend observed during this repair at commit `4c93322bb`
did not publish `checkpoint`; changing a local source configuration cannot add
it to that server. This change does not deploy or modify the public runtime.
