# Threat model

Universe Explorer is a public, read-only explorer over private Universe
infrastructure. Its security posture follows from that: the public surface
reads, the private surface is never reachable, and no protocol claim is made
without evidence.

## Assets

- Bitcoin Core RPC (private, credentialed)
- Protocol indexer APIs and their bearer tokens
- The explorer database
- Internal network topology (hosts, ports, service names)
- The integrity of what the explorer states about the chain

## Trust boundaries

| Boundary | Rule |
| --- | --- |
| Browser to gateway | Public, untrusted. HTTPS 443 only |
| Gateway to explorer backend | Loopback or private network, no public port |
| Gateway to overlay | Loopback, no public port |
| Overlay to protocol authorities | Server-side only, bearer authenticated, fixed allowlist |
| Anything to Bitcoin Core | Through the bounded RPC pool, never public |

The browser never holds an indexer credential and never learns an internal
hostname. Overlay responses carry authority ids and coverage, never origins,
tokens, or ports.

## Threats and mitigations

**Credential exposure.** Tokens are supplied through named environment
variables, never inside configuration JSON, never logged, never serialized
into responses. Source listings expose `authorityId` only. Tests assert that
public responses match no URL, origin, or token pattern.

**SSRF.** Neither the browser nor the public API chooses an upstream. Source
origins come from server configuration and are validated as credential-free
origins with no path, query, or fragment; plain HTTP is accepted only for
loopback, remote hosts must be HTTPS. Redirects are refused rather than
followed.

**Resource exhaustion from a hostile or wedged upstream.** Every authority
request has a timeout and a response byte cap, batches are bounded with
limited concurrency, and results are cached briefly. A hung authority degrades
one protocol rather than blocking the explorer. This is not theoretical: an
Ord authority was observed wedged with hundreds of abandoned sockets while
still indexing, which is exactly what these limits contain.

**Request flooding.** Batch endpoints cap item counts (50 outpoints, 25
transactions), bodies are size-limited, and cacheable reads set explicit
cache headers. The gateway enforces rate limits.

**Untrusted protocol content.** Inscription and stamp content is attacker
controlled. Grids render typed static previews only: no arbitrary HTML, no
script execution, no unrestricted remote SVG, no autoplay. Interactive content
renders only inside a hardened sandbox with a strict policy, no same-origin
access, no top navigation, no storage, and no network by default. Declared
content types are verified against sniffed types with decompression limits.

**Numeric truth.** Protocol quantities are decimal strings end to end. The Ord
authority serializes rune amounts as raw integers beyond the safe JavaScript
range, so the client preserves them from the response source text; anything
whose precision was already lost is refused rather than fabricated.

**False certainty.** The largest correctness risk is presenting missing
evidence as a proven absence. Coverage class and negative completeness travel
with every claim, and the interface distinguishes proven emptiness from
incomplete, pending, stale, and unknown states.

**Privacy.** No third-party analytics, no external font or asset CDNs, no
address analytics trackers, and no user data in URLs sent off-origin. Address
lookups are public chain queries and are not retained beyond operational need.

## Out of scope

The explorer performs no mutations: no listing, purchasing, minting,
inscribing, or wallet operations. The only pre-existing write path is upstream
raw transaction broadcast, which ships only where the production security
policy explicitly permits it, and no new mutation surface is added.
