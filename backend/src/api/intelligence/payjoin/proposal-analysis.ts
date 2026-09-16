import { Psbt, Transaction } from 'bitcoinjs-lib';
import { PayjoinProposalAnalysisRequest } from './payjoin.models';

const MAX_MONEY = 2100000000000000;
export interface InputEvidence { outpoint: string; value: number | null; script: string | null; sequence: number; }
export interface ProposalView {
  inputs: InputEvidence[];
  outputs: Array<{ script: string; value: number }>;
  fee: number | null;
  vsize: number | null;
}
function money(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new Error('Invalid Bitcoin amount.');
  return value;
}
function total(values: number[]): number { return money(values.reduce((sum, value) => sum + money(value), 0)); }
export function parseProposalPsbt(encoded: string, label: string): Psbt {
  if (typeof encoded !== 'string' || !encoded.trim() || encoded.length > 2000000) throw new Error(`${label} requires bounded PSBT hex or base64.`);
  const trimmed = encoded.trim();
  try {
    const hex = /^(?:[0-9a-f]{2})+$/i.test(trimmed);
    if (!hex && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(trimmed)) throw new Error();
    const psbt = hex ? Psbt.fromHex(trimmed) : Psbt.fromBase64(trimmed);
    if (!psbt.inputCount || psbt.inputCount > 1000 || !psbt.txOutputs.length || psbt.txOutputs.length > 1000) throw new Error();
    return psbt;
  } catch { throw new Error(`${label} is not a valid PSBT (base64 or hex).`); }
}
export function proposalView(psbt: Psbt, trustedOriginal?: Map<string, InputEvidence>): ProposalView {
  const seen = new Set<string>();
  const inputs = psbt.txInputs.map((input, index) => {
    const outpoint = `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`;
    if (seen.has(outpoint)) throw new Error('Duplicate transaction input.');
    seen.add(outpoint);
    const data = psbt.data.inputs[index];
    let value: number | null = null, script: string | null = null;
    if (data.nonWitnessUtxo) {
      const previous = Transaction.fromBuffer(data.nonWitnessUtxo);
      const output = previous.outs[input.index];
      if (previous.getId() !== outpoint.split(':')[0] || !output) throw new Error('Previous transaction does not match its input outpoint.');
      value = money(output.value); script = output.script.toString('hex');
    }
    if (data.witnessUtxo) {
      const witnessValue = money(data.witnessUtxo.value), witnessScript = data.witnessUtxo.script.toString('hex');
      if (value !== null && (value !== witnessValue || script !== witnessScript)) throw new Error('Conflicting witness and previous transaction UTXO data.');
      value = witnessValue; script = witnessScript;
    }
    const original = trustedOriginal?.get(outpoint);
    if (original) {
      if (value !== null && (value !== original.value || script !== original.script)) throw new Error('Proposal changed sender UTXO evidence.');
      value = original.value; script = original.script;
    }
    return { outpoint, value, script, sequence: input.sequence! };
  });
  const outputs = psbt.txOutputs.map(output => ({ script: output.script.toString('hex'), value: money(output.value) }));
  const outputTotal = total(outputs.map(output => output.value));
  const inputTotal = inputs.every(input => input.value !== null) ? total(inputs.map(input => input.value!)) : null;
  const fee = inputTotal === null ? null : inputTotal - outputTotal;
  let vsize: number | null = null;
  try { vsize = psbt.extractTransaction(true).virtualSize(); } catch { /* Unsigned proposals have no exact final size. */ }
  return { inputs, outputs, fee, vsize };
}

