/**
 * What a transaction's shape gives away.
 *
 * Every rule here reads one transaction and nothing else. No chain history,
 * no address clustering, no outside source. The same transaction produces the
 * same findings on every run, which is what lets a finding be argued with.
 *
 * Three rules the whole file is built on.
 *
 * A heuristic is not a fact. Several of these are the reasoning an observer
 * would apply, and observers are wrong. Each finding therefore carries what
 * it would take for it to be wrong, in both directions, next to the finding
 * itself rather than in a footnote.
 *
 * A finding is about structure, never about a person. Nothing here names an
 * owner, infers one, scores a risk, or attaches a label to an address. The
 * question this answers is what a transaction reveals, not who made it.
 *
 * A rule that does not apply says nothing. Silence from a rule means it had
 * no evidence, which is different from evidence of privacy, and the report
 * says which rules ran so the difference is visible.
 */

/** Bumped when a rule's meaning changes, so a saved finding stays readable. */
export const HEURISTIC_REVISION = '2026-09-02.1';

export type Severity = 'reveals' | 'notable' | 'neutral';

/** How far the finding is from a fact. */
export type Confidence = 'observed' | 'likely' | 'heuristic';

export interface Evidence {
  readonly label: string;
  readonly value: string;
}

export interface Finding {
  /** Stable across releases. A saved link to a finding keeps meaning. */
  readonly ruleId: string;
  readonly title: string;
  readonly severity: Severity;
  readonly confidence: Confidence;
  /** One sentence, no jargon. */
  readonly plain: string;
  /** What the rule actually measured. */
  readonly technical: string;
  readonly evidence: readonly Evidence[];
  /** When this rule fires and is wrong. */
  readonly falsePositives: string;
  /** When this rule stays silent and something was revealed anyway. */
  readonly falseNegatives: string;
}

export interface PrivacyInput {
  readonly index: number;
  readonly valueSats: number | null;
  readonly scriptType: string;
  readonly address: string | null;
  readonly sequence: number;
}

export interface PrivacyOutput {
  readonly index: number;
  readonly valueSats: number;
  readonly scriptType: string;
  readonly address: string | null;
}

export interface PrivacyTransaction {
  readonly txid: string;
  readonly version: number;
  readonly locktime: number;
  readonly inputs: readonly PrivacyInput[];
  readonly outputs: readonly PrivacyOutput[];
  /** The height the transaction confirmed at, when it has. */
  readonly confirmedHeight: number | null;
}

export interface PrivacyReport {
  readonly txid: string;
  readonly revision: string;
  readonly findings: readonly Finding[];
  /** Rule ids that ran, so silence can be told from absence. */
  readonly rulesRun: readonly string[];
  /** Rule ids that had nothing to measure, with why. */
  readonly rulesSkipped: readonly { ruleId: string; reason: string }[];
}

/** Null when a rule found nothing, a skip when it had nothing to measure. */
type RuleResult = Finding | null | { skipped: string };

interface Rule {
  readonly id: string;
  run(tx: PrivacyTransaction): RuleResult;
}

function sats(value: number | null): string {
  return value === null ? 'unknown' : `${value} sat`;
}

function isSkip(value: unknown): value is { skipped: string } {
  return typeof value === 'object' && value !== null && 'skipped' in value;
}

// A round number in the sense that matters here: a payment somebody typed,
// rather than a remainder arithmetic produced. Whole thousands of satoshis
// and above, checked from the largest step down so the strongest one wins.
const ROUND_STEPS = [100_000_000, 10_000_000, 1_000_000, 100_000, 10_000, 1_000];

export function roundnessOf(valueSats: number): number | null {
  for (const step of ROUND_STEPS) {
    if (valueSats > 0 && valueSats % step === 0) { return step; }
  }
  return null;
}

