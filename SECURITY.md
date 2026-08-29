# Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository:

**https://github.com/bitcoinuniverseio/mempool/security/advisories/new**

It is enabled here, it is private to the maintainers until an advisory is
published, and it is the only reporting channel this project has. This
repository's issue tracker is turned off, so there is no public place to file
one by accident.

Please do not put a suspected vulnerability in a pull request, a commit
message, or a pull request comment. All three are public the moment they are
written.

## What to include

Enough to reproduce it, and nothing more than you are comfortable sending:

- what you did, against which URL or endpoint, and what happened;
- what you expected instead, and why the difference matters;
- the commit or the deployed build if you know it. The build the public site is
  serving is in `GIT_COMMIT_HASH` at
  [/resources/config.js](https://explorer.bitcoinuniverse.io/resources/config.js).

No proof of exploitation is needed. A clear description of the flaw is enough,
and we would rather you stop at the point where you are confident than go
further to demonstrate impact.

## What is in scope

This repository is the explorer: the Angular frontend, the backend it is forked
from, the gateway in `scripts/universe/`, and the deployment at
[explorer.bitcoinuniverse.io](https://explorer.bitcoinuniverse.io).

`docs/security/THREAT-MODEL.md` records the trust boundaries this deployment
assumes, and is the right thing to read first if you are unsure whether
something is a finding or a stated boundary. The explorer reads from
first-party nodes and indexes only, and a report about one of those services
belongs here too, because this is where the boundary is documented.

Findings in the upstream project that this fork inherits unmodified are better
sent to [mempool/mempool](https://github.com/mempool/mempool) as well, so the
fix reaches everyone running it. `UPSTREAM.md` records which subsystems this
fork changes and which it takes as they are.
