import { address, networks, Psbt, Transaction } from 'bitcoinjs-lib';
import { AnchorReader, AnchorReadError } from './anchor-reader';
import { WorkbenchCoreReader } from '../workbench/workbench-core';

/** Native DefaultVtxo CSV path only. No caller supplied delay or witness is trusted.  @asyncUnsafe rejections propagate to the caller, which handles them. */
export async function planLeafExit(evidence: any, destination: unknown, rate: number, core: WorkbenchCoreReader) {
  if (evidence.engine !== '@arkade-os/sdk 0.4.72' || !evidence.exit_path) return null;
  const path = evidence.exit_path;
  const [txid, indexText] = evidence.vtxo_id.split(':');
  const index = Number(indexText);
  const parent = Transaction.fromHex(evidence.transactions[evidence.transactions.length - 1]);
  const output = parent.outs[index];
  if (parent.getId() !== txid || !output || !Number.isSafeInteger(path.sequence) || path.sequence < 1 || path.sequence > 65535 || path.leaf_version !== 192 || path.signature_bytes !== 64 || !/^(?:[0-9a-f]{2})+$/.test(path.script_hex) || !/^(?:[0-9a-f]{2})+$/.test(path.control_block_hex)) throw new AnchorReadError('invalid-exit-path', 'Native exit path evidence is inconsistent.');
  const leaf = await new AnchorReader(core).verify(evidence.vtxo_id);
  if (evidence.anchor?.source?.block_hash && evidence.anchor.source.block_hash !== leaf.source.block_hash) throw new AnchorReadError('source-changed', 'The chain checkpoint changed during package planning; retry.');
  if (leaf.outpoint_verified && (leaf.script_pub_key !== output.script.toString('hex') || leaf.amount_sats !== output.value)) throw new AnchorReadError('inconsistent-leaf', 'The owned leaf output differs from the reconstructed package.');
  const earliest = leaf.block_height === null ? null : leaf.block_height + path.sequence;
  const mature = earliest === null ? null : leaf.source.block_height + 1 >= earliest;
  const result: any = { outpoint: evidence.vtxo_id, source: leaf.source, spend_status: leaf.spend_status,
    script_csv_delay: { unit: 'blocks', value: path.sequence }, confirmation_height: leaf.block_height,
    earliest_confirmation_height: earliest, mature_for_next_block: mature,
    script_hex: path.script_hex, control_block_hex: path.control_block_hex,
    unsigned_psbt: null, estimated_signed_vsize: null, fee_sats: null, recovery_amount_sats: null,
    signature_created: false, relay_accepted: null,
    scope: 'Native DefaultVtxo user CSV leaf and owned confirmation height. Maturity is for the next block; no signature, funding, mempool acceptance or recovery is implied.' };
  if (destination === undefined || destination === '') return result;
  if (typeof destination !== 'string' || destination.length > 200) throw new AnchorReadError('invalid-destination', 'Supply a recovery address on the selected network.', 400);
  let script: Buffer;
  try { script = address.toOutputScript(destination, core.network === 'mainnet' ? networks.bitcoin : core.network === 'regtest' ? networks.regtest : networks.testnet); }
  catch { throw new AnchorReadError('invalid-destination', 'Recovery address does not match the selected network.', 400); }
  const tx = new Transaction(); tx.version = 2;
  tx.addInput(Buffer.from(txid, 'hex').reverse(), index, path.sequence); tx.addOutput(script, output.value);
  // A DefaultVtxo exit has one SIGHASH_DEFAULT Schnorr signature plus the exact native leaf and control block.
  tx.setWitness(0, [Buffer.alloc(64), Buffer.from(path.script_hex, 'hex'), Buffer.from(path.control_block_hex, 'hex')]);
  const size = tx.virtualSize(), fee = Math.ceil(size * rate);
  if (!Number.isSafeInteger(fee) || fee >= output.value) throw new AnchorReadError('insufficient-exit-value', 'The requested sweep fee consumes the full VTXO value.', 400);
  const psbt = new Psbt(); psbt.setVersion(2);
  psbt.addInput({ hash: txid, index, sequence: path.sequence, witnessUtxo: output,
    tapLeafScript: [{ leafVersion: path.leaf_version, script: Buffer.from(path.script_hex, 'hex'), controlBlock: Buffer.from(path.control_block_hex, 'hex') }] });
  psbt.addOutput({ script, value: output.value - fee });
  return { ...result, destination, unsigned_psbt: psbt.toBase64(), estimated_signed_vsize: size,
    fee_sats: fee, recovery_amount_sats: output.value - fee };
}