/** Transaction comparison is deliberately separate from signature/chain acceptance. */
export function compareProposal(req: PayjoinProposalAnalysisRequest) {
  const originalPsbt = parseProposalPsbt(req.original_psbt, 'original_psbt');
  const proposalPsbt = parseProposalPsbt(req.proposal_psbt, 'proposal_psbt');
  const original = proposalView(originalPsbt);
  const originalInputs = new Map(original.inputs.map(input => [input.outpoint, input]));
  const proposal = proposalView(proposalPsbt, originalInputs);
  const messages: string[] = [];
  const addedInputs = proposal.inputs.filter(input => !originalInputs.has(input.outpoint));
  const feeDelta = original.fee !== null && proposal.fee !== null ? proposal.fee - original.fee : null;
  const payment = req.payment_output_index;
  if (payment !== undefined && (!Number.isInteger(payment) || payment < 0 || payment >= original.outputs.length)) throw new Error('payment_output_index is out of bounds.');
  if (req.disable_output_substitution !== undefined && typeof req.disable_output_substitution !== 'boolean') throw new Error('disable_output_substitution must be a boolean.');
  const substitute = payment !== undefined && req.disable_output_substitution === false;
  if (req.additional_fee_output_index !== undefined || req.max_additional_fee_contribution !== undefined) {
    if (!Number.isInteger(req.additional_fee_output_index) || req.additional_fee_output_index! < 0 || req.additional_fee_output_index! >= original.outputs.length
      || req.additional_fee_output_index === payment || !Number.isSafeInteger(req.max_additional_fee_contribution) || req.max_additional_fee_contribution! < 0
      || req.max_additional_fee_contribution! > MAX_MONEY) throw new Error('A fee contribution requires a valid non-payment output index and maximum satoshi amount.');
  }
  if (originalPsbt.version !== proposalPsbt.version || originalPsbt.locktime !== proposalPsbt.locktime) messages.push('Transaction version or locktime changed.');
  let inputCursor = 0;
  for (const input of original.inputs) {
    const match = proposal.inputs.findIndex((candidate, i) => i >= inputCursor && candidate.outpoint === input.outpoint);
    if (match < 0) { messages.push("Proposal dropped or reordered the sender's original inputs."); continue; }
    inputCursor = match + 1;
    if (proposal.inputs[match].sequence !== input.sequence) messages.push('Sender input sequence changed.');
  }
  if (new Set(proposal.inputs.map(input => input.sequence)).size > 1) messages.push('Proposal input sequences differ.');
  if (original.fee === null || proposal.fee === null) messages.push('Missing UTXO evidence prevents fee validation.');
  if (original.fee !== null && original.fee < 0 || proposal.fee !== null && proposal.fee < 0) messages.push('Input values do not cover outputs.');
  if (feeDelta !== null && feeDelta < 0) messages.push('Proposal pays less fee than the original.');
  let outputCursor = 0;
  for (let index = 0; index < original.outputs.length; index++) {
    if (index === payment && substitute) continue;
    const output = original.outputs[index];
    const match = proposal.outputs.findIndex((candidate, i) => i >= outputCursor && candidate.script === output.script);
    if (match < 0) { messages.push(`Original output ${index} was removed or reordered.`); continue; }
    outputCursor = match + 1;
    const reduction = output.value - proposal.outputs[match].value;
    if (reduction > 0) {
      if (index !== req.additional_fee_output_index) { messages.push(`Original output ${index} decreased without fee authorization.`); continue; }
      if (reduction > req.max_additional_fee_contribution! || feeDelta === null || reduction > feeDelta) messages.push('Sender fee contribution exceeds its authorization or actual fee increase.');
      // Without a finalized original, its fee rate cannot safely bound contribution.
      // P2WPKH has a maximum serialized input weight of 273 weight units.
      const supported = addedInputs.every(input => /^0014[0-9a-f]{40}$/.test(input.script ?? ''));
      const limit = supported && original.vsize && original.fee !== null ? original.fee / original.vsize * 68 * addedInputs.length : null;
      if (limit === null || reduction > limit) messages.push('Sender contribution exceeds the supported additional-input fee bound or the bound is unknown.');
    }
  }
  const envelopeIssues: string[] = [];
  if (proposalPsbt.data.globalMap.globalXpub?.length) envelopeIssues.push('Proposal contains global key paths.');
  proposalPsbt.data.inputs.forEach((input, index) => {
    if (input.bip32Derivation?.length || input.tapBip32Derivation?.length || input.partialSig?.length || input.tapKeySig || input.tapScriptSig?.length) envelopeIssues.push('Proposal contains key paths or partial signatures.');
    const finalized = !!(input.finalScriptSig || input.finalScriptWitness);
    if (originalInputs.has(proposal.inputs[index].outpoint) && finalized) envelopeIssues.push('Sender proposal input must not be finalized.');
    if (!originalInputs.has(proposal.inputs[index].outpoint) && !finalized) envelopeIssues.push('Receiver proposal input must be finalized.');
  });
  if (proposalPsbt.data.outputs.some(output => output.bip32Derivation?.length || output.tapBip32Derivation?.length)) envelopeIssues.push('Proposal outputs contain key paths.');
  if (!original.vsize) envelopeIssues.push('Original PSBT is not finalized.');
  return { originalPsbt, proposalPsbt, original, proposal, addedInputs, feeDelta, messages, envelopeIssues };
}
