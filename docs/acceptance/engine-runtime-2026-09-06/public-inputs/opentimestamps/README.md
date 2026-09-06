# OpenTimestamps proof fixtures

The proof and document bytes are unmodified official examples from
[javascript-opentimestamps c07ba8be0dae4e8721a84f32820abf7b2547a6ce](https://github.com/opentimestamps/javascript-opentimestamps/tree/c07ba8be0dae4e8721a84f32820abf7b2547a6ce/examples).
`sources.json` records each source URL, byte count and SHA256. The upstream
project distributes these examples under its LGPL-3.0 license.

`bitcoin-358391-header.json` records the historical Bitcoin header obtained
through the Universe-owned Explorer API. Unit tests replay this captured
header; their results are distinct from a current authoritative network read.

The parser implements detached format version 1 from the official
[Python format implementation](https://github.com/opentimestamps/python-opentimestamps/tree/master/opentimestamps/core).
It bounds proof size, operation count, depth, message sizes and header reads.
Calendar URLs are parsed as attestations and are never fetched by verification.
Pending proofs, unknown attestations, malformed input, document mismatch,
invalid commitments, source failures and chain reorganizations remain distinct.
