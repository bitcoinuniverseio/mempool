# Owned-node RPC pool limits

`CORE_RPC.MAX_SOCKETS` bounds the existing bulk/node pool between 1 and 8.
`CORE_RPC.ADDRESS_MAX_SOCKETS` bounds its separate interactive address pool between
1 and 4. Omitted values preserve the existing defaults of 8 and 4. Explicit
fractions, strings, null, zero and out-of-range values fail configuration loading.
The endpoint, cookie authentication, keep-alive, cancellation and whole-operation
deadlines are unchanged.

For the isolated Signet fee qualification profile, set both limits to 1. One
interactive connection remains available while the bulk connection is occupied;
the two existing agents together admit at most two connections to the owned Core.
This is a per-process bound, not a substitute for the shared node's global budget.

That qualification profile disables the second-node minimum-fee reader, limited
GBT, database, Lightning and wallets. Its second-node client creates an agent but
does not open a socket: mempool and block-template reads are gated by
`USE_SECOND_NODE_FOR_MINFEE` and `limitGBT`. Bootstrap operator jobs require the
disabled durable store before creating their separate long-timeout client. No
bootstrap worker should be started and no other consumer of that node is stopped.
The profile owns one loopback backend, reuses the existing Signet Core/Electrs,
and writes only its dedicated cache. Database/statistics-disabled qualification
does not establish historical or protocol capabilities for public release.
