# Owned bootstrap observations

The overview, node and chainstate reads query the configured Bitcoin Core node. They check selected-network genesis, blockchain identity, active-chainstate ordering, snapshot base, headers and the final tip before returning evidence. Calls are deduplicated and bounded by a ten-second response deadline. These reads never invoke `dumptxoutset` or `loadtxoutset`.

RPC help reports method availability; it does not authorize execution. Compiled AssumeUTXO heights are unknown because these RPCs do not expose the pinned chain parameters. The snapshot catalogue remains explicitly unavailable. Caller-provided checksums do not authenticate snapshot files, producers or compiled commitments.

The UI refreshes every fifteen seconds and clears observations on network changes or source failures. Core's verification progress is an estimate, not a completion-time forecast. Reported disk usage covers block/undo data, not total node disk or free capacity. A single chainstate during IBD is not labeled fully synchronized.

Validation includes inconsistent network/tip/height/progress fixtures, real owned Signet HTTP observations, and browser lifecycle tests. Full trusted-snapshot distribution, byte verification, durable operator jobs, snapshot loading and measured bootstrap completion remain open acceptance gates.

RPC semantics: [Bitcoin Core getchainstates](https://bitcoincore.org/en/doc/29.0.0/rpc/blockchain/getchainstates/) and [getblockchaininfo](https://bitcoincore.org/en/doc/29.0.0/rpc/blockchain/getblockchaininfo/).