const RULES: Rule[] = [
  {
    id: 'common-input-ownership',
    run(tx): RuleResult {
      if (tx.inputs.length < 2) {
        return { skipped: 'This transaction has one input, so the assumption has nothing to join.' };
      }
      return {
        ruleId: 'common-input-ownership',
        title: 'Several inputs were spent together',
        severity: 'reveals',
        confidence: 'heuristic',
        plain: `This transaction spends ${tx.inputs.length} separate coins at once. Anyone watching will usually assume one person controlled all of them.`,
        technical: 'The common input ownership heuristic treats every input of a transaction as belonging to one party, because an ordinary wallet can only sign for coins it holds. It is the single most widely applied assumption in chain analysis, and it is an assumption.',
        evidence: [
          { label: 'Inputs', value: String(tx.inputs.length) },
          {
            label: 'Previous outputs',
            value: tx.inputs
              .map((input) => input.address ?? `input ${input.index}`)
              .join(', '),
          },
        ],
        falsePositives: 'A collaborative transaction has inputs from several parties by design. A payjoin, a coinjoin, and a funded channel open all break this assumption on purpose, and the assumption cannot tell them from an ordinary spend by structure alone.',
        falseNegatives: 'A single input transaction reveals nothing under this heuristic, but the coin it spends may already have been linked to others by an earlier transaction.',
      };
    },
  },
  {
    id: 'address-reuse',
    run(tx): RuleResult {
      const seen = new Map<string, number[]>();
      for (const output of tx.outputs) {
        if (!output.address) { continue; }
        seen.set(output.address, [...(seen.get(output.address) ?? []), output.index]);
      }
      const inputAddresses = new Set(
        tx.inputs.map((input) => input.address).filter((a): a is string => !!a),
      );
      const repeatedOutputs = [...seen.entries()].filter(([, indexes]) => indexes.length > 1);
      const returned = [...seen.keys()].filter((address) => inputAddresses.has(address));
      if (!repeatedOutputs.length && !returned.length) { return null; }

      const evidence: Evidence[] = [];
      for (const [address, indexes] of repeatedOutputs) {
        evidence.push({ label: address, value: `outputs ${indexes.join(', ')}` });
      }
      for (const address of returned) {
        evidence.push({ label: address, value: 'spent by an input and paid by an output' });
      }
      return {
        ruleId: 'address-reuse',
        title: 'An address is used more than once',
        severity: 'reveals',
        confidence: 'observed',
        plain: 'The same address appears twice in this transaction. Every payment to a reused address is visibly connected to every other one.',
        technical: 'A reused script is the strongest link there is, because it needs no inference at all. Where an input address is also an output address, the change is not merely linkable, it is stated.',
        evidence,
        falsePositives: 'None for the observation itself. The address really does appear twice. Whether that matters depends on whether the address was meant to be public.',
        falseNegatives: 'Reuse across separate transactions is invisible here, because this rule reads one transaction.',
      };
    },
  },
  {
    id: 'change-by-script-type',
    run(tx): RuleResult {
      if (tx.outputs.length !== 2) {
        return { skipped: 'This rule compares two outputs, and this transaction does not have exactly two.' };
      }
      const inputTypes = new Set(tx.inputs.map((input) => input.scriptType));
      if (inputTypes.size !== 1) {
        return { skipped: 'The inputs are of more than one script type, so no single type identifies the change.' };
      }
      const inputType = [...inputTypes][0];
      const matching = tx.outputs.filter((output) => output.scriptType === inputType);
      if (matching.length !== 1) {
        return { skipped: 'Both outputs share the input script type, or neither does, so the type separates nothing.' };
      }
      const change = matching[0];
      const payment = tx.outputs.find((output) => output.index !== change.index) as PrivacyOutput;
      return {
        ruleId: 'change-by-script-type',
        title: 'The script type separates change from payment',
        severity: 'reveals',
        confidence: 'likely',
        plain: `Output ${change.index} pays to the same kind of address the inputs came from, and output ${payment.index} does not. The first is probably change coming back.`,
        technical: `Every input is ${inputType}. A wallet makes its own change with the script type it uses, while a payment goes wherever the recipient asked. One output matching the input type and one not is the clearest form of this signal.`,
        evidence: [
          { label: 'Input type', value: inputType },
          { label: `Output ${change.index}`, value: `${change.scriptType}, ${sats(change.valueSats)}` },
          { label: `Output ${payment.index}`, value: `${payment.scriptType}, ${sats(payment.valueSats)}` },
        ],
        falsePositives: 'A payment to someone using the same wallet software looks exactly like change. So does a transfer between two of your own accounts, where both outputs are yours and neither is a payment.',
        falseNegatives: 'A wallet that makes its change with the same script type as the payment reveals nothing to this rule, and a transaction with one output has no change to find.',
      };
    },
  },
  {
    id: 'change-by-round-amount',
    run(tx): RuleResult {
      if (tx.outputs.length !== 2) {
        return { skipped: 'This rule compares two outputs, and this transaction does not have exactly two.' };
      }
      const [first, second] = tx.outputs;
      const firstRound = roundnessOf(first.valueSats);
      const secondRound = roundnessOf(second.valueSats);
      if ((firstRound === null) === (secondRound === null)) {
        return { skipped: 'Both output amounts are round, or neither is, so roundness separates nothing.' };
      }
      const payment = firstRound !== null ? first : second;
      const change = firstRound !== null ? second : first;
      const step = (firstRound ?? secondRound) as number;
      return {
        ruleId: 'change-by-round-amount',
        title: 'One amount was chosen and one was left over',
        severity: 'reveals',
        confidence: 'likely',
        plain: `Output ${payment.index} is a round amount and output ${change.index} is not. The round one is probably the payment and the other is probably change.`,
        technical: `Output ${payment.index} is an exact multiple of ${step} satoshis. Change is what remains after a payment and a fee, so it lands on an arbitrary number. A person types the payment; arithmetic produces the change.`,
        evidence: [
          { label: `Output ${payment.index}`, value: `${payment.valueSats} sat, a multiple of ${step}` },
          { label: `Output ${change.index}`, value: `${change.valueSats} sat` },
        ],
        falsePositives: 'A payment of an amount converted from a currency is rarely round, and a wallet sending a whole balance produces one round looking output that is not a payment at all.',
        falseNegatives: 'A payment that is not a round number of satoshis, which includes most amounts priced in another currency, leaves this rule nothing to see.',
      };
    },
  },
  {
    id: 'equal-output-structure',
    run(tx): RuleResult {
      const byValue = new Map<number, number[]>();
      for (const output of tx.outputs) {
        byValue.set(output.valueSats, [...(byValue.get(output.valueSats) ?? []), output.index]);
      }
      const largest = [...byValue.entries()]
        .filter(([, indexes]) => indexes.length >= 3)
        .sort((a, b) => b[1].length - a[1].length)[0];
      if (!largest) { return null; }
      const [value, indexes] = largest;
      return {
        ruleId: 'equal-output-structure',
        title: 'Several outputs are the same size',
        severity: 'notable',
        confidence: 'observed',
        plain: `${indexes.length} outputs pay exactly ${value} satoshis each. That is the shape of a collaborative transaction, where several people combine a spend so that no output can be matched to an input.`,
        technical: 'Equal valued outputs make the mapping between inputs and outputs ambiguous, which is the point of the structure. The count of equal outputs sets how much ambiguity there is.',
        evidence: [
          { label: 'Equal outputs', value: `${indexes.length} at ${value} sat` },
          { label: 'Positions', value: indexes.join(', ') },
        ],
        falsePositives: 'A batched payout that happens to pay several people the same amount has this shape and none of the intent. So does a wallet splitting a balance into equal pieces for itself.',
        falseNegatives: 'A collaborative transaction with unequal outputs, which some designs use, does not appear here.',
      };
    },
  },
  {
    id: 'unnecessary-input',
    run(tx): RuleResult {
      if (tx.inputs.length < 2 || tx.outputs.length !== 2) {
        return { skipped: 'This rule needs two or more inputs and exactly two outputs.' };
      }
      if (tx.inputs.some((input) => input.valueSats === null)) {
        return { skipped: 'At least one input value is not known here, so the comparison cannot be made.' };
      }
      const values = tx.inputs.map((input) => input.valueSats as number);
      const largestInput = Math.max(...values);
      const smaller = tx.outputs.reduce((min, output) =>
        (output.valueSats < min.valueSats ? output : min));
      const larger = tx.outputs.find((output) => output.index !== smaller.index) as PrivacyOutput;
      // If one input alone covers an output, every other input was surplus
      // for that output, and a wallet does not add inputs it does not need.
      if (largestInput <= larger.valueSats) {
        return { skipped: 'No single input covers the larger output on its own, so every input was needed.' };
      }
      return {
        ruleId: 'unnecessary-input',
        title: 'More coins were spent than the payment needed',
        severity: 'reveals',
        confidence: 'likely',
        plain: `One input alone, worth ${largestInput} satoshis, already covers output ${larger.index}. The other inputs were not needed for it, which suggests output ${smaller.index} is the payment and the rest is change.`,
        technical: 'The unnecessary input heuristic: a wallet selects the fewest coins that cover a payment. When a single input covers the larger output, the larger output cannot be the payment, because a wallet would not have added inputs beyond it.',
        evidence: [
          { label: 'Largest input', value: `${largestInput} sat` },
          { label: `Output ${larger.index}`, value: `${larger.valueSats} sat` },
          { label: `Output ${smaller.index}`, value: `${smaller.valueSats} sat` },
        ],
        falsePositives: 'A wallet consolidating coins deliberately adds inputs it does not need. Some coin selection algorithms add an input to avoid leaving dust, and a user choosing coins by hand owes nothing to any algorithm.',
        falseNegatives: 'A transaction where no single input covers an output tells this rule nothing, even though the amounts may still separate payment from change.',
      };
    },
  },
  {
    id: 'consolidation',
    run(tx): RuleResult {
      if (tx.outputs.length !== 1 || tx.inputs.length < 3) { return null; }
      return {
        ruleId: 'consolidation',
        title: 'Many coins were gathered into one',
        severity: 'reveals',
        confidence: 'observed',
        plain: `${tx.inputs.length} coins were combined into a single output. Every one of them is now visibly connected to the others.`,
        technical: 'A consolidation joins its inputs under the common input ownership heuristic with no ambiguity to soften it, because there is no change output whose ownership could be argued.',
        evidence: [
          { label: 'Inputs', value: String(tx.inputs.length) },
          { label: 'Outputs', value: '1' },
        ],
        falsePositives: 'A collaborative transaction paying one recipient has this shape without one party owning the inputs.',
        falseNegatives: 'A consolidation that leaves a change output is not counted here, though it links its inputs just the same.',
      };
    },
  },
  {
    id: 'fan-out',
    run(tx): RuleResult {
      if (tx.outputs.length < 5 || tx.inputs.length > 2) { return null; }
      return {
        ruleId: 'fan-out',
        title: 'One spend paid many outputs',
        severity: 'notable',
        confidence: 'observed',
        plain: `${tx.outputs.length} outputs were paid from ${tx.inputs.length} input${tx.inputs.length === 1 ? '' : 's'}. Everyone paid can see how much everyone else was paid, and when.`,
        technical: 'A batched payment reveals the whole batch to every recipient. It also makes the change output harder to identify, since it sits among many, so the effect on privacy runs in both directions.',
        evidence: [
          { label: 'Inputs', value: String(tx.inputs.length) },
          { label: 'Outputs', value: String(tx.outputs.length) },
        ],
        falsePositives: 'A wallet splitting its own balance into many pieces has this shape and pays nobody.',
        falseNegatives: 'A batch of four or fewer outputs does not reach the threshold here.',
      };
    },
  },
  {
    id: 'peel-chain',
    run(tx): RuleResult {
      if (tx.outputs.length !== 2) {
        return { skipped: 'A peel step has exactly two outputs, and this transaction does not.' };
      }
      const [big, small] = [...tx.outputs].sort((a, b) => b.valueSats - a.valueSats);
      if (small.valueSats === 0 || big.valueSats < small.valueSats * 20) {
        return { skipped: 'The two outputs are within a factor of twenty, which is not the shape of a peel.' };
      }
      return {
        ruleId: 'peel-chain',
        title: 'A small amount was peeled off a large one',
        severity: 'notable',
        confidence: 'heuristic',
        plain: `Output ${small.index} takes a small slice and output ${big.index} keeps the rest. Repeated, this pattern is easy to follow from one transaction to the next.`,
        technical: `Output ${big.index} is at least twenty times output ${small.index}. In a peel chain the large remainder is spent again the same way, and an observer follows the large side while the small payments fall away.`,
        evidence: [
          { label: `Output ${big.index}`, value: `${big.valueSats} sat` },
          { label: `Output ${small.index}`, value: `${small.valueSats} sat` },
          {
            label: 'Ratio',
            value: `${Math.floor(big.valueSats / Math.max(1, small.valueSats))} to 1`,
          },
        ],
        falsePositives: 'A single payment from a large coin has exactly this shape. One transaction cannot tell a peel chain from an ordinary spend; only the transactions that follow can.',
        falseNegatives: 'A peel with a ratio under twenty is not reported, and the threshold is a choice rather than a property of the chain.',
      };
    },
  },
  {
    id: 'no-change',
    run(tx): RuleResult {
      if (tx.outputs.length !== 1 || tx.inputs.length >= 3) { return null; }
      return {
        ruleId: 'no-change',
        title: 'Nothing came back as change',
        severity: 'neutral',
        confidence: 'observed',
        plain: 'This transaction has a single output, so there is no change for anyone to identify. That is the strongest shape available for this part of the problem.',
        technical: 'With no change output, the change identification heuristics have nothing to work on. The inputs are still joined under common input ownership if there is more than one.',
        evidence: [
          { label: 'Outputs', value: '1' },
          { label: 'Inputs', value: String(tx.inputs.length) },
        ],
        falsePositives: 'None. The transaction has one output.',
        falseNegatives: 'Says nothing about what the single output is spent on next.',
      };
    },
  },
  {
    id: 'mixed-input-types',
    run(tx): RuleResult {
      const types = new Set(tx.inputs.map((input) => input.scriptType));
      if (types.size < 2) { return null; }
      return {
        ruleId: 'mixed-input-types',
        title: 'The inputs are of different kinds',
        severity: 'notable',
        confidence: 'observed',
        plain: `The inputs use ${types.size} different address types. A single wallet usually spends one kind, so this narrows down which software made the transaction.`,
        technical: `Input script types present: ${[...types].join(', ')}. Mixed types point either at a wallet that has migrated between address formats or at inputs from more than one party, and the two look the same from here.`,
        evidence: [{ label: 'Input types', value: [...types].join(', ') }],
        falsePositives: 'A wallet that has been in use across an address format change holds both kinds and spends both, with one owner throughout.',
        falseNegatives: 'Uniform input types are the norm and reveal nothing to this rule, while still identifying the wallet through other means.',
      };
    },
  },
  {
    id: 'locktime-fingerprint',
    run(tx): RuleResult {
      if (tx.locktime === 0) {
        return {
          ruleId: 'locktime-fingerprint',
          title: 'The lock time is zero',
          severity: 'notable',
          confidence: 'observed',
          plain: 'This transaction sets no lock time. Wallets that guard against fee sniping set it to around the current height, so a zero narrows down which software made it.',
          technical: 'Anti fee sniping sets nLockTime to the current height so a miner cannot profitably re-mine the previous block and take the transaction with them. A zero says the wallet does not do this.',
          evidence: [{ label: 'nLockTime', value: '0' }],
          falsePositives: 'A transaction built by hand, or by a library used directly, will have zero here without saying anything about a wallet.',
          falseNegatives: 'A lock time that matches the current height is the common case and identifies a large group rather than a small one.',
        };
      }
      const near = tx.confirmedHeight !== null
        && tx.locktime > tx.confirmedHeight - 100
        && tx.locktime <= tx.confirmedHeight;
      return {
        ruleId: 'locktime-fingerprint',
        title: 'The lock time is set',
        severity: 'notable',
        confidence: 'observed',
        plain: near
          ? 'The lock time sits just below the block this confirmed in, which is what a wallet does to guard against fee sniping.'
          : 'This transaction sets a lock time. The value itself is a detail an observer can match against other transactions.',
        technical: near
          ? `nLockTime is ${tx.locktime} against a confirmation height of ${tx.confirmedHeight}, inside the hundred block window that anti fee sniping uses.`
          : `nLockTime is ${tx.locktime}.`,
        evidence: [
          { label: 'nLockTime', value: String(tx.locktime) },
          ...(tx.confirmedHeight !== null
            ? [{ label: 'Confirmed at', value: String(tx.confirmedHeight) }]
            : []),
        ],
        falsePositives: 'A lock time near the tip is set by a great many wallets, so it identifies a large group and not a particular one.',
        falseNegatives: 'This rule reads the value only. It cannot tell a lock time set for anti fee sniping from one set for a contract that happens to fall in the same range.',
      };
    },
  },
  {
    id: 'replacement-signal',
    run(tx): RuleResult {
      const signalling = tx.inputs.filter((input) => input.sequence < 0xfffffffe);
      if (!signalling.length) {
        return {
          ruleId: 'replacement-signal',
          title: 'No input signals replacement',
          severity: 'notable',
          confidence: 'observed',
          plain: 'This transaction does not signal that it may be replaced. Since most wallets now do, that is itself a detail worth noticing.',
          technical: 'Every input sits at or above sequence 0xfffffffe. A node that enforces full replacement will still replace it, so the signal describes the wallet rather than what a node will do.',
          evidence: [
            {
              label: 'Sequences',
              value: [...new Set(tx.inputs.map((i) => `0x${i.sequence.toString(16)}`))].join(', '),
            },
          ],
          falsePositives: 'A wallet that deliberately does not signal, for a protocol that needs the transaction to be final, is doing the right thing for its purpose.',
          falseNegatives: 'The absence of a signal does not mean the transaction cannot be replaced, since many nodes replace regardless.',
        };
      }
      const values = [...new Set(signalling.map((input) => `0x${input.sequence.toString(16)}`))];
      return {
        ruleId: 'replacement-signal',
        title: 'The transaction signals replacement',
        severity: 'notable',
        confidence: 'observed',
        plain: `${signalling.length} of ${tx.inputs.length} inputs signal that this may be replaced. The exact sequence value used is a fingerprint of the wallet.`,
        technical: `Sequences below 0xfffffffe: ${values.join(', ')}. Wallets differ in which value they pick, and the choice is consistent enough to group transactions by it.`,
        evidence: [
          { label: 'Signalling inputs', value: `${signalling.length} of ${tx.inputs.length}` },
          { label: 'Values', value: values.join(', ') },
        ],
        falsePositives: 'Several wallets share the common values, so a match groups rather than identifies.',
        falseNegatives: 'A wallet using the most common value blends into the largest group and is not distinguished by this rule.',
      };
    },
  },
  {
    id: 'version-fingerprint',
    run(tx): RuleResult {
      if (tx.version === 2) {
        return { skipped: 'Version 2 is the ordinary case and distinguishes nothing.' };
      }
      return {
        ruleId: 'version-fingerprint',
        title: `The transaction is version ${tx.version}`,
        severity: 'notable',
        confidence: 'observed',
        plain: `Almost every transaction is version 2. This one is version ${tx.version}, which puts it in a much smaller group.`,
        technical: tx.version === 3
          ? 'Version 3 opts into the stricter topology rules, which limit its unconfirmed relatives and make its replacement behaviour predictable. It is used by a small set of protocols.'
          : `Version ${tx.version} is not the version wallets have defaulted to since relative timelocks arrived.`,
        evidence: [{ label: 'Version', value: String(tx.version) }],
        falsePositives: 'None for the observation. The version is what it is.',
        falseNegatives: 'A version 2 transaction is not distinguished here, which is the whole point: it is the crowd.',
      };
    },
  },
  {
    id: 'dust-output',
    run(tx): RuleResult {
      // Below the smallest standard threshold, an output costs more to spend
      // than it holds, which is why it is more often a marker than a payment.
      const dust = tx.outputs.filter((output) => output.valueSats > 0 && output.valueSats < 546);
      if (!dust.length) { return null; }
      return {
        ruleId: 'dust-output',
        title: 'An output is too small to be worth spending',
        severity: 'notable',
        confidence: 'observed',
        plain: `${dust.length} output${dust.length === 1 ? '' : 's'} hold less than it would cost to spend. Amounts like these are usually markers rather than payments, and spending one links whatever it is combined with.`,
        technical: 'Below roughly 546 satoshis an output falls under the dust threshold for the cheapest standard script. Protocols use small outputs to carry position; a wallet that sweeps one into an unrelated spend joins the two.',
        evidence: dust.map((output) => ({
          label: `Output ${output.index}`,
          value: `${output.valueSats} sat`,
        })),
        falsePositives: 'A protocol output carrying an inscription or a token is meant to be small and is not a privacy mistake by itself.',
        falseNegatives: 'An output just above the threshold behaves much the same way and is not reported.',
      };
    },
  },
];

