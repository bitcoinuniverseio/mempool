# Signet validation runtime

The isolated Signet explorer used for functional acceptance on the workspace
host. It runs the real backend, the real gateway and the real frontend build
against a Universe-owned Signet node and Esplora index. Nothing here is a
production deployment.

## Layout

Runtime state lives outside the Git checkout, in the project runtime
directory required by the workspace layout:

```text
D:\universe\mempool\.runtime\signet\
  mempool-config.signet.json   backend configuration (Signet, Esplora, database mempool_signet)
  rpc.cookie                   current Core RPC cookie, kept fresh by rpc-cookie-sync
  cache\                       backend disk cache
  logs\backend-signet.log      rotating, 50 MB x 5
  logs\cookie-sync.log         rotating
  logs\gateway.log             rotating
  pids.json                    wrapper process ids and start time
```

## Upstreams

| Service | Where | Local endpoint |
| --- | --- | --- |
| Bitcoin Core (Signet) | universe-indexers-2, `universe-bitcoin-signet` | ssh tunnel `127.0.0.1:38335` to `127.0.0.1:38332` |
| Esplora (electrs) | universe-indexers-2, `universe-explorer-electrs-signet` | ssh tunnel `127.0.0.1:3022` |
| MariaDB `mempool_signet` | universe-indexers-2 | ssh tunnel `127.0.0.1:33307` |

The tunnels use the deploy key over the VPN or the host address; the
backend only ever talks to loopback.

## Credentials that survive a node restart

Bitcoin Core rewrites `.cookie` on every restart. A copy taken once stops
working at the next restart and the backend then answers `503` on fees and
falls behind the tip while logging `401` on every loop. The JSON-RPC client
re-reads its cookie file after a `401`, so the only requirement is a copy
that follows the node:

```bash
node scripts/universe/rpc-cookie-sync.mjs \
  --ssh root@production-backend.netbird.cloud \
  --identity ~/.ssh/universe-deploy-20260831-ed25519 \
  --remote /var/lib/bitcoind-signet/signet/.cookie \
  --local D:/universe/mempool/.runtime/signet/rpc.cookie \
  --interval 30
```

The script writes the cookie bytes exactly as Core does (no trailing
newline, the client sends the file content as the auth string), only when
the value changed, and never prints it. On Git Bash set
`MSYS_NO_PATHCONV=1` so the remote path is not rewritten.

## Bounded logs

Every long-running process is started through `run-logged.mjs`, which
rotates the combined output at a byte ceiling and keeps a fixed number of
older files:

```bash
node scripts/universe/run-logged.mjs --log D:/universe/mempool/.runtime/signet/logs/backend-signet.log \
  --max-bytes 52428800 --keep 5 -- node --max-old-space-size=2048 dist/index.js
```

The previous runtime wrote to one redirected file that reached 16 GB in five
days, most of it repeated stall lines from leaked watchdog timers. That leak
is fixed (`$updateBlocks` and `$updateMempool` release their timer and disk
cache lock in a `finally`), and the wrapper caps what any future fault can
write.

## Starting

```powershell
$rt = "D:\universe\mempool\.runtime\signet"; $wt = "D:\universe\mempool\mempool"
$env:MEMPOOL_CONFIG_FILE = "$rt\mempool-config.signet.json"
Start-Process node -WorkingDirectory "$wt\backend" -ArgumentList "$wt\scripts\universe\run-logged.mjs --log $rt\logs\backend-signet.log -- node --max-old-space-size=2048 dist/index.js"
$env:UNIVERSE_GATEWAY_BACKEND_SIGNET = "http://127.0.0.1:8997"
$env:UNIVERSE_GATEWAY_ESPLORA_SIGNET = "http://127.0.0.1:3022"
$env:UNIVERSE_GATEWAY_PORT = "8099"
$env:UNIVERSE_GATEWAY_ROOT = "$wt\frontend\dist\mempool\browser"
Start-Process node -WorkingDirectory $wt -ArgumentList "$wt\scripts\universe\run-logged.mjs --log $rt\logs\gateway.log -- node scripts/universe/gateway.mjs"
```

The app is then at `http://127.0.0.1:8099/signet`.

## Proving the served state before testing

```bash
node scripts/universe/acceptance-preflight.mjs --origin http://127.0.0.1:8099 --network signet audits/preflight-signet.json
curl -s http://127.0.0.1:8099/signet/api/v1/backend-info      # gitCommit, chainSync
curl -s http://127.0.0.1:8099/signet/api/blocks/tip/height     # must equal the Esplora tip
curl -s http://127.0.0.1:3022/blocks/tip/height
curl -s http://127.0.0.1:8099/signet/api/v1/fees/recommended   # 200 once the mempool is in sync
```

`backend-info.gitCommit` is the served revision, `chainSync` is the node the
backend reads, and the database namespace is `DATABASE.DATABASE` in the
config file. Record all three with every piece of evidence.

## Wallet and funds

A descriptor wallet `mempool-audit-20260915-0436` exists on the Signet node
(`load_on_startup=false`), first address
`tb1qy0swjglf4nw5cac2kh3nh7y09dkevedl7cfuta`. Public Signet faucets sit
behind CAPTCHAs that the automation must not bypass; funding remains a
human step until an owned faucet exists.
