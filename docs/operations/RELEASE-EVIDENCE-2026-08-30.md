# Release evidence, 2026-08-30

What was measured, on what, and what it said. Figures here are readings, not
targets: where something did not reach a release threshold this records the
number rather than the intention.

## Zcash transaction fees

The explorer reported a shielded transaction's fee as "not public". That was
wrong. The fee is the value left in the transparent transaction value pool, and
every term of that sum is public: transparent inputs and outputs, the Sapling,
Orchard and Ironwood value balances, and the Sprout JoinSplit public values.

Verified against mainnet Zebra 6.3.0 with
`index-zcash-metaprotocols/scripts/verify-public-fee.mjs`, comparing the fee the
node charged against the value pool arithmetic for every waiting transaction:

```
7 agreed, 4 of the set were shielded, 0 had an unresolved transparent prevout
```

Verified again through the deployed overlay after cutover: 10 of 10 pending
transactions carried a fee with `source: node-and-value-pool`, including a
shielded one at 10,000 zatoshi. Before the change that count was 0, for
transparent transactions as well as shielded ones, because a node does not
resolve the previous output of a transaction it returns and the arithmetic had
no input values to work from.

ZIP-317 is resolved from `getblockchaininfo.upgrades` rather than assumed.
Mainnet reads under revision 1, branch `37a5165b` (NU6.3), active from block
3,428,143. A height below the fee mechanism and an unrecognised future branch
both produce an explicit unsupported state, and neither suppresses a fee that
could be read.

## Dogecoin coverage

`index-doge-tap` is ready, connected, fully scanned, with nothing quarantined.
It published no checkpoint, because the only checkpoint it had came from a
custody snapshot that refuses to build unless the inscription index and
Dogecoin Core agree on the tip exactly. That refusal is correct for custody and
was the wrong answer to a different question.

It now publishes coverage separately, on `GET /v1/checkpoint`:

| reading | value |
| --- | --- |
| indexed tip | 5,782,326 |
| chain tip | 6,353,804 |
| lag | 571,478 blocks |
| completeness | partial |
| custody snapshot | blocked by `inscription-index-behind-chain` |

The production smoke check that failed on `index-doge-tap is configured but
published no checkpoint` now passes.

## The inscription index cannot catch up

Measured on the indexer host, process 968854, index
`/data/indexers-b/ord-dogecoin/doginals.redb`:

| reading | value |
| --- | --- |
| throughput | 16 blocks/hour |
| remaining | 571,186 blocks |
| implied time | about four years |
| disk I/O per block | ~3.4 GiB read, ~3.4 GiB written |
| index size | 1.5 TB real |
| volume headroom | 115 GB |
| Dogecoin Core `getblock` latency | 14 ms |

The node is not the bottleneck. The worker sits in uninterruptible disk sleep;
this is write amplification against a 1.5 TB file with a 4 GB cache on a host
with 26 GB of swap in use. No parameter closes a three orders of magnitude gap,
and the volume exhausts long before the reindex could finish.

Consequence: `doginals`, `drc20` and `dunes` cannot reach ready on this build,
and the `tap_doge` custody snapshot cannot be produced. The explorer reports
that state rather than implying otherwise. Per `AGENTS.md` rule 4 the indexer
was not terminated.

## How far behind an authority is

The overlay reported both Dogecoin authorities as `lagBlocks: "0"`, level with
the chain, while the index they both read sat 571,478 blocks behind it. Lag was
the difference against the highest peer on the same chain, and two authorities
reading the same lagging index agree with each other perfectly.

Bitcoin was correct only by accident: `mempool-backend` reads Bitcoin Core
directly and happens to sit in the same set. An authority that carries the
chain's tip now declares it, lag is measured against a reference or not at all,
and a chain with no reference reports unknown rather than zero.

## Networking

`index-doge-tap` was listening on `0.0.0.0:3013` and answering `/ready` to the
public internet, on a host whose firewall is inactive. Its only consumer is the
overlay on the same machine, reaching it through an `/etc/hosts` entry that
already pointed at loopback.

Bound to `127.0.0.1`. Verified after the change: loopback answers 200, the
public address refuses.

The host firewall remains inactive and every other listener on it was checked:
`22`, `8333` (Bitcoin p2p), and one interhost `50001` endpoint are the only
non-loopback listeners, all intended.

## Public origin

```
strict-transport-security: max-age=31536000; includeSubDomains
content-security-policy: default-src 'self'; script-src 'self' 'sha256-...';
  frame-ancestors 'none'; object-src 'none'; connect-src 'self'; ...
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: no-referrer
cross-origin-opener-policy: same-origin
permissions-policy: accelerometer=(), camera=(), ... usb=()
```

The script hash is derived per document from the file being served, so a
frontend cutover cannot leave the gateway allowing the previous build's hash.

## Dependencies

Measured rather than inferred from upstream's commit list, because this fork
carries its own lockfiles.

- backend: zero advisories at any severity.
- frontend: eleven, ten of them in build tooling that never reaches a browser.
- The eleventh ships: `echarts` 5.4.3 carries GHSA-fgmj-fm8m-jvvx, moderate,
  CVSS 6.1, fixed only in echarts 6.1.0. Upstream is still on 5.x. Recorded in
  `UPSTREAM.md` as the next dependency task rather than moved across a major
  version inside a release.

`upstream/master` is 40 commits ahead of the recorded mirror: 36 dependency
bumps, 2 toolchain, 2 infrastructure, no product changes and no fixes to a
defect this fork carries.

## Protocol coverage

The recorded table claimed 3 of 36 readable. The manifest production serves
says 6 of 38. Regenerated from the live manifest rather than edited.

The remaining 32 are BLOCKED and recorded as such. For most of them the gap is
deployment rather than missing code: the indexer repositories exist with real
implementations, and the service is simply not configured in the overlay's
source registry on the indexer host.

## Governance

`develop` on `mempool`, `backend-apis` and `index-zcash-metaprotocols`, and
`main` on `index-doge-tap`, now require a pull request, require their repository's
full check set, require conversation resolution, dismiss stale approvals, and
refuse force pushes and deletion. Head branches are deleted on merge.

The required checks are the jobs that actually run: none of them carries a job
level `if:`, so none can report "skipped" and deadlock a merge.

## Not reached

- `index-op20` publishes no checkpoint. It is genuinely scanning, with zero
  assets, events and holders, so the production smoke check still fails on it.
- Dogecoin inscription protocols, for the reason measured above.
- The frontend visual matrix job hung once on `universe-linux-ultra-01`,
  running 112 minutes against a 100 minute timeout without being cancelled by
  the runner. It was cancelled manually and re-run.
