import { planLeafExit } from './leaf-exit-plan';
import { WorkbenchCoreReader, ownedWorkbenchCore } from '../workbench/workbench-core';
import { Psbt, Transaction } from 'bitcoinjs-lib';
import { AnchorReadError } from './anchor-reader';
import { reconstructVpack } from './vpack-reconstruction';

/** Read-only planning from reconstructed bytes; never creates signatures or broadcasts. */
export async function planVpackExit(request: any, core: WorkbenchCoreReader = ownedWorkbenchCore) {
  const target = request?.target_feerate_sat_vb;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0 || target > 1000000) throw new AnchorReadError('invalid-feerate', 'Target fee rate must be greater than zero and at most 1000000 sat/vB.', 400);
  const packageEvidence = await reconstructVpack(request, core);
  const stages = packageEvidence.transactions.map((hex: string, index: number) => {
    const tx = Transaction.fromHex(hex);
    const input = tx.ins[0];
    const check = packageEvidence.transaction_checks[index];
    const scriptValid = packageEvidence.script_execution?.results[index]?.script_valid ?? null;
    const sequence = input.sequence;
    const relativeEnabled = tx.version >= 2 && (sequence & 0x80000000) === 0;
    const timeBased = (sequence & 0x00400000) !== 0;
    const witnessPresent = input.witness.length > 0;
    let psbt: string | null = null;
    let previousValue = packageEvidence.anchor.amount_sats;
    let previousScript = packageEvidence.anchor.script_pub_key;
    if (index > 0) {
      const parent = Transaction.fromHex(packageEvidence.transactions[index - 1]);
      previousValue = parent.outs[input.index].value;
      previousScript = parent.outs[input.index].script.toString('hex');
    }
    if (previousValue !== null && previousScript !== null) {
      const bundle = new Psbt(); bundle.setVersion(tx.version); bundle.setLocktime(tx.locktime);
      bundle.addInput({ hash: input.hash, index: input.index, sequence, witnessUtxo: { value: previousValue, script: Buffer.from(previousScript, 'hex') } });
      for (const output of tx.outs) bundle.addOutput({ value: output.value, script: output.script });
      psbt = bundle.toBase64();
    }
    return { index, txid: tx.getId(), transaction_hex: hex, unsigned_psbt: psbt,
      signature_valid: check.signature_valid, script_valid: scriptValid, witness_present: witnessPresent,
      serialized_vsize: tx.virtualSize(), final_vsize: scriptValid === true ? tx.virtualSize() : null,
      fee_sats: check.fee_sats,
      sequence_delay: relativeEnabled ? { unit: timeBased ? 'seconds' : 'blocks', value: (sequence & 0xffff) * (timeBased ? 512 : 1) } : null,
      script_csv_delay: null, ready_to_broadcast: null,
      fee_anchor_outputs: tx.outs.flatMap((output, outputIndex) => output.script.toString('hex') === '51024e73' ? [{ output_index: outputIndex, amount_sats: output.value, script_type: 'pay-to-anchor' }] : []),
    };
  });
  const leafSweep = await planLeafExit(packageEvidence, request.recovery_address, target, core);
  const feeKnown = stages.every(stage => stage.fee_sats !== null);
  const finalSizeKnown = stages.every(stage => stage.final_vsize !== null);
  const totalFee = feeKnown ? stages.reduce((sum, stage) => sum + stage.fee_sats!, 0) : null;
  const finalVsize = finalSizeKnown ? stages.reduce((sum, stage) => sum + stage.final_vsize!, 0) : null;
  return { vtxo_id: packageEvidence.vtxo_id, anchor: packageEvidence.anchor, stages, leaf_sweep: leafSweep,
    target_feerate_sat_vb: target, total_fee_sats: totalFee, final_package_vsize: finalVsize,
    additional_fee_required_sats: totalFee !== null && finalVsize !== null ? Math.max(0, Math.ceil(finalVsize * target) - totalFee) : null,
    protocol_verified: null, exit_viable: null, broadcast_performed: false,
    warnings: ['Unsigned PSBTs contain no new signatures. A complete exit needs wallet signatures, a funded relay package and a confirmed recovery.',
      'Branch sequence fields alone do not establish maturity. Native DefaultVtxo leaf maturity, when available, is separately bound to the owned chain.',
      'Fee scenarios use supplied rates and known bytes; they do not predict confirmation time or establish relay acceptance.',
      'Fee anchor candidates require a real funded child transaction; no CPFP child or wallet funding was invented.'],
    verification_scope: 'Actual reconstructed transaction package, unsigned PSBT preparation where previous output data is known, sequence fields and fee arithmetic. Complete unilateral recovery is not established.' };
}
