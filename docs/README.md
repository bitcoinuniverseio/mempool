# Documentation

Everything in this repository that is not source code. Start from the question
you actually have.

## I want to run this

| Question | Document |
| --- | --- |
| What do I need, and how do I build and start it? | [`operations/INSTALL.md`](operations/INSTALL.md) |
| What does every configuration key do? | [`operations/CONFIGURATION.md`](operations/CONFIGURATION.md) |
| How is the Universe deployment put together? | [`operations/DEPLOYMENT.md`](operations/DEPLOYMENT.md) |
| Something is broken. What do I check? | [`operations/RECOVERY.md`](operations/RECOVERY.md) |
| How is a release cut, and what does `universe-2026.08.29.2` mean? | [`operations/RELEASING.md`](operations/RELEASING.md) |

## I want to integrate with it

| Question | Document |
| --- | --- |
| What endpoints exist, and which process answers each? | [`api/HTTP-API.md`](api/HTTP-API.md) |
| What will the explorer claim about an asset, and what will it refuse to claim? | [`data/ASSET-EVIDENCE.md`](data/ASSET-EVIDENCE.md) |
| How are reorgs and checkpoints handled? | [`data/CHECKPOINTS-AND-REORGS.md`](data/CHECKPOINTS-AND-REORGS.md) |
| Which protocols can actually be read? | [`protocols/PROTOCOL-COVERAGE.md`](protocols/PROTOCOL-COVERAGE.md) |
| What does the address portfolio surface do? | [`product/ADDRESS-PORTFOLIO.md`](product/ADDRESS-PORTFOLIO.md) |

## I want to understand the design

| Question | Document |
| --- | --- |
| How is the product put together, and why? | [`architecture/UNIVERSE-PROTOCOL-EXPLORER.md`](architecture/UNIVERSE-PROTOCOL-EXPLORER.md) |
| Why is the protocol layer a separate service? | [`architecture/ADR-PROTOCOL-OVERLAY.md`](architecture/ADR-PROTOCOL-OVERLAY.md) |
| What is the interface held to? | [`product/DESIGN-SYSTEM.md`](product/DESIGN-SYSTEM.md) |
| What was this product built to do? | [`product/EXPERIENCE-BRIEF.md`](product/EXPERIENCE-BRIEF.md) |

## I am reviewing it

| Question | Document |
| --- | --- |
| What does this deployment assume about trust? | [`security/THREAT-MODEL.md`](security/THREAT-MODEL.md) |
| How are the AGPL obligations met? | [`legal/AGPL-COMPLIANCE.md`](legal/AGPL-COMPLIANCE.md) |
| Which upstream trademarks were removed, and from where? | [`legal/TRADEMARK-AUDIT.md`](legal/TRADEMARK-AUDIT.md) |
| What was measured before a release shipped? | `operations/RELEASE-EVIDENCE-<date>.md` |
| What is the fork's exact relationship to upstream? | [`../UPSTREAM.md`](../UPSTREAM.md), and [`operations/UPSTREAM-SYNC.md`](operations/UPSTREAM-SYNC.md) |

## Reference material

`research/` holds the market and competitive work the product was designed
against, with its sources recorded in `research/source-ledger.md`. It is
background, not a specification.

`operations/BRANCH-CLASSIFICATION.md` records what the repository's legacy
branches contain, so nobody has to re-derive it.

`protocols/PROTOCOL-COVERAGE.json` is the pinned copy of the protocol roster
owned by `bitcoinuniverseio/backend-apis`, and
`protocols/PROTOCOL-ROSTER.lock` is what holds the pin honest.

## Governance

[`../README.md`](../README.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md),
[`../SECURITY.md`](../SECURITY.md), [`../SUPPORT.md`](../SUPPORT.md),
[`../LICENSE`](../LICENSE), [`../COPYING.md`](../COPYING.md).

`docs.manifest.json` at the repository root is what the documentation portal at
docs.bitcoinuniverse.io reads to ingest this repository. It declares the
release, the chains, the protocols, the specifications, and the public status
endpoints. Update it when any of those change.