/**
 * Runs every rule and reports what each one found or why it found nothing.
 *
 * Silence from a rule is not evidence of privacy, so the rules that ran with
 * nothing to say are listed alongside the findings. A report showing three
 * findings and eleven silent rules says something different from one showing
 * three findings out of three.
 */
export function analyze(tx: PrivacyTransaction): PrivacyReport {
  const findings: Finding[] = [];
  const rulesRun: string[] = [];
  const rulesSkipped: { ruleId: string; reason: string }[] = [];

  for (const rule of RULES) {
    rulesRun.push(rule.id);
    const result = rule.run(tx);
    if (result === null) { continue; }
    if (isSkip(result)) {
      rulesSkipped.push({ ruleId: rule.id, reason: result.skipped });
      continue;
    }
    findings.push(result);
  }

  // Ordered by how much a finding gives away, then by rule id so two runs on
  // the same transaction produce the same report in the same order.
  const weight: Record<Severity, number> = { reveals: 0, notable: 1, neutral: 2 };
  findings.sort((a, b) => {
    const bySeverity = weight[a.severity] - weight[b.severity];
    if (bySeverity !== 0) { return bySeverity; }
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  return {
    txid: tx.txid,
    revision: HEURISTIC_REVISION,
    findings,
    rulesRun,
    rulesSkipped,
  };
}

/** Every rule this build carries, for the page that lists them. */
export function ruleIds(): string[] {
  return RULES.map((rule) => rule.id);
}
