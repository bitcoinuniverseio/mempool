# Legacy branch classification

Four branches predate the current integration flow and were named in the
release contract as needing a verdict. Each was compared against `develop`
at `39e420cf3` on 2026-08-31. None carries work that is missing from
`develop`. Per the closure rules they stay in place until release closure,
at which point this file is the deletion evidence.

## ci/capacity-router-20260830 (`f4db1a47b`, 1 ahead / 69 behind)

Routes every workflow job through a `route` job that calls the private
reusable workflow `.github-private/.github/workflows/route.yml` with
`secrets: inherit`, then rewrites `runs-on` from the router's output.

**Verdict: superseded, with one part deliberately rejected.**

- The label changes themselves are already on `develop`: `ci.yml`,
  `backend-integration.yml`, `docker.yml`, `e2e_parameterized.yml` and the
  other upstream workflows now target the RunsOn Spot expression
  (`runs-on=<run_id>-<job>/runner=universe-hosted/...`), and
  `universe-ci.yml` pins its jobs to the self-hosted fleet with
  `mobile-engines` on RunsOn. Compare the branch diff to the same files on
  `develop`: every `runs-on` value the branch introduces is present.
- The router mechanism is not ported, on purpose. A public repository
  cannot call a private reusable workflow: the run dies at
  `startup_failure` before any job exists, which is exactly what took
  `backend-apis` down on 2026-08-30. It also violates the shared-actions
  policy (no private references from public repositories, no
  `secrets: inherit`). The routing intent lives on as static per-job
  targets instead of a single point of failure.

## add-utxo-endpoint (`b92414245`, 1 ahead / 952 behind)

Fixes double hashing in the Electrum adapter: `/scripthash/:hash/utxo`
passed an already encoded scripthash into a helper that encoded it again.

**Verdict: superseded.** `develop` carries the identical fix.
`backend/src/api/bitcoin/electrum-api.ts` encodes the script at the
caller (`$getAddressUtxos`, lines 150 to 156) and
`$getScriptHashUtxos` takes the encoded hash as given.

## feature/transaction-details-toggle (`acdec5ef4`, 2 ahead / 328 behind)

Persists the transaction page Details toggle in a `showDetails` query
parameter so a shared link opens with details visible.

**Verdict: superseded.** `develop`'s
`frontend/src/app/components/transaction/transaction.component.ts` reads
`showDetails` from the route snapshot on init, and `toggleDetailsFromTxPage`
writes it back with `queryParamsHandling: 'merge'` and `replaceUrl`. Same
behaviour, current code.

## add-enterprise-navlink (`3a5733cfe`, 2 ahead / 1327 behind)

Adds the upstream enterprise logo and link to the top navigation.

**Verdict: obsolete by scope.** This fork removed the hosted enterprise
surface entirely: `enterprise.service.ts` is a no-op, the sponsor and
accelerator components are deleted, and the navigation registry has no
enterprise destination. A link advertising the upstream vendor's paid
service has no place in Bitcoin Universe navigation and there is nothing
to port.
