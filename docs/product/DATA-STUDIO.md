# Owned Data Studio

The real dataset authority captures the latest32 canonical raw block headers and, when no more than10000 transactions exist, the complete owned mempool transaction-ID set. Each immutable SHA256 snapshot records selected network, verified genesis, source tip, observation time, mempool sequence and coverage. Header fields derive from raw80-byte headers whose hashes match the requested identities. No wallet, broadcast, mining, arbitrary SQL, server-path or caller-selected RPC operation is exposed.

## API and formats

- `GET /api/v1/data/catalog`: actual manifests, exact row counts, export bytes/digests, source coverage and executable stream/MCP declarations.
- `POST /api/v1/data/query`: typed projections, equality/range/membership filters, stable ordering and pagination. Include the catalog's `snapshotId` for immutable pagination. Responses contain filtered `totalAvailable`, returned `rowCount`, `nextOffset`, network and provenance.
- `GET /api/v1/data/mcp`: implemented tool declarations and transport endpoint.
- `GET /api/v1/data/export/:snapshot/:dataset?format=ndjson`: exact full dataset in JSON, NDJSON or CSV, independent of current query filters. Content-Length, X-Dataset-Rows, X-Content-SHA256 and ETag match the response bytes.
- `GET /api/v1/data/live/snapshots`: actual persisted snapshot SSE events. Last-Event-ID or cursor resumes within retained coverage.
- `POST /api/v1/data/mcp/rpc`: stateless MCP2025-03-26 initialize, ping, tools/list and tools/call for `data_catalog` and `data_query`. Accepted notifications receive202; GET receives405 because MCP server-initiated SSE is not offered here.

The MCP implementation follows the primary [Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) and [tool contract](https://modelcontextprotocol.io/specification/2025-03-26/server/tools). An Origin must match loopback host/port or an exact comma-separated `UNIVERSE_DATA_MCP_ORIGINS` entry. No-Origin native clients read the same public datasets. No caller code is executed.

```json
{"datasetId":"bitcoin.blocks","snapshotId":"<catalog SHA256>","fields":["height","hash"],"filters":[{"field":"height","operator":"gte","value":100}],"orderBy":"height","orderDirection":"desc","limit":20,"offset":0}
```

## Persistence and bounds

Set `UNIVERSE_DATA_STUDIO_PATH` to override `<CACHE_DIR>/data-studio/<network>.json.gz`. Storage is lazy; importing the service captures nothing. Checksummed gzip state is atomically persisted before event publication. Limits:8 snapshots,64 persisted events,32MiB state,1000 query rows/page, offset10000,8 filters and50 membership values. Wrong types, fields, properties, operators and bounds return400. Unknown/pruned snapshot IDs and foreign/expired cursors return410.

A lifetime exclusive writer lock prevents overwrite by another process. Configured cluster workers use stable worker-specific files and the primary does not write. Use consistent routing for snapshot queries/downloads/cursors; this is not shared distributed storage. Restart validates network, schema, checksums, every record and snapshot digest. The shared HistoryStore reclaims only conclusively dead same-host writers; normal exit releases the lock.

Restart emits `observation_gap` before the next snapshot. Intermediate node changes during downtime are unobserved. Collection occurs on reads and while clients connect, not continuously without consumers. SSE supports20 concurrent clients,64KiB backpressure,5-minute connection lifetime and shared30-second cache. The browser retains20 received events. Source capture has a15-second caller deadline and singleflight prevents duplicate collection. Oversized mempools are unavailable independently; header exports remain useful. Mempool size is checked before fetching transaction IDs.

## UI and remaining acceptance

`/data` binds queries/downloads to a snapshot and clears stale query results on control/backend changes. `/data/live` connects a real EventSource and shows actual connection state, received events and gaps. Message rate remains unmeasured.

Parquet, full historical blockchain/protocol datasets, SQL grammar, WebSocket transport, complete transaction-by-transaction durable history and shared distributed storage remain open original requirements. Bounded snapshot capability does not establish catalog completeness or full release GO.

Source bracket: initial and final getblockchaininfo must both name the expected Core chain (main/test/testnet4/signet/regtest), report initialblockdownload strictlyfalse, and agree on exact numeric height and best block hash. Missing or malformed synchronization metadata fails closed.
