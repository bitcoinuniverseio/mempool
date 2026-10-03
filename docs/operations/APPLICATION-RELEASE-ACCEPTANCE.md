# Application release acceptance

The protocol manifest covers declared protocol reads. A release also needs acceptance for the complete application operation roster. Source review, build results and component checks do not establish functional acceptance.

The artifact workflow, packed-archive verifier and `release.sh` cutover require both gates. An unresolved denominator, missing receipt or mismatched candidate stops release before cutover. Emergency rollback retains its existing recovery behavior.

The application gate reads these files from the candidate:

- `docs/acceptance/reconciled-operations.json`: a versioned semantic successor preserving every historical candidate, its evidence and its reviewed mapping or justified exclusion. Its denominator must be reconciled and have no unresolved candidates. A partial review belongs in private working evidence and cannot qualify this file.
- `docs/acceptance/qualified-application-evidence.json`: an `universe-application-acceptance-v1` envelope binding the raw roster and protocol acceptance digests, exact candidate identity and frontend/backend/gateway/overlay artifact and configuration identities. The first three source revisions must equal the release commit; the overlay revision must equal the pinned protocol source revision.
- Every envelope-named receipt under a plain `docs/` path. These raw bytes are checked, staged and verified again after archive extraction. Conflicting existing stage bytes are refused.

Each operation needs a `universe-functional-operation-receipt-v1` record that binds its exact entry point, method, role, chain, network, input/output contracts, lifecycle and specification revision. It also binds the candidate and component identities, command, environment and execution time. Every required assertion needs an observed passing result. Execution, authoritative readback, consumer behavior and refresh/recovery must each pass with observations. A PASS label or a component-test receipt is insufficient.

Functional qualification uses Signet or an explicitly justified supported non-mainnet context. A different chain cannot qualify a chain-specific operation. Local/offline qualification applies only to chain-independent local behavior or the canonical static protocol registry read. Mainnet functional tests are refused by this gate; deployment configuration proof remains separate.

Run the carried verifier with the artifact's own evidence root:

```sh
node scripts/universe/reconciled-release.mjs check \
  docs/acceptance/reconciled-operations.json \
  docs/acceptance/qualified-application-evidence.json \
  docs/acceptance/qualified-release-evidence.json \
  "$PWD" "$RELEASE_COMMIT"
```

`stage` takes the same arguments followed by an existing staging directory. It validates the complete receipt set before copying. Controlled regression fixtures exercise admission and refusal; they are not genuine application acceptance and must never be promoted to release evidence. Keep credentials, private source and sensitive operational details out of publishable receipts.
