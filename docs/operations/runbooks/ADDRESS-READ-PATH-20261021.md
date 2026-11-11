# Runbook: explorer address reads fail (D04)

Status: needs owner approval for any production change. Everything in
"Diagnose" is read-only.

## Symptom

`GET /api/address/<address>` answers `502 {"code":"upstream-unavailable"}`.
Blocks, transactions and the tip keep working.

## What was verified on 21 October 2026 (read-only, from indexers-1)

| Check | Result |
| --- | --- |
| `GET 127.0.0.1:8099/api/address/<large address>` | 502 `upstream-unavailable` in 2.4 s |
| Backend mode | `MEMPOOL.BACKEND = electrum`, Electrum `127.0.0.1:50011` (Fulcrum 2.1.1), no `ELECTRUM.ADDRESS_HTTP_URL` |
| Fulcrum `server.version`, `blockchain.headers.subscribe` | answers, at the chain tip |
| Core RPC through the read-only relay (`127.0.0.1:28342`) | `getblockcount` and `validateaddress` both answer |
| Esplora REST `127.0.0.1:3301/blocks/tip/height` | 200 |
| Fulcrum `scripthash.get_balance` for the large address | non-zero balance in 0.0 s |
| Fulcrum `scripthash.get_history` for the same address | **empty list** in 1.4 s |
| Fulcrum `scripthash.get_history` for the genesis address | no answer in 20 s |

A non-zero balance with an empty history is an inconsistent source. The
backend's exact-statistics check refuses it, and the refusal is reported as
`upstream-unavailable`. Very large histories do not answer inside the budget.
The cause inside Fulcrum (history limit setting, damaged history index, or disk
latency on the HDD host) is not yet proven.

## What the code now guarantees

- Every address route answers within 20 s (`address-read-deadline.ts`); a
  late read is aborted and answered `504 address-query-timeout`.
- The page gives up at 25 s and shows a neutral, retryable state. It never
  shows server error text.

## Diagnose (read-only)

```bash
# On indexers-1, as ubuntu
systemctl status universe-explorer-backend universe-explorer-dependency-tunnel --no-pager
journalctl -u universe-explorer-backend --since '-30 min' --no-pager | grep -i address
# Which process owns the Electrum listener the backend uses
sudo ss -ltnp '( sport = :50011 )'
# Then read that Fulcrum's config (or the remote end of its tunnel) for max_history.
```

Probe one small and one large address with `blockchain.scripthash.get_balance`
and `blockchain.scripthash.get_history`. Record time and result size only.

## Fix options (owner decision)

1. If `max_history` is lower than the large addresses in use, raise it in the
   Fulcrum config on indexers-3 and restart Fulcrum in a quiet window. Fulcrum
   restarts take minutes on HDD; address pages show "temporarily unavailable"
   meanwhile, blocks are unaffected.
2. If the history index is damaged, do not reindex in place on the HDD host.
   Plan a rebuild on SSD storage first (see `INDEXERS-addendum-20261021.md`).
3. Do not add a public provider fallback.

## Verify

```bash
curl --fail --silent --show-error --connect-timeout 2 --max-time 25 \
  "https://explorer.bitcoinuniverse.io/api/address/$IDX_BTC_ADDRESS" |
jq -e --arg a "$IDX_BTC_ADDRESS" '.address == $a and (.chain_stats.tx_count | type == "number")'
```

## Rollback

Restore the previous Fulcrum config file and restart Fulcrum. The application
changes need no rollback: they only bound how long a failure takes.
