# Portfolio workspace compatibility route

`/portfolio/workspace` is a migration route for the explorer's earlier
plaintext watchlist. It is not a standalone portfolio workspace.

## What the route does

When the encrypted vault is unlocked, the route reads
`universe.portfolio.watchlist.v1` from local storage and previews the number
of valid addresses, labels, and groups it found. Invalid legacy rows are
ignored.

Choosing **Migrate now** creates a saved portfolio, groups valid addresses by
chain and network, preserves group names, records address labels as local
annotations, marks the migration complete, and redirects to the saved
portfolio. The legacy plaintext key is retained. The migration performs
several vault writes and does not offer transactional rollback if a later
write fails.

Choosing **Skip for now** redirects without importing or marking the
migration complete. If migration was already marked complete, the route
redirects immediately. A locked vault shows an unlock instruction.

## Current boundaries

This route does not provide a general CSV or JSON importer, watch-only key or
descriptor discovery, manual positions, report creation, or portfolio
sharing. Those features are not implied by the legacy import helpers that
remain in the codebase.

Use `/portfolio/new` to enter one explicit public address or paste an address
list. Use `/portfolio/settings` for encrypted vault backup and import. Saved
portfolio views live under `/portfolio/p/:id/*`.
