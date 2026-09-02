# Transaction workbench

Read a transaction, or a transaction somebody is about to sign, field by
field. In the browser. No account, no upload, no signing.

## The promise

**Hand this page a file you are about to put a key to, and it will tell you
everything the file contains, prove it changed none of it, and be unable to
sign it even if you asked.**

The last clause is the product. A tool that could sign is a tool whose
promise rests on it choosing not to. There is no signing code on these
pages, no key of any kind reaches them, and a paste that looks like secret
key material is refused before it is parsed.

## Routes

| Route | Purpose |
| --- | --- |
| `/tools/psbt` | The PSBT reader. Every record, the money, the signers, and a byte for byte round trip. |
| `/tools/transaction` | The raw transaction analyser. Resolves to `/tx/preview`, which is the same page under its older address. |

`/tools/transaction` is a redirect rather than a second component. The raw
analyser has lived at `/tx/preview` since before there was a tools section,
and two copies of a decoder are two answers that can disagree.

## What the PSBT reader shows

### Every record, including the ones it cannot name

A PSBT carrying a proprietary field from another tool is a valid PSBT. A
reader that drops the field cannot tell its owner what the file actually
holds. Every record keeps its exact bytes, named where the specification
names it and marked as unnamed where it does not.

Written back out, the reader reproduces the file byte for byte. That claim
is checked on every read and stated on the page, and the save control is
unavailable when the check does not pass, because a file this page wrote
that differs from the file it read is not one to keep.

### Both container versions

Version 2 is a different container, not a variant of version 0. It has no
unsigned transaction; its inputs and outputs describe themselves. A reader
written only for version 0 does not fail on a version 2 file, it reports an
empty one, which is worse. Each version is read on its own terms.

### The money

Amounts are exact integers from the first byte to the last. A satoshi total
for a large transaction passes the range a double holds exactly, and a fee
derived from two rounded totals is a wrong fee presented with the confidence
of a right one.

An amount the file does not carry is absent, not zero. A PSBT is allowed to
omit the previous output of an input, and a reader that fills that gap with
zero reports a fee far larger than the real one. Every gap is named, the row
says which record was missing, and no fee is stated at all while one remains.
A partial sum is still shown, labelled as covering some of the inputs rather
than all of them.

The same applies when the outputs pay more than the inputs hold. That file is
incomplete or wrong, and the page says so instead of showing a negative fee.

### Who has to sign

Derivation records name a wallet by its master fingerprint and a position by
its path. Taproot derivations also name the script paths they cover. This is
what tells a signer whether a file is addressed to it. None of it can produce
or recover a key, and nothing here tries to.

### What each signature would commit to

A sighash flag is the difference between a signature that commits to a
transaction and one that commits to a fragment of it. Every flag in the file
is named and explained in words, in front of whoever is about to sign, before
they sign. `SINGLE` and `NONE` and `ANYONECANPAY` are each described by what
they leave changeable, not by their name alone.

### What changed between two files

Compare a file with itself after a signer touched it. The comparison is on
the container rather than on the transaction inside it, because that is where
signing shows up: a signed file differs from its unsigned self by the records
that were added, and seeing exactly those is how someone confirms a signer did
what it said and nothing else.

## Input

Paste base64 or hexadecimal, open a `.psbt` file, or drop one on the page.
Raw bytes and base64 text are both read; the file's first bytes decide which
it is, not its extension.

## The boundary

- **It cannot sign.** No signing code, no key material, no path to either.
- **It sends nothing.** Reading a file makes no request of any kind.
- **It stores nothing.** Leaving the page discards what was in the boxes.
- **It alters nothing.** What it reads, it can write back byte for byte.
- **It refuses secrets.** An extended private key, a wallet import format
  key, or a recovery phrase is recognised by shape and refused before
  anything else happens, and the box is cleared, because leaving a seed
  phrase on screen after refusing it would defeat the refusal.

## Accessibility

Every table carries the same numbers the summary does. Nothing is stated by
colour alone: a row whose value is missing says so in words in its own cell,
and the tint beside it is a second signal. Long values are shortened for
display with their full byte length beside them.
