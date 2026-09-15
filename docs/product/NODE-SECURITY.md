# Node security evidence

The node-security routes retain the overview, inventory, node exposure, advisory, release, artifact and upgrade operations. All observations use the selected network backend. Missing owned fleet inventory, authenticated release manifests or advisory feeds remain explicit errors; this UI does not manufacture replacement records.

Release signatures are separate from reproducible-build verification. Per-node exposure requires the advisory's actual attack preconditions and reported build/configuration. A version string is not a vulnerability verdict. The artifact list and per-node exposure service do not yet define an implemented success schema; any future response is displayed as uninterpreted source data, without verification labels. Artifact checksum verification remains an explicit request that currently reports the missing trust source.

Upgrade assessment requires both current and target versions, and displays the actual returned canary stages, configuration changes and rollback boundary. It does not execute an upgrade. Route/network changes and input edits cancel old work and remove previous results.

The configuration page contains a Bitcoin Core29 local RPC example, not a production certification. No shared password, RPC port, memory size or daemon assumption is generated. Default cookie credentials apply only when authentication overrides are absent and the local client has the correct network/datadir access. Review effective configuration and OS permissions independently. Reference: [Bitcoin Core29 JSON-RPC security documentation](https://github.com/bitcoin/bitcoin/blob/v29.0/doc/JSON-RPC-interface.md#security).

Acceptance still requires the actual owned fleet, advisory and release authority integrations and their signatures, freshness and reproducibility evidence. The page does not establish whole-fleet GO.
