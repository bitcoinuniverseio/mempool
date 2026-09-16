import { Psbt, Transaction, crypto as bitcoinCrypto, payments } from 'bitcoinjs-lib';
import * as secp from 'tiny-secp256k1';
import { adaptWorkbenchPsbt } from './psbt-v2';

export interface PsbtAnalysisResult {
  version: 0 | 2;
  psbt_id?: string;
  transaction_version: number;
  txid: string;
  txid_kind: 'unsigned-transaction' | 'finalized-transaction';
  input_count: number;
  output_count: number;
  total_fee_sats: number | null;
  feerate_sats_vb: number | null;
  inputs_status: Array<{
    index: number; has_utxo: boolean; required_sigs: number | null;
    present_sigs: number; is_finalized: boolean; missing_signers: string[] | null;
    partial_signatures_valid: boolean | null;
  }>;
  is_complete: boolean;
  completion_scope: string;
  chain_validated: false;
  warnings: string[];
}

/** Offline BIP174 inspection. A finalized PSBT is not proof of a valid/unspent transaction. */
export function inspectWorkbenchPsbt(encoded: string): PsbtAnalysisResult {
  if (typeof encoded !== 'string' || encoded.length > 2 * 1024 * 1024) throw new Error('PSBT must be a string of at most 2 MiB.');
  const text = encoded.trim();
  let bytes: Buffer;
  if (/^(?:[0-9a-f]{2})+$/i.test(text)) bytes = Buffer.from(text, 'hex');
  else if (text && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) bytes = Buffer.from(text, 'base64');
  else throw new Error('PSBT must use canonical base64 or even-length hexadecimal.');
  if (bytes.length > 1024 * 1024) throw new Error('Decoded PSBT exceeds 1 MiB.');
  const adapted = adaptWorkbenchPsbt(bytes);
  const psbt = Psbt.fromBuffer(adapted.bytes);
  const unsigned = Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer());
  if (!psbt.inputCount || !psbt.txOutputs.length) throw new Error('A PSBT requires at least one input and one output.');
  if (psbt.inputCount > 1000 || psbt.txOutputs.length > 1000) throw new Error('PSBT analysis is limited to 1000 inputs and outputs.');
  const warnings = ['Offline inspection only: input availability, network, consensus validity and final witness signatures were not checked against a node.'];
  let totalInput = 0;
  let allUtxos = true;
  let allFinalized = true;
  const statuses = psbt.data.inputs.map((input, index) => {
    const outpoint = psbt.txInputs[index];
    let utxo = input.witnessUtxo;
    if (input.nonWitnessUtxo) {
      const previous = Transaction.fromBuffer(input.nonWitnessUtxo);
      if (!previous.getHash().equals(outpoint.hash) || !previous.outs[outpoint.index]) throw new Error(`Input ${index} has an unrelated previous transaction.`);
      const full = previous.outs[outpoint.index];
      if (utxo && (utxo.value !== full.value || !utxo.script.equals(full.script))) throw new Error(`Input ${index} has conflicting UTXO records.`);
      utxo = full;
    }
    if (utxo) {
      if (!Number.isSafeInteger(utxo.value) || utxo.value < 0 || utxo.value > 21e14) throw new Error(`Input ${index} amount is out of range.`);
      totalInput += utxo.value;
    } else allUtxos = false;
    let locking = utxo?.script;
    if (input.redeemScript && locking) {
      const expected = payments.p2sh({ redeem: { output: input.redeemScript } }).output;
      if (!expected?.equals(locking)) throw new Error(`Input ${index} redeem script does not match its UTXO.`);
      locking = input.redeemScript;
    }
    if (input.witnessScript && locking) {
      if (!Buffer.concat([Buffer.from([0, 32]), bitcoinCrypto.sha256(input.witnessScript)]).equals(locking)) throw new Error(`Input ${index} witness script does not match its UTXO.`);
      locking = input.witnessScript;
    }
    let required: number | null = null;
    let keys: Buffer[] | undefined;
    if (locking) {
      if ((locking.length === 22 && locking[0] === 0 && locking[1] === 20)
        || (locking.length === 25 && locking.toString('hex').startsWith('76a914') && locking.toString('hex').endsWith('88ac'))) required = 1;
      else if (locking.length === 34 && locking[0] === 0x51 && locking[1] === 32 && !input.tapLeafScript?.length) required = 1;
      else {
        try { const multisig = payments.p2ms({ output: locking }); required = multisig.m ?? null; keys = multisig.pubkeys; } catch { /* Unknown script cannot imply a signer count. */ }
      }
    }
    const present = (input.partialSig?.length ?? 0) + (input.tapScriptSig?.length ?? 0) + (input.tapKeySig ? 1 : 0);
    let valid: boolean | null = null;
    if (present) {
      try {
        valid = psbt.validateSignaturesOfInput(index, (key, hash, signature) => key.length === 32
          ? secp.verifySchnorr(hash, key, signature) : secp.verify(hash, key, signature));
      } catch { valid = null; warnings.push(`Input ${index} partial signatures could not be verified with the supplied metadata.`); }
      if (valid === false) warnings.push(`Input ${index} contains an invalid partial signature.`);
    }
    const finalized = input.finalScriptSig !== undefined || input.finalScriptWitness !== undefined;
    allFinalized = allFinalized && finalized;
    return { index, has_utxo: !!utxo, required_sigs: required, present_sigs: present, is_finalized: finalized,
      missing_signers: keys && !finalized ? keys.filter(key => !input.partialSig?.some(sig => sig.pubkey.equals(key))).map(key => key.toString('hex')) : null,
      partial_signatures_valid: valid };
  });
  const totalOutput = psbt.txOutputs.reduce((sum, output) => sum + output.value, 0);
  if (totalOutput > 21e14 || totalInput > 21e14) throw new Error('Transaction amounts exceed the monetary range.');
  const fee = allUtxos ? totalInput - totalOutput : null;
  if (fee !== null && fee < 0) throw new Error('PSBT outputs exceed the supplied input values.');
  if (!allUtxos) warnings.push('Fee is unknown because at least one input has no UTXO record.');
  let txid = unsigned.getId();
  let kind: PsbtAnalysisResult['txid_kind'] = 'unsigned-transaction';
  let rate: number | null = null;
  if (allFinalized && allUtxos) {
    try { const tx = psbt.extractTransaction(true); txid = tx.getId(); kind = 'finalized-transaction'; rate = fee! / tx.virtualSize(); }
    catch { allFinalized = false; warnings.push('Final scripts could not be extracted into a transaction.'); }
  }
  if (kind === 'unsigned-transaction') warnings.push('The reported txid identifies the unsigned transaction; final scriptSig data may change it. Final virtual size and fee rate are unknown.');
  return { version: adapted.version, ...(adapted.psbt_id ? { psbt_id: adapted.psbt_id } : {}), transaction_version: unsigned.version, txid, txid_kind: kind, input_count: psbt.inputCount, output_count: psbt.txOutputs.length,
    total_fee_sats: fee, feerate_sats_vb: rate, inputs_status: statuses, is_complete: allFinalized,
    completion_scope: 'All inputs contain final scripts; this is structural finalization, not signature or chain validation.', chain_validated: false, warnings };
}
