import { Address, OutScript, RawTx, Script, Transaction, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { tapLeafHash } from '@scure/btc-signer/payment.js';
import { concatBytes, compareBytes, equalBytes, PubT, sha256x2, tagSchnorr, taprootTweakPubkey, validatePubkey } from '@scure/btc-signer/utils.js';
import { decodePsbtInput } from '../workbench/psbt-inspect';
import { SwapRecoveryPlan } from './swaps.service';

const allowed = new Set(['chain', 'network', 'swap_id', 'swap_type', 'protocol_id', 'protocol_revision',
  'schema_version', 'provider_id', 'created_at', 'expires_at', 'preimage_hash', 'timeout_height',
  'expected_amount_sats', 'lockup_address', 'lockup_transaction', 'lockup_vout', 'claim_transaction',
  'refund_transaction', 'claim_public_key', 'refund_public_key', 'internal_key', 'destination_address', 'fee_sats', 'status']);

export function publicSwapPackage(raw: string, network: string): Record<string, any> {
  if (!raw.trim() || raw.length > 16384) throw new Error('Enter a public JSON package no larger than 16 KiB.');
  let pkg: any;
  try { pkg = JSON.parse(raw); } catch { throw new Error('The package is not valid JSON.'); }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('The package must be a JSON object.');
  if (Object.keys(pkg).some(key => !allowed.has(key))) throw new Error('This form accepts public contract fields only. Remove private backup fields, invoices, preimages, keys used for spending and caller height.');
  if (pkg.chain !== 'bitcoin' || pkg.network !== network) throw new Error('Package chain/network must match the selected page.');
  return pkg;
}

/** Independent browser decoder, separate from the backend bitcoinjs serializer. */
export function checkRecoveryArtifact(plan: SwapRecoveryPlan, pkg: Record<string, any>, network: string): void {
  const source = plan.source_context;
  if (plan.stage !== 'unsigned-plan-ready' || !plan.unsigned_recovery_psbt || !source ||
      source.chain !== 'bitcoin' || source.network !== network || !source.source_id ||
      !/^[0-9a-f]{64}$/.test(source.block_hash) || !Number.isSafeInteger(source.block_height) ||
      source.block_height < pkg.timeout_height || !Number.isFinite(Date.parse(source.observed_at))) throw new Error('Recovery artifact is missing its verified mature source context.');
  const tx = Transaction.fromPSBT(decodePsbtInput(plan.unsigned_recovery_psbt), { allowUnknownInputs: true, allowUnknownOutputs: true });
  const net = network === 'mainnet' ? NETWORK : network === 'regtest' ? { ...TEST_NETWORK, bech32: 'bcrt' } : TEST_NETWORK;
  if (tx.inputsLength !== 1 || tx.outputsLength !== 1 || tx.version !== 2 || tx.lockTime !== pkg.timeout_height) throw new Error('PSBT transaction structure does not match the requested refund.');
  const input = tx.getInput(0);
  const txid = Array.from(input.txid || [], byte => byte.toString(16).padStart(2, '0')).join('');
  const output = tx.getOutput(0);
  if (txid !== pkg.lockup_transaction || input.index !== pkg.lockup_vout || input.sequence !== 0xfffffffd ||
      !input.nonWitnessUtxo || !input.witnessUtxo || input.tapLeafScript?.length !== 1 || input.finalScriptSig?.length || input.finalScriptWitness || input.partialSig?.length || input.tapKeySig || input.tapScriptSig?.length ||
      (input.sighashType !== undefined && input.sighashType !== 0 && input.sighashType !== 1) ||
      input.witnessUtxo.amount !== BigInt(pkg.expected_amount_sats) ||
      output.amount !== BigInt(pkg.expected_amount_sats) - BigInt(pkg.fee_sats) || tx.getOutputAddress(0, net) !== pkg.destination_address) {
    throw new Error('Independent PSBT decode disagrees with the intended outpoint, destination, value, fee or unsigned script path.');
  }
  const publicKey = (value: unknown): Uint8Array => {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('Refund contract requires x-only public keys.');
    return validatePubkey(Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16)), PubT.schnorr);
  };
  const refundKey = publicKey(pkg.refund_public_key), internalKey = publicKey(pkg.internal_key);
  const refund = Script.encode([refundKey, 'CHECKSIGVERIFY', pkg.timeout_height, 'CHECKLOCKTIMEVERIFY']);
  const [control, leaf] = input.tapLeafScript[0];
  if (!equalBytes(leaf, concatBytes(refund, Uint8Array.of(0xc0))) ||
      !equalBytes(control.internalKey, internalKey) || (control.version & 0xfe) !== 0xc0 || control.merklePath.length !== 1) {
    throw new Error('PSBT refund script or control path does not match the supported two-leaf contract.');
  }
  const merkleRoot = tagSchnorr('TapBranch', ...[tapLeafHash(refund), control.merklePath[0]].sort(compareBytes));
  const [outputKey, parity] = taprootTweakPubkey(internalKey, merkleRoot);
  const expectedScript = OutScript.encode(Address(net).decode(pkg.lockup_address));
  const actualScript = OutScript.encode({ type: 'tr', pubkey: outputKey });
  const prevout = Transaction.fromRaw(RawTx.encode(input.nonWitnessUtxo), { allowUnknownOutputs: true, allowUnknownInputs: true });
  const previousTxid = Array.from(sha256x2(prevout.toBytes(true, false)).reverse(), byte => byte.toString(16).padStart(2, '0')).join('');
  if ((control.version & 1) !== parity || !equalBytes(expectedScript, actualScript) ||
      !equalBytes(input.witnessUtxo.script, expectedScript) || !input.tapInternalKey || !equalBytes(input.tapInternalKey, internalKey) ||
      !input.tapMerkleRoot || !equalBytes(input.tapMerkleRoot, merkleRoot) || previousTxid !== pkg.lockup_transaction) {
    throw new Error('PSBT prevout, internal key or Taproot commitment does not match the intended lockup.');
  }
}
