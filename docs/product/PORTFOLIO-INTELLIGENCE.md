# Portfolio Intelligence 2.0

A private, multi-portfolio intelligence product for Bitcoin-native assets
and UTXOs, built on the exact-value and evidence model of the address
portfolio. Read-only: no wallet, no signing, no broadcasting, no custody.

The companion API contract lives in `bitcoinuniverseio/backend-apis`
(`src/universe-portfolio/v2/`), and its generated, source-hashed frontend
artifact is vendored at `frontend/src/app/shared/universe-portfolio-v2.types.ts`.

## Routes

| Route                                 | Purpose                                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/portfolio`                          | Product home. Onboarding when empty; locked shell when locked; last active portfolio when unlocked.                                                               |
| `/portfolio/new`                      | Onboarding wizard for one public address or an address list. Watch-only discovery and manual positions are visibly unavailable until their production paths ship. |
| `/portfolio/manage`                   | Create, rename, duplicate settings, archive, restore, delete, switch.                                                                                             |
| `/portfolio/settings`                 | Vault passphrase, encrypted backup, import, complete local deletion.                                                                                              |
| `/portfolio/workspace`                | Compatibility route: migrates the old plaintext watchlist into the vault, then redirects.                                                                         |
| `/portfolio/p/:id/overview`           | Value hero, coverage, allocation, change drivers.                                                                                                                 |
| `/portfolio/p/:id/holdings`           | Unified holdings: table, grouping, expansion, per-location custody, collectibles gallery.                                                                         |
| `/portfolio/p/:id/activity`           | Portfolio-wide semantic timeline, internal transfers included as movement.                                                                                        |
| `/portfolio/p/:id/performance`        | One FIFO P&L response per explicit public address, proven history only.                                                                                           |
| `/portfolio/p/:id/time-machine`       | Direct route for the first supported public address. The result names that exact address and does not combine the portfolio.                                      |
| `/portfolio/p/:id/utxos`              | UTXO inventory, safety classification, effective value, consolidation analysis.                                                                                   |
| `/portfolio/p/:id/insights`           | Deterministic, versioned insight rules.                                                                                                                           |
| `/portfolio/p/:id/sources`            | Coverage disclosure: what every authority answered, with checkpoints.                                                                                             |
| `/portfolio/p/:id/reports`            | Direct route for a local redacted holdings preview, print view, and matching CSV.                                                                                 |
| `/portfolio/share/:shareId`           | Reserved route that states sharing is unavailable and performs no share request.                                                                                  |
| `/portfolio/:chain/:network/:address` | Legacy public route, rendered in ephemeral mode. Nothing is stored.                                                                                               |

## The vault

Saved portfolio records, explicit public address lists, names, labels,
annotations, and local settings live in a versioned IndexedDB vault. Every
record is an individually authenticated ciphertext (AES-256-GCM via
WebCrypto). The master key is derived from the
passphrase with Argon2id (hash-wasm) inside a Web Worker - with a
calibrated PBKDF2 fallback where Argon2id cannot run - imported as a
NON-EXTRACTABLE key, and never persisted. Locking, closing the browser,
or an inactivity timeout destroys it.

Backup export produces a `.universe-portfolio` file: format version, KDF
metadata, record counts, payload checksum, application release field, and
migration range. New exports use format version 2, whose checksum binds each
record identifier, type, nonce, and ciphertext. Import still accepts version 1
through its ciphertext-only checksum so existing backups remain usable. Before
key derivation, import rejects values outside the supported Argon2id memory,
time-cost, and parallelism ranges or the supported PBKDF2 iteration range.
Import then checks record decryptability before replacement begins.

Import replacement commits the complete record set and vault metadata in one
IndexedDB readwrite transaction. The in-memory key and metadata change only
after that transaction commits, so an aborted or failed replacement leaves the
previous vault usable. Passphrase rotation likewise prepares every replacement
ciphertext first and then commits the records and metadata together while
retaining the old key on failure. The separate legacy workspace migration still
performs several vault writes and documents that narrower consistency boundary.
Browser encryption protects against network and server compromise; it cannot
protect against a fully compromised device, and the product says so.

## Watch-only accounts

The codebase contains local parsing and derivation primitives for extended
public keys and output descriptors, but production onboarding does not yet
run a complete address discovery flow. The controls stay disabled with a
visible explanation. Existing records without a derived address inventory
are reported as unavailable and never as zero. Use explicit public addresses
or an address list in this release.

Seed phrases, extended private keys, WIF keys, raw private-key hex, and
seed-export files are detected locally before any network request,
rejected with a safety explanation, and never echoed or retained. Extended
public key and descriptor discovery is unavailable in this release, so no
discovery material is sent to the portfolio API.

Manual position fields are reserved in the local data model, but there is no
creation, editing, or aggregation path in this release. Manual onboarding is
disabled and manual positions are not included in totals.

## Truthfulness rules

- Every quantity, price, and total is an exact decimal string. Floating
  point never touches a balance.
- The seven source states (proven, partial, outside_coverage, pending,
  stale, unavailable, unsupported) are never collapsed to zero.
- Historical reconstruction never silently falls back to current
  holdings; gaps stay gaps, and protocol history is named as outside
  coverage rather than inferred.
- Internal transfers between included accounts are movement, not
  economic inflow or outflow; fees stay costs.
- Duplicate addresses are counted once; an explicit inclusion policy
  resolves which account owns them.
- Unpriced holdings keep their exact quantities and are excluded from
  the priced subtotal, visibly.

## Value privacy

One session control switches between values shown and values hidden. Hidden
text values use placeholders, report output uses percentages where a priced
total exists, and the overview chart receives no series, axis data, or
tooltip values. Names and public identifiers remain visible. This is a
display mask, not access control or encryption.

## Local protection flags

A UTXO protection flag is a local note in the encrypted vault. It is
never presented as a wallet lock or an on-chain condition, and it exists
to warn, label, and organize. The consolidation analysis is informational
only: it never builds, signs, or broadcasts anything.

## Shares

Sharing is unavailable in this release. There is no share creation, upload,
lookup, decryption, or revocation path. The reserved share route displays an
unavailable notice and sends no request.

## Navigation and availability

Overview, holdings, activity, per-address performance, UTXOs, and insights
appear in the portfolio shell. Time Machine, sources, and reports have direct
routes but no shell navigation entry. API-backed pages report unavailable or
partial evidence when their required read fails. They do not present a failed
request as an empty successful result.

A saved-account deep URL initializes the local vault before rendering. If the
vault is locked, the router preserves that local URL while the product requests
the passphrase, then returns to the requested portfolio and section after a
successful unlock. Unknown local portfolio identifiers return to the manage
page instead of opening another portfolio under the wrong URL.

Portfolio controls use a 44 by 44 CSS-pixel target floor. At compact widths,
text inputs, date inputs, text areas, and selects compute to at least 16 CSS
pixels so mobile Safari does not zoom the layout when a field receives focus.
