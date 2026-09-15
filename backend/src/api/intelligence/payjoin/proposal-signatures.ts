import { Psbt, Transaction } from 'bitcoinjs-lib';
import { TransactionScriptContext, verifyTransactionScripts } from '../workbench/transaction-script-verifier';
import { compareProposal, ProposalView } from './proposal-analysis';
import { PayjoinProposalAnalysisRequest } from './payjoin.models';

function witnessStack(bytes: Buffer): Buffer[] {
  let offset = 0;
  const size = () => {
    if (offset >= bytes.length) throw new Error('Truncated witness.');
    const prefix = bytes[offset++];
    if (prefix < 253) return prefix;
    const width = prefix === 253 ? 2 : prefix === 254 ? 4 : 8;
    if (offset + width > bytes.length || width === 8) throw new Error('Invalid bounded witness length.');
    const value = width === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset); offset += width;
    if (value < (width === 2 ? 253 : 65536)) throw new Error('Noncanonical witness length.');
    return value;
  };
  const count = size(); if (count > 1000) throw new Error('Witness element limit exceeded.');
  const stack: Buffer[] = [];
  for (let i = 0; i < count; i++) { const length = size(); if (length > 10000 || offset + length > bytes.length) throw new Error('Invalid witness element.'); stack.push(bytes.subarray(offset, offset + length)); offset += length; }
  if (offset !== bytes.length) throw new Error('Trailing witness bytes.');
  return stack;
}
function contexts(psbt: Psbt, view: ProposalView, selected: number[]): TransactionScriptContext[] {
  const transaction = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  psbt.data.inputs.forEach((input, index) => {
    if (input.finalScriptSig) transaction.ins[index].script = input.finalScriptSig;
    if (input.finalScriptWitness) transaction.ins[index].witness = witnessStack(input.finalScriptWitness);
  });
  const previous_outputs = view.inputs.map(input => {
    if (input.value === null || input.script === null) throw new Error('Missing previous output evidence.');
    const [txid, vout] = input.outpoint.split(':');
    return { txid, vout: Number(vout), amount_sats: input.value, script_hex: input.script };
  });
  const transaction_hex = transaction.toHex();
  return selected.map(input_index => ({ transaction_hex, input_index, previous_outputs }));
}
export async function verifyProposalSignatures(req: PayjoinProposalAnalysisRequest): Promise<{ verified: boolean; errors: string[]; engine: string }> {
  const comparison = compareProposal(req);
  const originalOutpoints = new Set(comparison.original.inputs.map(input => input.outpoint));
  const originalContexts = contexts(comparison.originalPsbt, comparison.original, comparison.original.inputs.map((_, index) => index));
  const receiverIndexes = comparison.proposal.inputs.flatMap((input, index) => originalOutpoints.has(input.outpoint) ? [] : [index]);
  const receiverContexts = contexts(comparison.proposalPsbt, comparison.proposal, receiverIndexes);
  const result = await verifyTransactionScripts([...originalContexts, ...receiverContexts]);
  const errors = result.results.flatMap((verdict, index) => verdict.script_valid ? [] : [`${index < originalContexts.length ? 'Original' : 'Receiver proposal'} input script failed: ${verdict.error ?? 'invalid script'}`]);
  return { verified: errors.length === 0, errors, engine: result.engine };
}
