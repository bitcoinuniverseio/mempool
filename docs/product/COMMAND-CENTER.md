# Command center

One box, on every page, that knows what it was handed.

## The promise

**Turn whatever a visitor has into the page about it, and never guess which
page when the text admits more than one.**

Search boxes across the web are comfortable making a silent choice: this
hash is a transaction because transactions are more common, this address is
Bitcoin because Bitcoin is the default. The command center does not make
that choice. A 64 character hash is offered as both a transaction and a
block. An address is offered for every chain whose encoding it names. The
visitor decides; the palette only refuses to pretend.

## Opening it

- `/` from anywhere that is not a form field.
- `Ctrl K` (or `Cmd K`) from anywhere at all, including inside a field.

The palette is mounted on the master page, so both shortcuts work on every
route. On a phone it opens as a bottom sheet with the same content.

## What it recognizes

| Input | Reading |
| --- | --- |
| Transaction or block hash | Both candidates, transaction and block, side by side. |
| Block height | A block page on the chain being read. |
| Address | One candidate per chain whose encoding the prefix names, on that chain's own routes. |
| Outpoint | The outpoint page. |
| Inscription id or number | The inscription page. |
| Rune id or name | The rune page. |
| Sat number | The sat page. |
| Raw transaction hex | The raw transaction analyser. |
| PSBT | The PSBT workbench, where it is decoded locally. |
| Protocol name | The protocol page. |

Nothing is resolved by guessing. When two readings are equally plausible,
both appear.

## The query grammar

Filter terms and free text, in any order:

```
chain:bitcoin kind:rune frost height:800000-810000
feerate:1.5-20 value:1000-5000 status:pending
time:2026-01-01...2026-01-31 rank:100 source:ord source-revision
```

Terms: `chain`, `network`, `protocol`, `kind`, `operation`, `status`,
`height`, `time`, `value`, `feerate`, `source`, `freshness`, `rank`.
Values are checked, not trusted: a bad value is reported as not understood
rather than coerced into something.

Three things happen to a filter, and the difference is always visible:

1. **Enforced.** `chain` and `kind` narrow the results you see, immediately.
2. **Recorded.** The rest parse, render as chips, and travel with a shared
   link, and the palette states in one line that this deployment does not
   yet enforce them. They never pretend to have narrowed anything.
3. **Unknown.** A key the grammar does not know stays in the text where you
   can see it, and is listed as not understood. It is never silently
   dropped.

## Where results come from

Each row says its source, next to it:

- **pattern**: read locally, from the text itself. No request was made.
- **node**: a reading that the chain node will confirm when chosen.
- **index**: the first-party Universe index, with the producing authority
  named, and its freshness stated as what it is: proved as of the last
  indexed block.

When a chain's search fails, the failure is named by chain instead of
disappearing into an empty result.

## The one refusal that matters

Text that looks like key material, an extended private key, a WIF key, a
BIP38 passphrase, a twelve word phrase, is refused before any request
exists. The palette says what it refused and why, in the interface, and
nothing is sent anywhere. Batch mode applies the same rule per line, so a
careless paste cannot leak a key into a query log.

## Batch mode

One identifier per line, up to 25 per batch. Resolution happens locally
against the same grammar, results land in a table, and a batch exports as
JSON or CSV, one row per candidate. The bound is stated when a paste
exceeds it; the cut is never silent.

## Recent and saved

The last ten queries you ran and up to thirty you starred are kept on this
device, under keys only this explorer writes. They leave the browser never,
and the offline page's deletion controls remove them on request.

## QR input

A QR image can be dropped in and is decoded by the browser's own detector
where the browser provides one. Nothing is uploaded to decode. Pasting
already-decoded QR text always works.

## What this product never does

- It never picks between equally plausible readings for you.
- It never sends text that looks like key material to any server.
- It never hides a filter it did not apply, or applies one it did not
  announce.
- It never shows a failed chain as an empty result.
