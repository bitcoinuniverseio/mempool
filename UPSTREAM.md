# Upstream base

This repository is the Bitcoin Universe fork of the Mempool Open Source Project.

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/mempool/mempool |
| Upstream release | v3.3.1 |
| Upstream tag object | ce1f34a221fa0e1fc914947d5c0e0fe5b942ff11 |
| Upstream base commit | 9332d9db97bcc7beed079acc8f79aa21c9b12a3b |
| Upstream master at fork time | 63b89613b912063332cb0461dabeb209166c283e (2026-08-25) |
| Fork date | 2026-08-26 |
| Fork repository | https://github.com/bitcoinuniverseio/mempool |
| Integration branch | develop |
| Protected branch | main |

## Base selection rationale

v3.3.1 is the latest stable upstream release (published 2026-04-21). v3.4.0 exists
only as an alpha prerelease. GitHub lists no published security advisories for the
upstream repository at fork time. The `master` branch carries ~4 months of
unreleased work; it was not selected because the release gate requires a base that
passes the complete upstream test suite as a known-stable reference point.

## Remote configuration

- `origin`  = https://github.com/bitcoinuniverseio/mempool.git (Bitcoin Universe fork)
- `upstream` = https://github.com/mempool/mempool.git (push disabled locally)

The complete upstream Git history and all upstream tags are preserved in this fork.

## Modified subsystems

Universe modifications are tracked here as they land. See `docs/architecture/` for
the overlay architecture and `docs/operations/UPSTREAM-SYNC.md` for the
synchronization procedure.

| Subsystem | Nature of modification |
| --- | --- |
| (none yet) | Fork base just established |

## Known upstream conflicts

None recorded yet.
