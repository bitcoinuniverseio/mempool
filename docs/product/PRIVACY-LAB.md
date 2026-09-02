# Privacy lab

What a transaction's shape gives away. Not who made it.

## The promise

**Show what an observer can work out from one transaction, say how they would
work it out, and say what would make them wrong.**

The last clause is the product. Every tool of this kind produces a list of
inferences. What almost none of them produce is the conditions under which
each inference fails, which is the only thing that lets a reader argue with
one.

## Routes

| Route | Purpose |
| --- | --- |
| `/labs/privacy` | Entry. A transaction id, or raw hexadecimal. |
| `/labs/privacy/:txid` | The report for one transaction. |

## Two ways in, and the difference matters

**A transaction id** is fetched from this node. One request for one
transaction, and no record kept of who asked.

**Raw hexadecimal** is decoded in the browser and makes no request at all.
That is the path for a transaction that has not been broadcast and should not
be. Nothing typed into that box leaves the page.

Either way every rule runs in the browser. There is no analysis endpoint, no
stored transaction, and no address profile anywhere.

## What every finding carries

- a rule id that stays stable across releases, so a saved finding keeps
  meaning;
- one plain sentence, no jargon;
- the technical statement of what was measured;
- the exact evidence, with the numbers;
- how far it is from a fact: measured, likely, or an assumption;
- when the rule fires and is wrong;
- when the rule stays quiet and something was revealed anyway;
- the revision of the rule set that produced it.

## Silence is reported

A rule that finds nothing is listed with the reason it found nothing. A report
showing three findings out of fifteen rules says something different from one
showing three out of three, and collapsing the two would let an absence of
evidence read as evidence of privacy.

## The rules

Grouped by what they read.

**Linkage.** Common input ownership, which is stated as the assumption it is.
Address reuse, which is the one link that needs no inference at all.
Consolidation, which joins its inputs with no change output to soften the
claim.

**Change identification.** Script type, where one output matches the input
type and one does not. Round amounts, where a person typed one number and
arithmetic produced the other. The unnecessary input heuristic, where one
input alone already covered an output so the rest were surplus.

**Structure.** Equal outputs, the shape of a collaborative spend. Fan out,
which shows every recipient what the others were paid. Peel chains, which one
transaction can never confirm and this rule says so. Single output
transactions, which have no change to find, reported as being in the
transaction's favour.

**Fingerprints.** Mixed input types. Lock time, including whether it sits in
the anti fee sniping window. The replacement signal and the exact sequence
value, which differs by wallet. Transaction version, silent on version 2
because version 2 is the crowd.

**Cost.** Dust outputs, which are usually markers rather than payments, and
which link whatever they are later swept with.

## What it will not do

- **It does not name anyone.** No owner is inferred, no address is labelled,
  and no identity is attached to anything.
- **It has no risk score.** No watch list, no notion of a suspicious
  transaction, no criminality. Those are judgements about people.
- **It uses no outside source.** No third party API, no enforcement data, no
  OSINT. Every rule reads the one transaction in front of it.
- **It stores nothing.** What is pasted is discarded on leaving the page.
- **It does not pretend to certainty.** Every finding states what would make
  it wrong.

## Determinism

The same transaction produces the same report, in the same order, on every
run. Findings are sorted by how much they give away and then by rule id, so
two runs are comparable and a difference between them means the transaction
differed.

## Accessibility

Severity is named in words on every finding; the coloured edge is a second
signal and never the only one. The wrongness of each rule sits behind a
disclosure that is a real `details` element, so it is reachable by keyboard
and announced as expandable.
