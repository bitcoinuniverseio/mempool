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

- The old provider targets have since been replaced by direct, explicit GCP
  class labels. Every elastic job now stays on the Universe-owned ephemeral
  GCP platform.
- The local router adapter had no repository or organization consumers and
  still advertised the retired provider path. It was removed on 2026-09-03.
  Static per-job GCP labels keep routing visible and avoid a private reusable
  workflow dependency from this public repository.

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
