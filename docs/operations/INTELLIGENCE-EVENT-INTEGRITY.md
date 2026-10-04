# Intelligence event payload integrity

New events use envelope schema `1.1.0`. `payload_hash` is lowercase SHA-256 of the UTF-8 JSON representation of the complete payload. Object member names are sorted recursively using JavaScript's default string ordering; arrays retain their order. Serialization uses `JSON.stringify` semantics. This is the explorer's versioned serialization contract, not a claim of compliance with a different canonical JSON standard.

Publication, broker consumption and replay recompute the digest. A changed nested template, changed array order, malformed digest or unsupported schema is rejected. Satoshi and weight numbers must be safe integers. Explicit source sequences must be nonnegative safe integers and are not rounded. An unspecified producer version is reported as `unknown`; a getblocktemplate response does not establish the node's software version.

Version `1.0.0` remains readable when its payload has no nested object members and its complete digest can be verified. The earlier serializer omitted nested object fields. Historical nested `1.0.0` records therefore cannot establish payload integrity, even when their old digest matches. They remain in their existing storage and require a fresh authoritative observation for acceptance. Do not rewrite their schema or digest to make them appear newly verified.

Broker replay fails explicitly when a matching retained record is invalid or unverifiable. It does not silently omit the record and report a complete replay. Live durable consumers retain their existing bounded retry and digest-only quarantine policy. The broker's original records and dead-letter receipts are preserved. SSE consumers receive the existing unavailable or replay-gap state and can request a fresh observation.

Before rollout, qualify new publication and consumption together, check affected consumers, exercise malformed retained data and restart/replay, and preserve the original broker store. A rollback must retain the newer records and report unsupported data explicitly; it must not erase history or accept nested records under the weaker digest contract.
