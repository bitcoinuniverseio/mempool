# Portfolio Intelligence 2.0

A private, multi-portfolio intelligence product for Bitcoin-native assets
and UTXOs, built on the exact-value and evidence model of the address
portfolio. Read-only: no wallet, no signing, no broadcasting, no custody.

The companion API contract lives in `bitcoinuniverseio/backend-apis`
(`src/universe-portfolio/v2/`), and its generated, source-hashed frontend
artifact is vendored at `frontend/src/app/shared/universe-portfolio-v2.types.ts`.

## Routes

| Route | Purpose |
| --- | --- |
| `/portfolio` | Product home. Onboarding when empty; locked shell when locked; last active portfolio when unlocked. |
| `/portfolio/new` | Onboarding wizard: one address, watch-only wallet, address list, or manual-only. |
| `/portfolio/manage` | Create, rename, duplicate settings, archive, restore, delete, switch. |
| `/portfolio/settings` | Vault passphrase, encrypted backup, import, complete local deletion. |
| `/portfolio/workspace` | Compatibility route: migrates the old plaintext watchlist into the vault, then redirects. |
| `/portfolio/p/:id/overview` | Value hero, coverage, allocation, change drivers. |
| `/portfolio/p/:id/holdings` | Unified holdings: table, grouping, expansion, per-location custody, collectibles gallery. |
| `/portfolio/p/:id/activity` | Portfolio-wide semantic timeline, internal transfers included as movement. |
| `/portfolio/p/:id/performance` | FIFO P&L per included account, proven history only. |
| `/portfolio/p/:id/time-machine` | Compare two historical points; exact delta decomposition. |
| `/portfolio/p/:id/utxos` | UTXO inventory, safety classification, effective value, consolidation analysis. |
| `/portfolio/p/:id/insights` | Deterministic, versioned insight rules. |
| `/portfolio/p/:id/sources` | Coverage disclosure: what every authority answered, with checkpoints. |
| `/portfolio/p/:id/reports` | Redacted report builder with exact preview. |
| `/portfolio/share/:shareId` | Client-encrypted expiring snapshot shares. |
| `/portfolio/:chain/:network/:address` | Legacy public route, rendered in ephemeral mode. Nothing is stored. |

## The vault

All private portfolio data (names, accounts, xpubs, descriptors, derived
inventories, labels, annotations, views, alert rules, snapshots, manual
positions, UTXO protection flags, share tokens) lives in a versioned
IndexedDB vault. Every record is an individually authenticated ciphertext
(AES-256-GCM via WebCrypto). The master key is derived from the
passphrase with Argon2id (hash-wasm) inside a Web Worker - with a
calibrated PBKDF2 fallback where Argon2id cannot run - imported as a
NON-EXTRACTABLE key, and never persisted. Locking, closing the browser,
or an inactivity timeout destroys it.

Backup export produces a `.universe-portfolio` file: format version, KDF
metadata, record counts, payload checksum, application release, and
migration range. Import validates the whole archive and the passphrase
before touching any local state. Browser encryption protects against
network and server compromise; it cannot protect against a fully
compromised device, and the product says so.

## Watch-only accounts

Extended public keys (xpub/ypub/zpub and testnet variants) and public
output descriptors are supported through audited libraries: @scure/bip32
for derivation, utxo-descriptors for BIP-380 parsing and checksums,
@scure/btc-signer for address encoding. Derivation runs in a worker.
Discovery scans receive and change branches with an adjustable gap limit
(default 20), is resumable and cancellable, and never reports complete if
a required address read failed.

Seed phrases, extended private keys, WIF keys, raw private-key hex, and
seed-export files are detected locally before any network request,
rejected with a safety explanation, and never echoed or retained. The
extended public key or descriptor itself never leaves the browser: only
derived public addresses are sent to the first-party portfolio API.

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

## Privacy mode

One global control with three levels: open, values hidden, presentation
(percentages only). Hidden values are absent from the DOM and the
accessibility tree: components bind masked placeholders rather than
blurring rendered numbers. Charts, exports, and reports respect the
mode.

## Local protection flags

A UTXO protection flag is a local note in the encrypted vault. It is
never presented as a wallet lock or an on-chain condition, and it exists
to warn, label, and organize. The consolidation analysis is informational
only: it never builds, signs, or broadcasts anything.

## Shares

A share encrypts a redacted snapshot in the browser with a random key,
uploads only ciphertext plus expiry metadata, and puts the key in the URL
fragment, which the server never receives. Recipients decrypt locally.
Shares expire, are revocable with the locally stored deletion token, and
the server logs neither keys nor plaintext.
