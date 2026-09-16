import { Psbt, Transaction } from 'bitcoinjs-lib';
import {
  TransactionScriptContext,
  verifyTransactionScripts,
} from '../workbench/transaction-script-verifier';
import {
  compareProposal,
  ProposalView,
  parseProposalPsbt,
} from './proposal-analysis';
import { ownedWorkbenchCore } from '../workbench/workbench-core';
import { PayjoinProposalAnalysisRequest } from './payjoin.models';

function witnessStack(bytes: Buffer): Buffer[] {
  let offset = 0;
  const size = () => {
    if (offset >= bytes.length) throw new Error('Truncated witness.');
    const prefix = bytes[offset++];
    if (prefix < 253) return prefix;
    const width = prefix === 253 ? 2 : prefix === 254 ? 4 : 8;
    if (offset + width > bytes.length || width === 8)
      throw new Error('Invalid bounded witness length.');
    const value =
      width === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset);
    offset += width;
    if (value < (width === 2 ? 253 : 65536))
      throw new Error('Noncanonical witness length.');
    return value;
  };
  const count = size();
  if (count > 1000) throw new Error('Witness element limit exceeded.');
  const stack: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const length = size();
    if (length > 10000 || offset + length > bytes.length)
      throw new Error('Invalid witness element.');
    stack.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.length) throw new Error('Trailing witness bytes.');
  return stack;
}
function signedTransaction(psbt: Psbt): Transaction {
  const transaction = Transaction.fromBuffer(
    psbt.data.globalMap.unsignedTx.toBuffer()
  );
  psbt.data.inputs.forEach((input, index) => {
    if (input.finalScriptSig)
      transaction.ins[index].script = input.finalScriptSig;
    if (input.finalScriptWitness)
      transaction.ins[index].witness = witnessStack(input.finalScriptWitness);
  });
  return transaction;
}
function contexts(
  psbt: Psbt,
  view: ProposalView,
  selected: number[]
): TransactionScriptContext[] {
  const transaction = signedTransaction(psbt);
  const previous_outputs = view.inputs.map((input) => {
    if (input.value === null || input.script === null)
      throw new Error('Missing previous output evidence.');
    const [txid, vout] = input.outpoint.split(':');
    return {
      txid,
      vout: Number(vout),
      amount_sats: input.value,
      script_hex: input.script,
    };
  });
  const transaction_hex = transaction.toHex();
  return selected.map((input_index) => ({
    transaction_hex,
    input_index,
    previous_outputs,
  }));
}

let policyRequests = 0;
async function ownedPolicy(
  transactionHex: string,
  expectedTip: string
): Promise<any> {
  if (policyRequests >= 2) throw new Error('Owned policy checker is busy.');
  policyRequests++;
  const operation = (/** @asyncUnsafe rejections propagate to the caller, which handles them. */ async () => {
    const result = await ownedWorkbenchCore.call('testmempoolaccept', [
      [transactionHex],
    ]);
    if ((await ownedWorkbenchCore.call('getbestblockhash', [])) !== expectedTip)
      throw new Error('Owned checkpoint changed; repeat verification.');
    return result;
  })();
  operation.then(
    () => {
      policyRequests--;
    },
    () => {
      policyRequests--;
    }
  );
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned policy check timed out.')),
          10000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** @asyncUnsafe rejections propagate to the caller, which handles them. */
export async function verifyFinalProposal(
  req: PayjoinProposalAnalysisRequest,
  expectedTip: string
) {
  const comparison = compareProposal(req);
  const finalPsbt = parseProposalPsbt(
    req.final_signed_psbt!,
    'final_signed_psbt'
  );
  if (
    !finalPsbt.data.globalMap.unsignedTx
      .toBuffer()
      .equals(comparison.proposalPsbt.data.globalMap.unsignedTx.toBuffer())
  )
    throw new Error('Final signed transaction changed the proposal.');
  if (
    finalPsbt.data.inputs.some(
      (input) =>
        input.finalScriptSig === undefined &&
        input.finalScriptWitness === undefined
    )
  )
    throw new Error('Final PSBT inputs must be finalized.');
  if (
    req.min_feerate !== undefined &&
    (typeof req.min_feerate !== 'number' ||
      !Number.isFinite(req.min_feerate) ||
      req.min_feerate < 0 ||
      req.min_feerate > 1000000)
  )
    throw new Error('min_feerate must be a bounded nonnegative number.');
  const finalTransaction = signedTransaction(finalPsbt),
    vsize = finalTransaction.virtualSize();
  if (comparison.proposal.fee === null || comparison.proposal.fee < 0)
    throw new Error('Unknown or negative fee.');
  const feerate = comparison.proposal.fee / vsize;
  const result = await verifyTransactionScripts(
    contexts(
      finalPsbt,
      comparison.proposal,
      comparison.proposal.inputs.map((_, index) => index)
    )
  );
  const signatures = result.results.every((item) => item.script_valid);
  if (!signatures)
    return {
      signatures: false,
      policy: false,
      vsize,
      feerate,
      error: 'A final input signature or script is invalid.',
    };
  if (feerate < (req.min_feerate ?? 0))
    return {
      signatures: true,
      policy: false,
      vsize,
      feerate,
      error: 'Final signed feerate is below the requested minimum.',
    };
  const policy = await ownedPolicy(finalTransaction.toHex(), expectedTip);
  if (
    !Array.isArray(policy) ||
    policy.length !== 1 ||
    policy[0].txid !== finalTransaction.getId() ||
    typeof policy[0].allowed !== 'boolean'
  )
    throw new Error('Owned node returned invalid policy evidence.');
  return {
    signatures: true,
    policy: policy[0].allowed,
    vsize,
    feerate,
    error: policy[0].allowed
      ? null
      : 'Owned node rejected the final signed transaction under its current mempool policy.',
  };
}
/** @asyncUnsafe rejections propagate to the caller, which handles them. */
export async function verifyProposalSignatures(
  req: PayjoinProposalAnalysisRequest
): Promise<{ verified: boolean; errors: string[]; engine: string }> {
  const comparison = compareProposal(req);
  const originalOutpoints = new Set(
    comparison.original.inputs.map((input) => input.outpoint)
  );
  const originalContexts = contexts(
    comparison.originalPsbt,
    comparison.original,
    comparison.original.inputs.map((_, index) => index)
  );
  const receiverIndexes = comparison.proposal.inputs.flatMap((input, index) =>
    originalOutpoints.has(input.outpoint) ? [] : [index]
  );
  const receiverContexts = contexts(
    comparison.proposalPsbt,
    comparison.proposal,
    receiverIndexes
  );
  const result = await verifyTransactionScripts([
    ...originalContexts,
    ...receiverContexts,
  ]);
  const errors = result.results.flatMap((verdict, index) =>
    verdict.script_valid
      ? []
      : [
          `${index < originalContexts.length ? 'Original' : 'Receiver proposal'} input script failed: ${verdict.error ?? 'invalid script'}`,
        ]
  );
  return { verified: errors.length === 0, errors, engine: result.engine };
}
